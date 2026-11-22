import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Platform } from '../src/platform.js';
import { JsonRepo, PgRepo } from '../src/repo.js';
import { fakeSocketFactory, fakeGroups, fakeSockets } from '../src/fake-socket.js';

const DAY = 864e5;
const BOT = '841000000';
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const PROOF = 'Confirmado DK47HJ2X9P. Transferiste 50.00MT para 841112233 - ZE. Numero: 845551234';

async function setup(repo = new JsonRepo(null)) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-'));
  const platform = await new Platform({ repo, socketFactory: fakeSocketFactory, dataDir }).init();
  platform.saveSettings('owner', { name: 'Dono', phone: '845550000', paymentAccounts: [{ provider: 'M-Pesa', number: '845550000', name: 'Dono' }] });
  // liga um número de bot (sessão já existente)
  platform.state.botNumbers.push({ phone: BOT, status: 'desligado', createdAt: Date.now() });
  await platform.authStore.writeMany(BOT, [{ key: 'creds', value: '{}' }]);
  await platform.startAll();
  await tick(300);
  const sock = fakeSockets.get(BOT);
  sock.sent.length = 0;
  const newGroup = (name, members = []) => {
    const jid = `1203${Math.floor(Math.random() * 1e9)}@g.us`;
    fakeGroups[jid] = { id: jid, subject: name, participants: [{ id: `258${BOT}@s.whatsapp.net`, admin: 'admin' }, ...members.map(p => ({ id: `258${p}@s.whatsapp.net` }))] };
    return jid;
  };
  const say = async (jid, text, from, name = 'X') => {
    sock.sent.length = 0;
    sock.receive(jid, text, jid.endsWith('@g.us') ? { participant: `258${from}@s.whatsapp.net`, name } : { name });
    await tick(60);
    return sock.sent;
  };
  return { platform, sock, newGroup, say, dataDir };
}

test('fluxo completo: criar revendedor → activar grupo → venda → ok', async () => {
  const { platform, newGroup, say } = await setup();
  const r = await platform.createReseller({ name: 'Zé dos Megas', phone: '841112233', planId: 'mensal', firstPayment: { method: 'M-Pesa' } });
  assert.ok(platform.isActive(r));
  assert.match(platform.inviteMessage(r), new RegExp(`!ativar ${r.inviteCode}`));

  const g = newGroup('Megas do Zé', ['841112233']);
  let out = await say(g, 'menu', '845551234');
  assert.equal(out.length, 0, 'grupo não activado: bot fica calado');

  out = await say(g, `!ativar ${r.inviteCode.toLowerCase()}`, '841112233');
  assert.match(out[0].content.text, /Bot activado/);
  assert.ok(out.some(s => s.jid === '258841112233@s.whatsapp.net' && /ajuda/.test(s.content.text)), 'revendedor avisado no privado');
  assert.ok(out.some(s => s.jid === '258845550000@s.whatsapp.net'), 'dono avisado');

  out = await say(g, PROOF, '845551234', 'Ana');
  assert.match(out.find(s => s.jid === g).content.text, /Pedido \*#1\*/);
  assert.match(out.find(s => s.jid === '258841112233@s.whatsapp.net').content.text, /Novo pedido #1/);

  out = await say('258841112233@s.whatsapp.net', 'ok 1', '841112233');
  assert.ok(out.some(s => s.jid === g && /concluído/.test(s.content.text)));
});

test('código inválido e limite de grupos do plano', async () => {
  const { platform, newGroup, say } = await setup();
  const r = await platform.createReseller({ name: 'Celso', phone: '847778800', planId: 'semanal', firstPayment: {} });
  assert.match((await say(newGroup('A'), '!ativar MZ-ZZZZ', '847778800'))[0].content.text, /Código inválido/);
  await say(newGroup('B'), `!ativar ${r.inviteCode}`, '847778800');
  const out = await say(newGroup('C'), `!ativar ${r.inviteCode}`, '847778800');
  assert.match(out[0].content.text, /permite \*1 grupo/);
});

test('grupo de outro revendedor não pode ser roubado', async () => {
  const { platform, newGroup, say } = await setup();
  const a = await platform.createReseller({ name: 'A', phone: '841111111', planId: 'mensal', firstPayment: {} });
  const b = await platform.createReseller({ name: 'B', phone: '842222222', planId: 'mensal', firstPayment: {} });
  const g = newGroup('G');
  await say(g, `!ativar ${a.inviteCode}`, '841111111');
  const out = await say(g, `!ativar ${b.inviteCode}`, '842222222');
  assert.match(out[0].content.text, /outro revendedor/);
  assert.equal(platform.group(g).resellerId, a.id);
});

test('assinatura expirada: bot pára e avisa o revendedor uma vez', async () => {
  const { platform, newGroup, say } = await setup();
  const r = await platform.createReseller({ name: 'Amina', phone: '823334455', planId: 'mensal', firstPayment: {} });
  const g = newGroup('Amina');
  await say(g, `!ativar ${r.inviteCode}`, '823334455');
  r.expiresAt = Date.now() - 1000;
  let out = await say(g, PROOF, '845551234');
  assert.ok(!out.some(s => s.jid === g), 'não responde no grupo');
  assert.match(out.find(s => s.jid === '258823334455@s.whatsapp.net').content.text, /expirou/);
  out = await say(g, PROOF, '845551234');
  assert.equal(out.length, 0, 'não repete o aviso');

  await platform.addPayment(r.id, {});
  assert.ok(platform.isActive(r));
  out = await say(g, 'Confirmado AB12CD34EF. Transferiste 50.00MT para 823334455. 845551234', '845551234');
  assert.ok(out.some(s => s.jid === g && /Pedido/.test(s.content.text)), 'volta a funcionar depois de pagar');
});

test('pagamento estende a partir da data de fim (não perde dias)', async () => {
  const { platform } = await setup();
  const r = await platform.createReseller({ name: 'Z', phone: '841234500', planId: 'mensal', firstPayment: {} });
  const before = r.expiresAt;
  await platform.addPayment(r.id, { days: 30, amount: 450 });
  assert.ok(Math.abs(r.expiresAt - before - 30 * DAY) < 1000);
});

test('privado: revendedor dá comandos, cliente é encaminhado, desconhecido recebe resposta genérica', async () => {
  const { platform, newGroup, say } = await setup();
  const r = await platform.createReseller({ name: 'Zé', phone: '841112233', planId: 'mensal', firstPayment: {} });
  const g = newGroup('G');
  await say(g, `!ativar ${r.inviteCode}`, '841112233');

  let out = await say('258841112233@s.whatsapp.net', 'assinatura', '841112233');
  assert.match(out[0].content.text, /Mensal/);
  assert.match(out[0].content.text, /Para renovar/);

  await say(g, 'olá', '845559999'); // cliente passa a estar associado ao revendedor
  out = await say('258845559999@s.whatsapp.net', 'menu', '845559999');
  assert.match(out[0].content.text, /Pacotes disponíveis/);

  out = await say('258849998877@s.whatsapp.net', 'oi', '849998877');
  assert.match(out[0].content.text, /grupo do teu vendedor/);
  out = await say('258849998877@s.whatsapp.net', 'oi de novo', '849998877');
  assert.equal(out.length, 0, 'resposta genérica só de vez em quando');
});

test('revendedor desactiva um grupo e liberta o lugar', async () => {
  const { platform, newGroup, say } = await setup();
  const r = await platform.createReseller({ name: 'C', phone: '847770000', planId: 'semanal', firstPayment: {} });
  const g1 = newGroup('1');
  await say(g1, `!ativar ${r.inviteCode}`, '847770000');
  await say(g1, '!desativar', '847770000');
  assert.equal(platform.group(g1).active, false);
  const out = await say(newGroup('2'), `!ativar ${r.inviteCode}`, '847770000');
  assert.match(out[0].content.text, /Bot activado/);
});

test('cliente não pode desactivar o grupo', async () => {
  const { platform, newGroup, say } = await setup();
  const r = await platform.createReseller({ name: 'C', phone: '847770001', planId: 'mensal', firstPayment: {} });
  const g = newGroup('1');
  await say(g, `!ativar ${r.inviteCode}`, '847770001');
  await say(g, '!desativar', '845551234');
  assert.equal(platform.group(g).active, true);
});

test('lembrete de renovação 3 dias antes', async () => {
  const { platform, sock } = await setup();
  const r = await platform.createReseller({ name: 'C', phone: '847770002', planId: 'mensal', firstPayment: {} });
  r.expiresAt = Date.now() + 2 * DAY;
  sock.sent.length = 0;
  await platform.tick();
  assert.ok(sock.sent.some(s => s.jid === '258847770002@s.whatsapp.net' && /termina/.test(s.content.text)));
  sock.sent.length = 0;
  await platform.tick();
  assert.ok(!sock.sent.some(s => /termina/.test(s.content.text || '')), 'só uma vez');
});

// ------------------------------------------------------------ PostgreSQL real (PGlite)
let pgServer, pgDb, pgPool;
before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  pgDb = await PGlite.create();
  pgServer = new PGLiteSocketServer({ db: pgDb, port: 55433 });
  await pgServer.start();
  const pg = (await import('pg')).default;
  pgPool = new pg.Pool({ connectionString: 'postgres://postgres@127.0.0.1:55433/postgres', max: 1 });
});
after(async () => { await pgPool?.end(); await pgServer?.stop(); await pgDb?.close(); });

test('Supabase/PostgreSQL: esquema, gravação e recarga dos dados', async () => {
  const pool = pgPool;
  const repo = new PgRepo(pool);
  await repo.migrate();
  await repo.migrate(); // pode correr duas vezes

  const { platform, newGroup, say } = await setup(repo);
  const r = await platform.createReseller({ name: 'Zé', phone: '841112233', planId: 'mensal', firstPayment: { method: 'M-Pesa', reference: 'ABC' } });
  const g = newGroup('Megas do Zé');
  await say(g, `!ativar ${r.inviteCode}`, '841112233');
  await say(g, PROOF, '845551234', 'Ana');
  await say(g, 'denunciar 847778899 burla', '845551234');
  platform.fraud.ban('826665544', { tenant: r.id, reason: 'falso' });
  platform.updateReseller(r.id, { config: { packages: [{ name: '1GB', price: 50 }] } });
  await repo.flush();
  assert.equal(repo.errors, 0);

  // Recarregar tudo a partir da base de dados
  const again = await new PgRepo(pool).load();
  const r2 = again.resellers.find(x => x.id === r.id);
  assert.equal(r2.inviteCode, r.inviteCode);
  assert.equal(r2.planId, 'mensal');
  assert.ok(Math.abs(r2.expiresAt - r.expiresAt) < 5);
  assert.deepEqual(r2.config.packages, [{ name: '1GB', price: 50 }]);
  assert.equal(again.groups.find(x => x.jid === g).resellerId, r.id);
  assert.equal(again.orders[r.id][0].targetPhone, '845551234');
  assert.equal(again.payments[0].reference, 'ABC');
  assert.equal(again.fraud.reports[0].phone, '847778899');
  assert.ok(again.fraud.banned['826665544']);
  assert.equal(again.settings.owner.phone, '845550000');
  assert.equal(again.plans.length, 3);

  // comprovativo repetido é bloqueado pela base de dados também (índice único)
  const idx = await pool.query("select indexdef from pg_indexes where indexname = 'orders_tx_unique'");
  assert.match(idx.rows[0].indexdef, /UNIQUE INDEX .* \(reseller_id, tx_id\)/);
});

test('sessão do WhatsApp guardada no Supabase/PostgreSQL', async () => {
  const { PgAuthStore, useStoreAuthState } = await import('../src/wa-auth.js');
  const baileys = await import('baileys');
  const pool = pgPool;
  await new PgRepo(pool).migrate();
  const store = new PgAuthStore(pool);
  assert.equal(await store.has('841000000'), false);
  const a = await useStoreAuthState(store, '841000000', baileys);
  await a.saveCreds();
  await a.state.keys.set({ 'pre-key': { 1: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5]) }, 2: null } });
  assert.equal(await store.has('841000000'), true);
  // "reiniciar o servidor": ler tudo outra vez
  const b = await useStoreAuthState(store, '841000000', baileys);
  assert.deepEqual(b.state.creds.noiseKey.public, a.state.creds.noiseKey.public);
  const k = await b.state.keys.get('pre-key', ['1', '2']);
  assert.deepEqual([...k['1'].public], [1, 2, 3]);
  assert.equal(k['2'], null);
  await store.clear('841000000');
  assert.equal(await store.has('841000000'), false);
});
