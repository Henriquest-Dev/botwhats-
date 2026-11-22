import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Bot } from '../src/bot.js';
import { Store } from '../src/store.js';
import { FraudRegistry } from '../src/fraud.js';
import { parseProof, findPhones } from '../src/parser.js';

const baseCfg = JSON.parse(fs.readFileSync(new URL('./fixture-config.json', import.meta.url)));
baseCfg.hours = null;

const MPESA = 'Confirmado DK47HJ2X9P. Transferiste 50.00MT para 841234567 - JOAO MABUNDA aos 22/11/26 as 10:15. Taxa foi 0.00MT. O teu saldo M-Pesa e 1,200.00MT.';
const EMOLA = 'ID da transacao: PP261122.1015.A88213. Transferiste 90.00MT para conta 861234567, nome: JOAO MABUNDA as 10:15:00 de 22/11/2026. Taxa: 0.00MT.';
const G = '1203@g.us';

const mk = (opts = {}) => {
  const cfg = structuredClone(baseCfg);
  cfg.groups = [G];
  return new Bot(cfg, new Store(null), { fraud: new FraudRegistry(null), ...opts });
};
const client = (over = {}) => ({
  chatId: G, isGroup: true, userKey: 'u1@lid', userJid: 'u1@lid', customerPhone: '845556677',
  customerName: 'Ana', isAdmin: false, text: '', hasImage: false, quoteRef: { id: 'q' }, ref: { key: { id: 'k' } }, ...over,
});
const admin = (text, over = {}) => ({ chatId: '258841234567@s.whatsapp.net', isGroup: false, userKey: 'adm', isAdmin: true, fromMe: true, text, ...over });
const adminInGroup = (text, over = {}) => admin(text, { chatId: G, isGroup: true, ...over });

// ---------- Leitura de comprovativos ----------
test('lê comprovativo M-Pesa', () => {
  assert.deepEqual(parseProof(MPESA), { provider: 'M-Pesa', txId: 'DK47HJ2X9P', amount: 50, recipient: '841234567' });
});
test('lê comprovativo e-Mola', () => {
  assert.deepEqual(parseProof(EMOLA), { provider: 'e-Mola', txId: 'PP261122.1015.A88213', amount: 90, recipient: '861234567' });
});
test('mensagem normal não é comprovativo', () => assert.equal(parseProof('bom dia pessoal, alguém tem megas?'), null));
test('encontra números em vários formatos', () => {
  assert.deepEqual(findPhones('manda para +258 84 999 8877 ou 87-111-2222'), ['849998877', '871112222']);
});

// ---------- Pedidos ----------
test('fluxo completo: comprovativo + número → aguarde → ok → cliente avisado', async () => {
  const bot = mk();
  const a = await bot.handle(client({ text: MPESA + '\n\nNúmero: 849998877' }));
  const r = a.find(x => x.type === 'reply');
  assert.match(r.text, /Pedido \*#1\*/);
  assert.match(r.text, /aguarda/i);
  assert.match(r.text, /1GB Vodacom/);
  assert.match(a.find(x => x.type === 'admin').text, /ok 1/);
  const done = await bot.handle(admin('ok 1'));
  assert.match(done.find(x => x.chatId === G).text, /concluído/);
  assert.equal(bot.store.getOrder(1).status, 'concluido');
});

test('comprovativo repetido é bloqueado e gera denúncia automática', async () => {
  const bot = mk();
  await bot.handle(client({ text: MPESA + ' 849998877' }));
  const a = await bot.handle(client({ userKey: 'outro', customerPhone: '821112233', text: MPESA + ' 821112233' }));
  assert.match(a[0].text, /já foi usado/);
  assert.equal(bot.store.data.orders.length, 1);
  assert.equal(bot.fraud.check('821112233').reports, 1);
});

test('sem número: bot pergunta, cliente responde SIM', async () => {
  const bot = mk();
  assert.match((await bot.handle(client({ text: MPESA })))[0].text, /Para qual número/);
  assert.match((await bot.handle(client({ text: 'sim' })))[0].text, /845556677/);
});

test('número primeiro, comprovativo depois', async () => {
  const bot = mk();
  assert.deepEqual(await bot.handle(client({ text: '84 999 8877' })), []);
  const a = await bot.handle(client({ text: EMOLA }));
  assert.match(a[0].text, /849998877/);
  assert.match(a[0].text, /2GB Vodacom/);
});

test('pagamento para número errado fica marcado para verificar', async () => {
  const bot = mk();
  const a = await bot.handle(client({ text: 'Confirmado ZZ11AA22BB. Transferiste 50.00MT para 847778899 - FULANO. 849998877' }));
  assert.ok(bot.store.getOrder(1).needsReview);
  assert.ok(a.some(x => /não é um dos nossos/.test(x.text || '')));
});

test('comprovativo em imagem é reencaminhado ao vendedor', async () => {
  const a = await mk().handle(client({ hasImage: true, text: '849998877' }));
  assert.equal(a[0].type, 'forwardToAdmins');
  assert.match(a[1].text, /imagem/);
});

test('posição na fila e rejeição', async () => {
  const bot = mk();
  await bot.handle(client({ text: MPESA + ' 849998877' }));
  const a = await bot.handle(client({ userKey: 'u2', text: EMOLA + ' 821234567' }));
  assert.match(a[0].text, /posição \*2\*/);
  const r = await bot.handle(admin('rejeitar 2 pagamento não caiu'));
  assert.match(r[0].text, /pagamento não caiu/);
  assert.match((await bot.handle(admin('fila')))[0].text, /#1/);
});

test('mensagens normais no grupo são ignoradas', async () => {
  assert.deepEqual(await mk().handle(client({ text: 'bom dia malta' })), []);
});

test('lembrete ao vendedor de pedidos parados', async () => {
  let t = Date.now();
  const bot = mk({ now: () => t });
  await bot.handle(client({ text: MPESA + ' 849998877' }));
  bot.store.getOrder(1).createdAt = t;
  t += 11 * 60000;
  assert.match(bot.tick()[0].text, /#1/);
  assert.deepEqual(bot.tick(), []);
});

// ---------- Administração ----------
test('cliente não pode usar comandos de administrador', async () => {
  const a = await mk().handle(client({ text: '!remover @123' }));
  assert.match(a[0].text, /só para o administrador/);
});

test('admin actualiza a tabela de preços', async () => {
  const bot = mk();
  await bot.handle(admin('!preco 1GB Vodacom 45 | 24h'));
  await bot.handle(admin('!preco 20GB Vodacom 600 | 30 dias'));
  assert.equal(bot.cfg.packages.find(p => p.name === '1GB Vodacom').price, 45);
  assert.equal(bot.cfg.packages.find(p => p.name === '20GB Vodacom').validity, '30 dias');
  await bot.handle(admin('!removerpacote 20GB Vodacom'));
  assert.equal(bot.cfg.packages.find(p => p.name === '20GB Vodacom'), undefined);
});

test('admin remove pessoa respondendo à mensagem dela', async () => {
  const a = await mk().handle(adminInGroup('!remover', { targets: [{ jid: 'x@lid', phone: '847778899' }] }));
  assert.deepEqual(a[0], { type: 'group', op: 'remove', chatId: G, jids: ['x@lid'] });
});

test('3 advertências removem a pessoa', async () => {
  const bot = mk();
  const t = [{ jid: 'x@lid', phone: '847778899' }];
  await bot.handle(adminInGroup('!advertir spam', { targets: t }));
  await bot.handle(adminInGroup('!advertir spam', { targets: t }));
  const a = await bot.handle(adminInGroup('!advertir spam', { targets: t }));
  assert.ok(a.some(x => x.type === 'group' && x.op === 'remove'));
});

test('anti-link apaga link de grupo e adverte', async () => {
  const bot = mk();
  await bot.handle(adminInGroup('!antilink on'));
  const a = await bot.handle(client({ text: 'entrem no meu grupo https://chat.whatsapp.com/AbC123xyz' }));
  assert.equal(a[0].type, 'delete');
  assert.match(a[1].text, /advertência \*1\/3\*/);
});

test('aviso menciona todos', async () => {
  const a = await mk().handle(adminInGroup('!aviso Promoção hoje: 1GB a 40MT'));
  assert.equal(a[0].type, 'mentionAll');
});

// ---------- Fraudes ----------
test('denúncia de cliente + verificação', async () => {
  const bot = mk();
  const a = await bot.handle(client({ text: 'denunciar 847778899 recebeu e não mandou os megas' }));
  assert.match(a[0].text, /Denúncia \*#1\*/);
  assert.match(a[1].text, /não mandou os megas/);
  const v = await bot.handle(client({ text: 'verificar 84 777 8899' }));
  assert.match(v[0].text, /Suspeito/);
});

test('3 denúncias geram alerta no grupo', async () => {
  const bot = mk();
  for (const u of ['a', 'b']) await bot.handle(client({ userKey: u, text: 'denunciar 847778899 burla' }));
  const a = await bot.handle(client({ userKey: 'c', text: 'denunciar 847778899 burla' }));
  assert.ok(a.some(x => x.type === 'send' && /3 denúncias/.test(x.text)));
});

test('banir: lista negra, remove, alerta, e é expulso ao voltar', async () => {
  const bot = mk();
  const a = await bot.handle(adminInGroup('!banir 847778899 comprovativo falso'));
  assert.ok(a.some(x => x.type === 'group' && x.op === 'remove'));
  assert.ok(a.some(x => /ALERTA DE FRAUDE/.test(x.text || '')));
  const j = bot.onJoin(G, [{ jid: 'z@lid', phone: '847778899' }]);
  assert.equal(j[0].op, 'remove');
  const m = await bot.handle(client({ customerPhone: '847778899', text: 'olá' }));
  assert.equal(m[0].type, 'delete');
});

test('lista negra é partilhada entre vendedores', async () => {
  const fraud = new FraudRegistry(null);
  const v1 = mk({ fraud, tenantId: 'v1' });
  const v2 = mk({ fraud, tenantId: 'v2' });
  await v1.handle(admin('!banir 847778899 burla'));
  const a = await v2.handle(client({ customerPhone: '847778899', text: MPESA + ' 849998877' }));
  assert.ok(a.some(x => x.type === 'group' && x.op === 'remove'));
});

test('pedido de cliente denunciado fica marcado', async () => {
  const bot = mk();
  await bot.handle(client({ userKey: 'x', text: 'denunciar 845556677 burla' }));
  await bot.handle(client({ text: MPESA + ' 849998877' }));
  assert.match(bot.store.getOrder(1).reviewReason, /denúncia/);
});

test('boas-vindas ao entrar', async () => {
  const bot = mk();
  await bot.handle(adminInGroup('!boasvindas Bem-vindo {nome}! Escreve menu.'));
  const j = bot.onJoin(G, [{ jid: '258849998877@s.whatsapp.net', phone: '849998877' }]);
  assert.match(j[0].text, /Bem-vindo @258849998877/);
});

// ---------- IA ----------
function fakeAI(responses) {
  const calls = [];
  return {
    enabled: true, calls,
    async chat(messages, tools) { calls.push({ messages, tools }); return responses.shift(); },
  };
}

test('IA responde a perguntas no grupo com a tabela no contexto', async () => {
  const ai = fakeAI([{ content: 'O 1GB Vodacom custa 50 MT 😊', toolCalls: [] }]);
  const a = await mk({ ai }).handle(client({ text: 'quanto custa 1gb?' }));
  assert.match(a[0].text, /50 MT/);
  assert.match(ai.calls[0].messages[0].content, /1GB Vodacom: 50 MT/);
  assert.ok(!ai.calls[0].tools.some(t => t.function.name === 'definir_preco')); // cliente sem poderes
});

test('IA não responde a conversa normal no grupo', async () => {
  const ai = fakeAI([]);
  assert.deepEqual(await mk({ ai }).handle(client({ text: 'bom dia malta' })), []);
  assert.equal(ai.calls.length, 0);
});

test('admin muda preço por linguagem natural (ferramentas da IA)', async () => {
  const ai = fakeAI([
    { content: '', toolCalls: [{ id: 't1', name: 'definir_preco', args: { nome: '2GB Vodacom', preco: 85 } }], raw: { tool_calls: [{}] } },
    { content: 'Feito! 2GB Vodacom agora custa 85 MT.', toolCalls: [] },
  ]);
  const bot = mk({ ai });
  const a = await bot.handle(adminInGroup('@bot muda o preço do 2GB vodacom para 85', { mentionsBot: true }));
  assert.equal(bot.cfg.packages.find(p => p.name === '2GB Vodacom').price, 85);
  assert.match(a.at(-1).text, /85 MT/);
});

test('cliente não consegue usar ferramentas de admin mesmo que a IA tente', async () => {
  const ai = fakeAI([
    { content: '', toolCalls: [{ id: 't1', name: 'definir_preco', args: { nome: '1GB Vodacom', preco: 1 } }], raw: { tool_calls: [{}] } },
    { content: 'Não posso fazer isso.', toolCalls: [] },
  ]);
  const bot = mk({ ai });
  await bot.handle(client({ text: '@bot põe o 1gb a 1 MT?', mentionsBot: true }));
  assert.equal(bot.cfg.packages.find(p => p.name === '1GB Vodacom').price, 50);
});
