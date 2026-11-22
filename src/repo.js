// Onde os dados ficam guardados.
//  - PgRepo:   Supabase (ou qualquer PostgreSQL) — produção. Usa DATABASE_URL.
//  - JsonRepo: ficheiro local data/state.json — demonstração e desenvolvimento.
// A plataforma mantém tudo em memória e chama save*() a cada alteração.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_PLANS = [
  { id: 'semanal', name: 'Semanal', price: 150, days: 7, maxGroups: 1, highlight: false, active: true, sort: 1 },
  { id: 'mensal', name: 'Mensal', price: 450, days: 30, maxGroups: 2, highlight: true, active: true, sort: 2 },
  { id: 'pro', name: 'Pro', price: 1200, days: 30, maxGroups: 6, highlight: false, active: true, sort: 3 },
];

const emptyState = () => ({
  plans: structuredClone(DEFAULT_PLANS), resellers: [], botNumbers: [], groups: [], orders: {}, payments: [],
  fraud: { reports: [], banned: {} }, settings: {},
});

// ------------------------------------------------------------------ JSON
export class JsonRepo {
  constructor(file) { this.file = file; this.timer = null; }

  async load() {
    this.state = this.file && fs.existsSync(this.file)
      ? { ...emptyState(), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }
      : emptyState();
    return this.state;
  }

  // Com JSON, o estado em memória É o que se grava; basta agendar a escrita.
  touch() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.writeNow(), 300);
  }
  writeNow() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async flush() { clearTimeout(this.timer); this.writeNow(); }

  savePlan() { this.touch(); }
  deletePlan() { this.touch(); }
  saveReseller() { this.touch(); }
  deleteReseller() { this.touch(); }
  saveBotNumber() { this.touch(); }
  deleteBotNumber() { this.touch(); }
  saveGroup() { this.touch(); }
  saveOrder() { this.touch(); }
  saveFraudReport() { this.touch(); }
  saveBan() { this.touch(); }
  deleteBan() { this.touch(); }
  saveSetting() { this.touch(); }
  async addPayment(p) {
    p.id = this.state.payments.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    this.touch();
    return p;
  }
}

// ------------------------------------------------------------------ PostgreSQL / Supabase
const ts = v => (v == null ? null : new Date(v));
const ms = v => (v == null ? null : new Date(v).getTime());
const num = v => (v == null ? null : Number(v));

export class PgRepo {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    this.pool = pool;
    this.queue = Promise.resolve();
    this.errors = 0;
  }

  static async connect(url) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    });
    return new PgRepo(pool);
  }

  async migrate() {
    const sql = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    await this.pool.query(sql);
  }

  /** Executa escritas em fila (pela ordem em que aconteceram). */
  enqueue(fn) {
    this.queue = this.queue.then(fn).catch(e => { this.errors++; console.error('❌ Base de dados:', e.message); });
    return this.queue;
  }
  q(sql, params) { return this.enqueue(() => this.pool.query(sql, params)); }
  async flush() { await this.queue; }

  async load() {
    const p = this.pool;
    const [plans, resellers, bots, groups, orders, payments, reports, banned, settings] = await Promise.all([
      p.query('select * from plans order by sort, price'),
      p.query('select * from resellers order by created_at'),
      p.query('select * from bot_numbers order by created_at'),
      p.query('select * from groups'),
      p.query(`select reseller_id, data from orders
               where created_at > now() - interval '60 days' or status in ('pendente','aguarda_numero')
               order by reseller_id, id`),
      p.query('select * from payments order by id'),
      p.query('select * from fraud_reports order by id'),
      p.query('select * from banned_numbers'),
      p.query('select * from settings'),
    ]);
    const ordersBy = {};
    for (const r of orders.rows) (ordersBy[r.reseller_id] ||= []).push(r.data);
    return {
      plans: plans.rows.map(r => ({ id: r.id, name: r.name, price: num(r.price), days: r.days, maxGroups: r.max_groups, highlight: r.highlight, active: r.active, sort: r.sort })),
      resellers: resellers.rows.map(r => ({
        id: r.id, name: r.name, phone: r.phone, planId: r.plan_id, status: r.status, expiresAt: ms(r.expires_at),
        inviteCode: r.invite_code, botPhone: r.bot_phone, notes: r.notes, config: r.config, remindedFor: ms(r.reminded_for), createdAt: ms(r.created_at),
      })),
      botNumbers: bots.rows.map(r => ({ phone: r.phone, label: r.label, status: 'desligado', pairingCode: null, createdAt: ms(r.created_at), updatedAt: ms(r.updated_at) })),
      groups: groups.rows.map(r => ({ jid: r.jid, resellerId: r.reseller_id, botPhone: r.bot_phone, name: r.name, active: r.active, activatedAt: ms(r.activated_at), activatedBy: r.activated_by })),
      orders: ordersBy,
      payments: payments.rows.map(r => ({ id: Number(r.id), resellerId: r.reseller_id, amount: num(r.amount), days: r.days, method: r.method, reference: r.reference, note: r.note, createdAt: ms(r.created_at) })),
      fraud: {
        reports: reports.rows.map(r => ({ id: r.id, tenant: r.reseller_id, phone: r.phone, reason: r.reason, by: r.reported_by, byName: r.reported_by_name, groupId: r.group_jid, status: r.status, at: ms(r.created_at) })),
        banned: Object.fromEntries(banned.rows.map(r => [r.phone, { tenant: r.reseller_id, reason: r.reason, at: ms(r.created_at) }])),
      },
      settings: Object.fromEntries(settings.rows.map(r => [r.key, r.value])),
    };
  }

  savePlan(p) {
    return this.q(`insert into plans (id,name,price,days,max_groups,highlight,active,sort) values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (id) do update set name=$2,price=$3,days=$4,max_groups=$5,highlight=$6,active=$7,sort=$8`,
    [p.id, p.name, p.price, p.days, p.maxGroups, !!p.highlight, p.active !== false, p.sort || 0]);
  }
  deletePlan(id) { return this.q('delete from plans where id=$1', [id]); }

  saveReseller(r) {
    return this.q(`insert into resellers (id,name,phone,plan_id,status,expires_at,invite_code,bot_phone,notes,config,reminded_for,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      on conflict (id) do update set name=$2,phone=$3,plan_id=$4,status=$5,expires_at=$6,invite_code=$7,bot_phone=$8,notes=$9,config=$10,reminded_for=$11`,
    [r.id, r.name, r.phone, r.planId, r.status, ts(r.expiresAt), r.inviteCode, r.botPhone, r.notes || null, JSON.stringify(r.config || {}), ts(r.remindedFor), ts(r.createdAt)]);
  }
  deleteReseller(id) { return this.q('delete from resellers where id=$1', [id]); }

  saveBotNumber(b) {
    return this.q(`insert into bot_numbers (phone,label,status,pairing_code,created_at,updated_at) values ($1,$2,$3,$4,$5,now())
      on conflict (phone) do update set label=$2,status=$3,pairing_code=$4,updated_at=now()`,
    [b.phone, b.label || null, b.status, b.pairingCode || null, ts(b.createdAt || Date.now())]);
  }
  deleteBotNumber(phone) { return this.q('delete from bot_numbers where phone=$1', [phone]); }

  saveGroup(g) {
    return this.q(`insert into groups (jid,reseller_id,bot_phone,name,active,activated_at,activated_by) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (jid) do update set reseller_id=$2,bot_phone=$3,name=$4,active=$5,activated_at=$6,activated_by=$7`,
    [g.jid, g.resellerId, g.botPhone, g.name, g.active, ts(g.activatedAt), g.activatedBy || null]);
  }

  saveOrder(resellerId, o) {
    const { ref, ...data } = o; // a referência da mensagem do WhatsApp fica fora da coluna principal
    data.ref = ref ? { key: ref.key, message: ref.message } : null;
    return this.q(`insert into orders (reseller_id,id,status,tx_id,amount,package_name,target_phone,customer_phone,created_at,done_at,data)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      on conflict (reseller_id,id) do update set status=$3,tx_id=$4,amount=$5,package_name=$6,target_phone=$7,customer_phone=$8,done_at=$10,data=$11`,
    [resellerId, o.id, o.status, o.txId || null, o.amount, o.packageName, o.targetPhone, o.customerPhone, ts(o.createdAt), ts(o.doneAt), JSON.stringify(data)]);
  }

  async addPayment(p) {
    let row;
    await this.enqueue(async () => {
      row = (await this.pool.query(`insert into payments (reseller_id,amount,days,method,reference,note,created_at)
        values ($1,$2,$3,$4,$5,$6,$7) returning id`, [p.resellerId, p.amount, p.days, p.method || null, p.reference || null, p.note || null, ts(p.createdAt)])).rows[0];
    });
    if (!row) throw new Error('Não consegui gravar o pagamento.');
    p.id = Number(row.id);
    return p;
  }

  saveFraudReport(r) {
    return this.q(`insert into fraud_reports (id,reseller_id,phone,reason,reported_by,reported_by_name,group_jid,status,created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do update set status=$8`,
    [r.id, r.tenant, r.phone, r.reason, r.by, r.byName, r.groupId, r.status, ts(r.at)]);
  }
  saveBan(b) {
    return this.q(`insert into banned_numbers (phone,reseller_id,reason,created_at) values ($1,$2,$3,$4)
      on conflict (phone) do update set reseller_id=$2,reason=$3,created_at=$4`, [b.phone, b.tenant, b.reason, ts(b.at)]);
  }
  deleteBan(phone) { return this.q('delete from banned_numbers where phone=$1', [phone]); }

  saveSetting(key, value) {
    return this.q('insert into settings (key,value) values ($1,$2) on conflict (key) do update set value=$2', [key, JSON.stringify(value)]);
  }
}
