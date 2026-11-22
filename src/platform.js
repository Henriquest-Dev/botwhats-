// A plataforma: números de bot (teus) + revendedores (assinantes) + grupos.
//
//  Revendedor → adiciona o número do bot ao grupo → escreve "!ativar CÓDIGO"
//  → o grupo fica ligado a esse revendedor enquanto a assinatura estiver paga.
import crypto from 'node:crypto';
import path from 'node:path';
import { Bot } from './bot.js';
import { Store } from './store.js';
import { FraudRegistry } from './fraud.js';
import { BotConnection, phoneOf, jidOfPhone } from './connection.js';
import { normalizePhone } from './parser.js';
import { defaultConfig } from './defaults.js';
import { fmtMT } from './messages.js';
import { FileAuthStore } from './wa-auth.js';

const DAY = 24 * 3600 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const fmtDate = ms => new Date(ms).toLocaleDateString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtPhone = p => (p ? `${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}` : '');

export class Platform {
  /**
   * @param {object} o
   * @param {object} o.repo           JsonRepo | PgRepo
   * @param {Function} o.socketFactory
   * @param {string} o.dataDir        onde ficam as sessões do WhatsApp (data/bots/<numero>)
   * @param {object} [o.ai]
   * @param {Function} [o.now]
   */
  constructor({ repo, socketFactory, dataDir, authStore, ai = null, now = () => Date.now(), logger }) {
    this.repo = repo;
    this.authStore = authStore || new FileAuthStore(path.join(dataDir, 'bots'));
    this.socketFactory = socketFactory;
    this.dataDir = dataDir;
    this.ai = ai;
    this.now = now;
    this.logger = logger;
    this.connections = new Map();
    this.bots = new Map();          // resellerId → Bot
    this.customerOf = new Map();    // telefone do cliente → resellerId (para o privado)
    this.genericReplied = new Map();
    this.activity = [];
  }

  async init() {
    this.state = await this.repo.load();
    this.fraud = new FraudRegistry({
      reports: this.state.fraud.reports,
      banned: this.state.fraud.banned,
      onChange: (kind, item) => {
        if (kind === 'report') this.repo.saveFraudReport(item);
        if (kind === 'ban') this.repo.saveBan(item);
        if (kind === 'unban') this.repo.deleteBan(item.phone);
      },
    });
    for (const [rid, orders] of Object.entries(this.state.orders)) {
      for (const o of orders) if (o.customerPhone) this.customerOf.set(o.customerPhone, rid);
    }
    return this;
  }

  /** Liga todos os números de bot que já têm sessão guardada. */
  async startAll() {
    for (const b of this.state.botNumbers) {
      const c = this.connection(b.phone);
      if (await c.hasSession()) c.start().catch(e => console.error(`[bot ${b.phone}]`, e.message));
    }
  }

  // ================================================================ dados
  get owner() { return this.state.settings.owner || {}; }
  plan(id) { return this.state.plans.find(p => p.id === id) || null; }
  reseller(id) { return this.state.resellers.find(r => r.id === id) || null; }
  group(jid) { return this.state.groups.find(g => g.jid === jid) || null; }
  groupsOf(rid) { return this.state.groups.filter(g => g.resellerId === rid && g.active); }
  isActive(r) { return !!r && r.status === 'ativo' && (r.expiresAt || 0) > this.now(); }

  resellerByPhone(phone) {
    if (!phone) return null;
    return this.state.resellers.find(r => r.phone === phone)
      || this.state.resellers.find(r => (r.config?.admins || []).includes(phone)) || null;
  }

  resellerByCode(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.state.resellers.find(r => r.inviteCode.replace(/-/g, '') === c) || null;
  }

  newInviteCode() {
    let code;
    do {
      code = 'MZ-' + Array.from(crypto.randomBytes(4), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    } while (this.resellerByCode(code));
    return code;
  }

  /** O Bot (lógica de pedidos/moderação/IA) de um revendedor. */
  botFor(r) {
    let bot = this.bots.get(r.id);
    if (bot) return bot;
    r.config = { ...defaultConfig(r.phone), businessName: r.name, ...r.config };
    const orders = (this.state.orders[r.id] ||= []);
    const store = new Store({
      orders,
      paused: r.config.paused,
      onChange: (kind, v) => {
        if (kind === 'order') {
          this.repo.saveOrder(r.id, v);
          if (v.customerPhone) this.customerOf.set(v.customerPhone, r.id);
        }
        if (kind === 'paused') { r.config.paused = v; this.repo.saveReseller(r); }
      },
    });
    // "groups" é calculado (não é gravado na configuração)
    Object.defineProperty(r.config, 'groups', { get: () => this.groupsOf(r.id).map(g => g.jid), enumerable: false, configurable: true });
    bot = new Bot(r.config, store, {
      fraud: this.fraud, ai: this.ai, tenantId: r.id, now: this.now,
      saveConfig: () => this.repo.saveReseller(r),
    });
    this.bots.set(r.id, bot);
    return bot;
  }

  // ================================================================ WhatsApp
  connection(phone) {
    let c = this.connections.get(phone);
    if (c) return c;
    c = new BotConnection(phone, { authStore: this.authStore, socketFactory: this.socketFactory, logger: this.logger });
    c.on('status', s => {
      const b = this.state.botNumbers.find(x => x.phone === phone);
      if (b) { b.status = s; b.pairingCode = c.pairingCode; this.repo.saveBotNumber(b); }
    });
    c.on('message', m => this.onMessage(c, m).catch(e => console.error('mensagem:', e)));
    c.on('join', e => this.onJoin(c, e).catch(err => console.error('entrada:', err)));
    this.connections.set(phone, c);
    return c;
  }

  /** Ligação a usar para um revendedor (o seu número de bot, ou qualquer um ligado). */
  connFor(r, fallback) {
    const own = r?.botPhone && this.connections.get(r.botPhone);
    if (own?.status === 'ligado') return own;
    if (fallback?.status === 'ligado') return fallback;
    return [...this.connections.values()].find(c => c.status === 'ligado') || null;
  }

  adminJids(r) {
    const phones = new Set([r.phone, ...(r.config?.admins || [])].map(normalizePhone).filter(Boolean));
    return [...phones].map(jidOfPhone);
  }

  log(entry) {
    this.activity.unshift({ ...entry, at: this.now() });
    this.activity.length = Math.min(this.activity.length, 100);
  }

  async onMessage(conn, m) {
    const chatId = m.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const inner = m.message.ephemeralMessage?.message || m.message.viewOnceMessage?.message || m.message;
    const text = (inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.documentMessage?.caption || '').trim();
    const hasImage = !!(inner.imageMessage || inner.documentMessage?.mimetype?.startsWith('image/'));
    if (!text && !hasImage) return;
    const ctx = inner.extendedTextMessage?.contextInfo || inner.imageMessage?.contextInfo || {};
    const senderJid = isGroup ? m.key.participant : chatId;
    const senderPhone = phoneOf(m.key.participantAlt) || phoneOf(m.key.remoteJidAlt)
      || await conn.phoneForJid(senderJid, isGroup ? chatId : null);
    const isOwner = !!m.key.fromMe || (senderPhone && senderPhone === normalizePhone(this.owner.phone));

    // ---------- Grupo ----------
    let r;
    if (isGroup) {
      const act = text.match(/^[!/.]?ativar\s+([A-Za-z0-9-]{4,})\s*$/i);
      if (act) return this.activateGroup(conn, chatId, act[1], senderPhone, m);

      const g = this.group(chatId);
      if (!g || !g.active) return;
      if (g.botPhone && g.botPhone !== conn.phone && this.connections.get(g.botPhone)?.status === 'ligado') return; // outro bot trata
      r = this.reseller(g.resellerId);
      const isResellerAdmin = isOwner || (senderPhone && this.adminJids(r).includes(jidOfPhone(senderPhone)));
      if (/^[!/.]?desativar$/i.test(text) && isResellerAdmin) return this.deactivateGroup(chatId, conn, true);
      if (!this.isActive(r)) return this.notifyExpired(r, conn);
      if (senderPhone && !isResellerAdmin) this.customerOf.set(senderPhone, r.id);
      return this.dispatch(r, conn, { chatId, isGroup, senderJid, senderPhone, isAdmin: isResellerAdmin, text, hasImage, ctx, m });
    }

    // ---------- Privado ----------
    if (m.key.fromMe) return; // mensagens que o dono escreve no telemóvel do bot
    r = this.resellerByPhone(senderPhone);
    const isResellerAdmin = !!r;
    if (r) {
      if (/^[!/.]?(assinatura|plano|meus grupos|grupos)$/i.test(text)) return conn.send(chatId, { text: this.subscriptionText(r) });
      if (!this.isActive(r)) return conn.send(chatId, { text: this.expiredText(r) });
    } else {
      r = this.reseller(this.customerOf.get(senderPhone));
      if (/^[!/.]?ativar\b/i.test(text)) {
        return conn.send(chatId, { text: '👉 O código de activação deve ser escrito *dentro do grupo*, depois de adicionares este número e o tornares administrador.' });
      }
      if (!r || !this.isActive(r)) return this.genericReply(conn, chatId, senderPhone);
    }
    return this.dispatch(r, conn, { chatId, isGroup: false, senderJid: chatId, senderPhone, isAdmin: isResellerAdmin, text, hasImage, ctx, m });
  }

  async dispatch(r, conn, { chatId, isGroup, senderJid, senderPhone, isAdmin, text, hasImage, ctx, m }) {
    const bot = this.botFor(r);
    const mentioned = ctx.mentionedJid || [];
    const targets = [];
    for (const j of mentioned.filter(j => !conn.isMe(j))) targets.push({ jid: j, phone: await conn.phoneForJid(j, chatId) });
    if (ctx.participant && !conn.isMe(ctx.participant) && !targets.length) {
      targets.push({ jid: ctx.participant, phone: await conn.phoneForJid(ctx.participant, chatId) });
    }
    const actions = await bot.handle({
      chatId, isGroup, userKey: senderJid, userJid: senderJid, customerPhone: senderPhone, isAdmin, fromMe: !!m.key.fromMe,
      customerName: m.pushName || null, text, hasImage, targets,
      mentionsBot: mentioned.some(j => conn.isMe(j)), replyToBot: conn.isMe(ctx.participant),
      ref: m, quoteRef: { key: m.key, message: { conversation: text || '🖼️ comprovativo' } },
    });
    if (actions.length) this.log({ resellerId: r.id, chatId, from: senderPhone, text: text.slice(0, 80) });
    await this.run(r, conn, actions);
  }

  /** Executa acções, escolhendo o número de bot certo para cada conversa. */
  async run(r, conn, actions) {
    for (const a of actions) {
      if (a.type === 'noop') continue;
      let c = conn;
      if (a.chatId?.endsWith('@g.us')) {
        const g = this.group(a.chatId);
        c = (g?.botPhone && this.connections.get(g.botPhone)) || conn;
      }
      c = c?.status === 'ligado' ? c : this.connFor(r, conn);
      if (!c) continue;
      try {
        await c.exec(a, this.adminJids(r));
      } catch (e) {
        if (a.type === 'group' && !a.silent) {
          await c.send(a.chatId, { text: '⚠️ Não consegui fazer isso. O bot precisa de ser *administrador* do grupo.' }).catch(() => {});
        }
      }
    }
  }

  async onJoin(conn, { chatId, participants }) {
    const g = this.group(chatId);
    if (!g?.active) return;
    const r = this.reseller(g.resellerId);
    if (!this.isActive(r)) return;
    await this.run(r, conn, this.botFor(r).onJoin(chatId, participants));
  }

  async genericReply(conn, chatId, phone) {
    const last = this.genericReplied.get(phone) || 0;
    if (this.now() - last < 6 * 3600 * 1000) return;
    this.genericReplied.set(phone, this.now());
    await conn.send(chatId, { text: `Olá! 👋 Sou um assistente de vendas de megas.\n\nPara comprar, envia o comprovativo *no grupo do teu vendedor*.\n\nÉs revendedor e queres este bot no teu grupo? Fala com ${this.owner.name || 'o administrador'}: wa.me/258${this.owner.phone || ''}` }).catch(() => {});
  }

  // ================================================================ activação
  async activateGroup(conn, chatId, code, senderPhone, m) {
    const reply = text => conn.send(chatId, { text }, { quoted: m }).catch(() => {});
    const r = this.resellerByCode(code);
    if (!r) return reply('❌ Código inválido. Confirma o código que recebeste e tenta outra vez.');
    if (!this.isActive(r)) return reply(`⚠️ A assinatura de *${r.name}* não está activa. Renova para activar o bot.`);

    const existing = this.group(chatId);
    if (existing?.active && existing.resellerId !== r.id) return reply('⚠️ Este grupo já está activo para outro revendedor.');
    if (existing?.active && existing.resellerId === r.id) return reply('✅ O bot já está activo neste grupo.');

    const plan = this.plan(r.planId);
    const max = plan?.maxGroups ?? 1;
    const used = this.groupsOf(r.id).length;
    if (used >= max) {
      return reply(`⚠️ O teu plano (${plan?.name || '—'}) permite *${max} grupo(s)* e já tens ${used} activo(s).\nPara usar aqui, escreve *!desativar* noutro grupo, ou fala connosco para mudar de plano.`);
    }

    const meta = await conn.groupMeta(chatId, true);
    const g = existing || { jid: chatId };
    Object.assign(g, {
      resellerId: r.id, botPhone: conn.phone, name: meta?.subject || g.name || 'Grupo', active: true,
      activatedAt: this.now(), activatedBy: senderPhone,
    });
    if (!existing) this.state.groups.push(g);
    this.repo.saveGroup(g);
    if (!r.botPhone) { r.botPhone = conn.phone; this.repo.saveReseller(r); }

    const admin = await conn.isGroupAdmin(chatId);
    await reply([
      `✅ *Bot activado!*`,
      '',
      `Este grupo agora é atendido pelo bot de *${r.config?.businessName || r.name}*.`,
      'Para comprar: paga e envia aqui o *SMS de confirmação* + o *número* que vai receber os megas. Escreve *menu* para ver os pacotes.',
      admin ? null : '\n⚠️ Torna-me *administrador* do grupo para eu poder apagar spam e remover burladores.',
    ].filter(l => l !== null).join('\n'));

    this.botFor(r);
    await this.run(r, conn, [{ type: 'admin', text: `🎉 Bot activado no grupo *${g.name}* (${used + 1}/${max} do teu plano).\n\nEscreve *ajuda* aqui para veres os comandos, ou *assinatura* para veres o teu plano.` }]);
    await this.notifyOwner(`🆕 ${r.name} activou o bot no grupo "${g.name}" (${used + 1}/${max}).`);
    this.log({ resellerId: r.id, chatId, from: senderPhone, text: `Activou o grupo "${g.name}"` });
  }

  async deactivateGroup(jid, conn, announce) {
    const g = this.group(jid);
    if (!g) return false;
    g.active = false;
    this.repo.saveGroup(g);
    const c = conn || this.connections.get(g.botPhone);
    if (announce && c?.status === 'ligado') await c.send(jid, { text: '👋 Bot desactivado neste grupo.' }).catch(() => {});
    return true;
  }

  // ================================================================ assinaturas
  subscriptionText(r) {
    const plan = this.plan(r.planId);
    const groups = this.groupsOf(r.id);
    const left = Math.ceil(((r.expiresAt || 0) - this.now()) / DAY);
    return [
      `📋 *A tua assinatura*`,
      `Plano: *${plan?.name || '—'}* (${plan ? fmtMT(plan.price) : '—'})`,
      this.isActive(r) ? `Válida até *${fmtDate(r.expiresAt)}* (${left} dia${left === 1 ? '' : 's'})` : '⚠️ *Expirada*',
      `Grupos: ${groups.length}/${plan?.maxGroups ?? 1}${groups.length ? '\n' + groups.map(g => `• ${g.name}`).join('\n') : ''}`,
      `Código de activação: *${r.inviteCode}*`,
      '',
      this.renewText(r),
    ].join('\n');
  }

  renewText(r) {
    const plan = this.plan(r.planId);
    const accs = this.owner.paymentAccounts || [];
    return [
      `💳 *Para renovar*${plan ? ` (${fmtMT(plan.price)})` : ''}:`,
      ...(accs.length ? accs.map(a => `• ${a.provider}: *${a.number}* (${a.name})`) : [`• Fala com ${this.owner.name || 'o administrador'}`]),
      this.owner.phone ? `Depois envia o comprovativo para wa.me/258${this.owner.phone}` : '',
    ].filter(Boolean).join('\n');
  }

  expiredText(r) {
    return `⚠️ *A tua assinatura do bot expirou${r.status === 'suspenso' ? ' / está suspensa' : ''}.*\nO bot parou de responder nos teus grupos.\n\n${this.renewText(r)}`;
  }

  async notifyExpired(r, conn) {
    const key = `expired:${r.expiresAt}:${r.status}`;
    if (r.config?.lastNotice === key) return;
    r.config.lastNotice = key;
    this.repo.saveReseller(r);
    await this.run(r, conn, [{ type: 'admin', text: this.expiredText(r) }]);
  }

  async notifyOwner(text) {
    const p = normalizePhone(this.owner.phone);
    const c = this.connFor(null);
    if (p && c) await c.send(jidOfPhone(p), { text }).catch(() => {});
  }

  /** Corre a cada minuto: lembretes de pedidos e de renovação. */
  async tick() {
    for (const r of this.state.resellers) {
      if (!this.isActive(r)) continue;
      const bot = this.botFor(r);
      await this.run(r, null, bot.tick());
      const left = r.expiresAt - this.now();
      if (left < 3 * DAY && r.remindedFor !== r.expiresAt) {
        r.remindedFor = r.expiresAt;
        this.repo.saveReseller(r);
        await this.run(r, null, [{ type: 'admin', text: `⏰ A tua assinatura do bot termina a *${fmtDate(r.expiresAt)}*.\n\n${this.renewText(r)}` }]);
        await this.notifyOwner(`⏰ A assinatura de ${r.name} (${fmtPhone(r.phone)}) termina a ${fmtDate(r.expiresAt)}.`);
      }
    }
  }

  // ================================================================ painel do dono
  createReseller({ name, phone, planId, notes, firstPayment }) {
    const p = normalizePhone(phone);
    if (!name?.trim()) throw new Error('Escreve o nome do revendedor.');
    if (!p) throw new Error('Número inválido.');
    if (this.state.resellers.some(r => r.phone === p)) throw new Error('Já existe um revendedor com este número.');
    const plan = this.plan(planId) || this.state.plans.find(x => x.active);
    if (!plan) throw new Error('Cria primeiro um plano.');
    const r = {
      id: crypto.randomUUID(), name: name.trim(), phone: p, planId: plan.id, status: 'ativo',
      expiresAt: this.now(), inviteCode: this.newInviteCode(), botPhone: this.leastLoadedBot(),
      notes: notes || null, config: { ...defaultConfig(p), businessName: name.trim() }, remindedFor: null, createdAt: this.now(),
    };
    this.state.resellers.push(r);
    this.repo.saveReseller(r);
    return firstPayment ? this.addPayment(r.id, { amount: plan.price, days: plan.days, method: firstPayment.method, reference: firstPayment.reference }).then(() => r) : Promise.resolve(r);
  }

  leastLoadedBot() {
    const bots = this.state.botNumbers;
    if (!bots.length) return null;
    const load = phone => this.state.groups.filter(g => g.active && g.botPhone === phone).length;
    return bots.slice().sort((a, b) => load(a.phone) - load(b.phone))[0].phone;
  }

  updateReseller(id, patch) {
    const r = this.reseller(id);
    if (!r) throw new Error('Revendedor não encontrado.');
    if ('name' in patch && patch.name.trim()) r.name = patch.name.trim();
    if ('phone' in patch) {
      const p = normalizePhone(patch.phone);
      if (!p) throw new Error('Número inválido.');
      if (this.state.resellers.some(x => x.phone === p && x.id !== id)) throw new Error('Já existe um revendedor com este número.');
      r.phone = p;
    }
    if ('planId' in patch && this.plan(patch.planId)) r.planId = patch.planId;
    if ('notes' in patch) r.notes = patch.notes || null;
    if ('status' in patch && ['ativo', 'suspenso'].includes(patch.status)) r.status = patch.status;
    if ('botPhone' in patch) r.botPhone = patch.botPhone || null;
    if ('expiresAt' in patch && Number.isFinite(patch.expiresAt)) r.expiresAt = patch.expiresAt;
    if (patch.config && typeof patch.config === 'object') {
      const allowed = ['businessName', 'packages', 'paymentAccounts', 'admins', 'hours', 'minutesPerOrder', 'reminderMinutes', 'acceptImageProofs', 'privateChats', 'ai'];
      r.config ||= {};
      for (const k of allowed) if (k in patch.config) r.config[k] = patch.config[k];
      this.bots.get(id)?.refreshNumbers();
    }
    this.repo.saveReseller(r);
    return r;
  }

  async addPayment(id, { amount, days, method, reference, note }) {
    const r = this.reseller(id);
    if (!r) throw new Error('Revendedor não encontrado.');
    const plan = this.plan(r.planId);
    days = Number(days) || plan?.days || 30;
    amount = Number(amount ?? plan?.price ?? 0);
    const p = await this.repo.addPayment({ resellerId: id, amount, days, method, reference, note, createdAt: this.now() });
    this.state.payments.push(p);
    r.expiresAt = Math.max(this.now(), r.expiresAt || 0) + days * DAY;
    r.status = 'ativo';
    r.remindedFor = null;
    this.repo.saveReseller(r);
    const c = this.connFor(r);
    if (c) {
      await c.send(jidOfPhone(r.phone), { text: `✅ *Pagamento recebido* (${fmtMT(amount)}). Obrigado!\nA tua assinatura está válida até *${fmtDate(r.expiresAt)}*.` }).catch(() => {});
    }
    return p;
  }

  regenerateCode(id) {
    const r = this.reseller(id);
    if (!r) throw new Error('Revendedor não encontrado.');
    r.inviteCode = this.newInviteCode();
    this.repo.saveReseller(r);
    return r.inviteCode;
  }

  async deleteReseller(id) {
    for (const g of this.groupsOf(id)) await this.deactivateGroup(g.jid, null, true);
    this.state.resellers = this.state.resellers.filter(r => r.id !== id);
    this.state.groups = this.state.groups.filter(g => g.resellerId !== id);
    delete this.state.orders[id];
    this.bots.delete(id);
    this.repo.deleteReseller(id);
  }

  inviteMessage(r) {
    const bot = r.botPhone || this.state.botNumbers[0]?.phone;
    const plan = this.plan(r.planId);
    return [
      `Olá ${r.name}! 👋`,
      `O teu bot de vendas está pronto (plano ${plan?.name || ''}, ${plan?.maxGroups ?? 1} grupo${(plan?.maxGroups ?? 1) > 1 ? 's' : ''}).`,
      '',
      'Para o activar:',
      `1. Adiciona este número ao teu grupo: +258 ${fmtPhone(bot)}`,
      '2. Torna-o administrador do grupo',
      `3. No grupo, escreve: !ativar ${r.inviteCode}`,
      '',
      'Depois, no privado do bot, escreve "ajuda" para veres os comandos e "assinatura" para veres o teu plano.',
    ].join('\n');
  }

  async addBotNumber(phone, label) {
    const p = normalizePhone(phone);
    if (!p) throw new Error('Número inválido.');
    let b = this.state.botNumbers.find(x => x.phone === p);
    if (!b) {
      b = { phone: p, label: label || null, status: 'desligado', pairingCode: null, createdAt: this.now() };
      this.state.botNumbers.push(b);
      this.repo.saveBotNumber(b);
    }
    const c = this.connection(p);
    if (c.status === 'ligado') return { status: 'ligado' };
    if (c.sock && !c.pairingCode) await c.stop();
    c.pairingCode = null;
    await c.start();
    await new Promise(resolve => {
      const done = () => { clearTimeout(t); c.off('status', check); resolve(); };
      const check = () => { if (c.pairingCode || c.status === 'ligado') done(); };
      const t = setTimeout(done, 25_000);
      c.on('status', check);
      check();
    });
    if (!c.pairingCode && c.status !== 'ligado') throw new Error('O WhatsApp não devolveu o código. Tenta de novo daqui a pouco.');
    return { status: c.status, code: c.pairingCode };
  }

  async removeBotNumber(phone) {
    const c = this.connections.get(phone);
    if (c) { await c.unlink(); this.connections.delete(phone); }
    this.state.botNumbers = this.state.botNumbers.filter(b => b.phone !== phone);
    this.repo.deleteBotNumber(phone);
  }

  savePlan(p) {
    const id = p.id || p.name?.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id || !p.name?.trim()) throw new Error('O plano precisa de um nome.');
    const plan = {
      id, name: p.name.trim(), price: Number(p.price) || 0, days: Number(p.days) || 30, maxGroups: Number(p.maxGroups) || 1,
      highlight: !!p.highlight, active: p.active !== false, sort: Number(p.sort) || 0,
    };
    const i = this.state.plans.findIndex(x => x.id === id);
    if (i >= 0) this.state.plans[i] = plan; else this.state.plans.push(plan);
    if (plan.highlight) for (const x of this.state.plans) if (x.id !== id && x.highlight) { x.highlight = false; this.repo.savePlan(x); }
    this.repo.savePlan(plan);
    return plan;
  }

  deletePlan(id) {
    if (this.state.resellers.some(r => r.planId === id)) throw new Error('Há revendedores neste plano. Desactiva-o em vez de o apagar.');
    this.state.plans = this.state.plans.filter(p => p.id !== id);
    this.repo.deletePlan(id);
  }

  saveSettings(key, value) {
    this.state.settings[key] = value;
    this.repo.saveSetting(key, value);
  }

  overview() {
    const now = this.now();
    const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const active = this.state.resellers.filter(r => this.isActive(r));
    const allOrders = Object.values(this.state.orders).flat();
    const today = new Date(now).toDateString();
    const revenueByDay = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * DAY).toDateString();
      revenueByDay.push({ day: d, amount: this.state.payments.filter(p => new Date(p.createdAt).toDateString() === d).reduce((s, p) => s + p.amount, 0) });
    }
    return {
      resellers: this.state.resellers.length,
      activeResellers: active.length,
      expiringSoon: active.filter(r => r.expiresAt - now < 7 * DAY).length,
      expired: this.state.resellers.filter(r => !this.isActive(r)).length,
      activeGroups: this.state.groups.filter(g => g.active).length,
      revenueMonth: this.state.payments.filter(p => p.createdAt >= monthStart.getTime()).reduce((s, p) => s + p.amount, 0),
      revenue30: revenueByDay.reduce((s, d) => s + d.amount, 0),
      revenueByDay,
      ordersToday: allOrders.filter(o => new Date(o.createdAt).toDateString() === today).length,
      ordersPending: allOrders.filter(o => o.status === 'pendente').length,
      sellerVolumeToday: allOrders.filter(o => o.status === 'concluido' && new Date(o.doneAt).toDateString() === today).reduce((s, o) => s + (o.amount || 0), 0),
      openReports: this.fraud.data.reports.filter(r => r.status === 'aberta').length,
      banned: Object.keys(this.fraud.data.banned).length,
      bots: this.state.botNumbers.map(b => ({ ...b, status: this.connections.get(b.phone)?.status || 'desligado', groups: this.state.groups.filter(g => g.active && g.botPhone === b.phone).length })),
    };
  }
}
