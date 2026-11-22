import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Bot } from '../src/bot.js';
import { Store } from '../src/store.js';
import { parseProof, findPhones } from '../src/parser.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url)));
cfg.hours = null;

const MPESA = 'Confirmado DK47HJ2X9P. Transferiste 50.00MT para 841234567 - JOAO MABUNDA aos 22/11/26 as 10:15. Taxa foi 0.00MT. O teu saldo M-Pesa e 1,200.00MT.';
const EMOLA = 'ID da transacao: PP261122.1015.A88213. Transferiste 90.00MT para conta 861234567, nome: JOAO MABUNDA as 10:15:00 de 22/11/2026. Taxa: 0.00MT.';

const mk = () => new Bot(cfg, new Store(null));
const client = (over = {}) => ({
  chatId: '1203@g.us', isGroup: true, userKey: 'u1@lid', customerPhone: '845556677',
  customerName: 'Ana', isAdmin: false, text: '', hasImage: false, quoteRef: { id: 'q' }, ...over,
});
const admin = text => ({ chatId: '258841234567@s.whatsapp.net', isGroup: false, userKey: 'adm', isAdmin: true, fromMe: true, text });

test('lê comprovativo M-Pesa', () => {
  assert.deepEqual(parseProof(MPESA), { provider: 'M-Pesa', txId: 'DK47HJ2X9P', amount: 50, recipient: '841234567' });
});

test('lê comprovativo e-Mola', () => {
  assert.deepEqual(parseProof(EMOLA), { provider: 'e-Mola', txId: 'PP261122.1015.A88213', amount: 90, recipient: '861234567' });
});

test('mensagem normal não é comprovativo', () => {
  assert.equal(parseProof('bom dia pessoal, alguém tem megas?'), null);
});

test('encontra números em vários formatos', () => {
  assert.deepEqual(findPhones('manda para +258 84 999 8877 ou 87-111-2222'), ['849998877', '871112222']);
});

test('fluxo completo: comprovativo + número → aguarde → ok → cliente avisado', () => {
  const bot = mk();
  const a = bot.handle(client({ text: MPESA + '\n\nNúmero: 849998877' }));
  const r = a.find(x => x.type === 'reply');
  assert.match(r.text, /Pedido \*#1\*/);
  assert.match(r.text, /aguarda/i);
  assert.match(r.text, /1GB Vodacom/);
  assert.match(r.text, /849998877/);
  assert.match(a.find(x => x.type === 'admin').text, /ok 1/);

  const done = bot.handle(admin('ok 1'));
  const toClient = done.find(x => x.chatId === '1203@g.us');
  assert.match(toClient.text, /concluído/);
  assert.equal(bot.store.getOrder(1).status, 'concluido');
});

test('comprovativo repetido é bloqueado', () => {
  const bot = mk();
  bot.handle(client({ text: MPESA + ' 849998877' }));
  const a = bot.handle(client({ userKey: 'outro', text: MPESA + ' 821112233' }));
  assert.match(a[0].text, /já foi usado/);
  assert.equal(bot.store.data.orders.length, 1);
});

test('sem número: bot pergunta, cliente responde SIM', () => {
  const bot = mk();
  const a = bot.handle(client({ text: MPESA }));
  assert.match(a[0].text, /Para qual número/);
  const b = bot.handle(client({ text: 'sim' }));
  assert.match(b[0].text, /845556677/);
  assert.equal(bot.store.getOrder(1).status, 'pendente');
});

test('número primeiro, comprovativo depois', () => {
  const bot = mk();
  assert.deepEqual(bot.handle(client({ text: '84 999 8877' })), []);
  const a = bot.handle(client({ text: EMOLA }));
  assert.match(a[0].text, /849998877/);
  assert.match(a[0].text, /2GB Vodacom/);
});

test('pagamento para número errado fica marcado para verificar', () => {
  const bot = mk();
  const a = bot.handle(client({ text: 'Confirmado ZZ11AA22BB. Transferiste 50.00MT para 847778899 - FULANO. 849998877' }));
  assert.ok(bot.store.getOrder(1).needsReview);
  assert.ok(a.some(x => /não é um dos nossos/.test(x.text || '')));
});

test('comprovativo em imagem é reencaminhado ao vendedor', () => {
  const bot = mk();
  const a = bot.handle(client({ hasImage: true, text: '849998877', ref: { img: 1 } }));
  assert.equal(a[0].type, 'forwardToAdmins');
  assert.match(a[1].text, /imagem/);
});

test('posição na fila e rejeição', () => {
  const bot = mk();
  bot.handle(client({ text: MPESA + ' 849998877' }));
  const a = bot.handle(client({ userKey: 'u2', text: EMOLA + ' 821234567' }));
  assert.match(a[0].text, /posição \*2\*/);
  const r = bot.handle(admin('rejeitar 2 pagamento não caiu'));
  assert.match(r[0].text, /pagamento não caiu/);
  assert.match(bot.handle(admin('fila'))[0].text, /#1/);
});

test('mensagens normais no grupo são ignoradas', () => {
  assert.deepEqual(mk().handle(client({ text: 'alguém vende 5GB?' })), []);
});

test('lembrete ao vendedor de pedidos parados', () => {
  let t = Date.now();
  const bot = new Bot(cfg, new Store(null), () => t);
  bot.handle(client({ text: MPESA + ' 849998877' }));
  bot.store.getOrder(1).createdAt = t;
  t += 11 * 60000;
  assert.match(bot.tick()[0].text, /#1/);
  assert.deepEqual(bot.tick(), []); // não repete logo
});
