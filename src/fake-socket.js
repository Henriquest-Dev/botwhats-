// Socket de demonstração: imita o WhatsApp para testar o painel sem telemóvel.
// Usa com: DEMO=1 npm start
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export async function fakeSocketFactory(authDir) {
  const credsFile = path.join(authDir, 'creds.json');
  const registered = fs.existsSync(credsFile);
  const ev = new EventEmitter();
  const phone = path.basename(path.dirname(authDir));
  const me = `258${phone}@s.whatsapp.net`;
  const groups = {
    '120363000000000001@g.us': { id: '120363000000000001@g.us', subject: 'Megas Baratos MZ 🇲🇿', participants: participants(me, 214, true) },
    '120363000000000002@g.us': { id: '120363000000000002@g.us', subject: 'Vendas Maputo — Internet', participants: participants(me, 87, true) },
    '120363000000000003@g.us': { id: '120363000000000003@g.us', subject: 'Família Mabunda', participants: participants(me, 23, false) },
  };
  const sock = {
    ev,
    authState: { creds: { registered } },
    user: { id: me },
    sent: [],
    async requestPairingCode() {
      // na demo, a ligação "acontece" sozinha após 8 segundos
      setTimeout(() => { fs.mkdirSync(authDir, { recursive: true }); fs.writeFileSync(credsFile, '{}'); ev.emit('connection.update', { connection: 'open' }); simulateCustomers(ev); }, 8000);
      return 'DEMO7K2Q';
    },
    async sendMessage(jid, content) { sock.sent.push({ jid, content }); console.log(`[demo → ${jid}]`, (content.text || '').slice(0, 70).replace(/\n/g, ' ')); return { key: { id: Math.random().toString(36).slice(2) } }; },
    async groupFetchAllParticipating() { return groups; },
    async groupMetadata(id) { return groups[id]; },
    async groupParticipantsUpdate() { return []; },
    async groupSettingUpdate() {},
    async logout() { fs.rmSync(authDir, { recursive: true, force: true }); },
    end() {},
  };
  setTimeout(() => ev.emit('connection.update', registered ? { connection: 'open' } : { qr: 'demo' }), 300);
  if (registered) setTimeout(() => simulateCustomers(ev), 1500);
  return sock;
}

function participants(me, n, admin) {
  const list = [{ id: me, admin: admin ? 'admin' : null }];
  for (let i = 1; i < n; i++) list.push({ id: `25884${String(1000000 + i).slice(1)}0@s.whatsapp.net` });
  return list;
}

// Clientes de exemplo a enviar comprovativos no privado (só na demonstração)
let simulated = false;
function simulateCustomers(ev) {
  if (simulated) return;
  simulated = true;
  const msgs = [
    ['258845551234', 'Ana Cossa', 'Confirmado DK47HJ2X9P. Transferiste 50.00MT para 841234567 - JOAO aos 22/11/26 as 10:15. Taxa foi 0.00MT.\nNumero: 845551234'],
    ['258862223344', 'Hélder M.', 'ID da transacao: PP261122.1020.A88213. Transferiste 90.00MT para conta 861234567, nome: JOAO. Para 86 222 3344'],
    ['258827778899', 'Sónia', 'Confirmado QW12ER34TY. Transferiste 200.00MT para 841234567 - JOAO. 827778899'],
  ];
  msgs.forEach(([pn, name, text], i) => setTimeout(() => ev.emit('messages.upsert', {
    type: 'notify',
    messages: [{ key: { remoteJid: `${pn}@s.whatsapp.net`, id: 'demo' + i, fromMe: false }, pushName: name, message: { conversation: text } }],
  }), 1500 + i * 1200));
}
