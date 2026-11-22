// WhatsApp simulado, para a demonstração e testes (DEMO=1).
import { EventEmitter } from 'node:events';

export const fakeGroups = {}; // jid → { id, subject, participants }
export const fakeSockets = new Map(); // telefone do bot → socket

export async function fakeSocketFactory({ phone, authStore }) {
  const registered = await authStore.has(phone);
  const ev = new EventEmitter();
  const me = `258${phone}@s.whatsapp.net`;
  const sock = {
    ev, me,
    authState: { creds: { registered } },
    user: { id: me },
    sent: [],
    async requestPairingCode() {
      setTimeout(async () => { await authStore.writeMany(phone, [{ key: 'creds', value: '{}' }]); ev.emit('connection.update', { connection: 'open' }); }, 6000);
      return 'K7QD2M9X';
    },
    async sendMessage(jid, content) {
      sock.sent.push({ jid, content });
      if (process.env.DEMO_LOG) console.log(`[${phone} → ${jid}]`, (content.text || '').slice(0, 70).replace(/\n/g, ' '));
      return { key: { id: Math.random().toString(36).slice(2), remoteJid: jid, fromMe: true } };
    },
    async groupFetchAllParticipating() { return Object.fromEntries(Object.entries(fakeGroups).filter(([, g]) => g.participants.some(p => p.id === me))); },
    async groupMetadata(id) { return fakeGroups[id]; },
    async groupParticipantsUpdate() { return []; },
    async groupSettingUpdate() {},
    async logout() { await authStore.clear(phone); },
    end() {},
    /** Simula uma mensagem a chegar. */
    receive(remoteJid, text, { participant, name = 'Cliente' } = {}) {
      ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid, participant, id: Math.random().toString(36).slice(2), fromMe: false }, pushName: name, message: { conversation: text } }] });
    },
  };
  fakeSockets.set(phone, sock);
  setTimeout(() => ev.emit('connection.update', registered ? { connection: 'open' } : { qr: 'demo' }), 200);
  return sock;
}
