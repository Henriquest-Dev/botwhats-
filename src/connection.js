// Ligação de UM número de bot ao WhatsApp. Um número pode servir muitos grupos
// de muitos revendedores. Quem decide o que fazer com cada mensagem é a Platform.
import { EventEmitter } from 'node:events';
import { normalizePhone } from './parser.js';

export const phoneOf = jid => {
  if (!jid || !String(jid).endsWith('@s.whatsapp.net')) return null;
  return normalizePhone(jid.split('@')[0].split(':')[0]);
};
export const bare = jid => (jid || '').split('@')[0].split(':')[0];
export const jidOfPhone = phone => `258${phone}@s.whatsapp.net`;

export class BotConnection extends EventEmitter {
  constructor(phone, { authStore, socketFactory, logger }) {
    super();
    this.phone = phone;
    this.authStore = authStore;
    this.socketFactory = socketFactory;
    this.logger = logger || console;
    this.status = 'desligado'; // desligado | a_ligar | aguarda_codigo | ligado | sessao_terminada
    this.pairingCode = null;
    this.sock = null;
    this.myJids = new Set();
    this.sentByBot = new Set();
    this.groupCache = new Map();
  }

  hasSession() { return this.authStore.has(this.phone); }

  setStatus(s) { this.status = s; this.emit('status', s); }

  async start() {
    if (this.sock) return;
    this.stopped = false;
    this.setStatus('a_ligar');
    const sock = this.sock = await this.socketFactory({ phone: this.phone, authStore: this.authStore, logger: this.logger });
    let registered = !!sock.authState?.creds?.registered;

    sock.ev.on('creds.update', sock.saveCreds || (() => {}));
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !registered && !this.pairingCode) {
        try {
          this.pairingCode = await sock.requestPairingCode(`258${this.phone}`);
          this.setStatus('aguarda_codigo');
        } catch (e) {
          this.logger.error?.({ err: e.message }, 'pairing');
          this.emit('pairing_error', e);
        }
      }
      if (connection === 'open') {
        registered = true;
        this.pairingCode = null;
        this.myJids = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(bare));
        this.setStatus('ligado');
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        this.sock = null;
        if (code === 401) {
          await this.authStore.clear(this.phone).catch(() => {});
          this.pairingCode = null;
          return this.setStatus('sessao_terminada');
        }
        if (this.stopped) return this.setStatus('desligado');
        this.setStatus('a_ligar');
        setTimeout(() => this.start().catch(e => this.logger.error?.(e)), code === 515 ? 500 : 3000);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        if (!m.message || m.key.remoteJid === 'status@broadcast') continue;
        if (m.key.fromMe && this.sentByBot.has(m.key.id)) continue; // eco do próprio bot
        this.emit('message', m);
      }
    });

    sock.ev.on('group-participants.update', ({ id, participants, action }) => {
      if (action !== 'add') return;
      const list = participants.map(p => (typeof p === 'string' ? { id: p } : p))
        .map(p => ({ jid: p.id, phone: phoneOf(p.phoneNumber) || phoneOf(p.id) }));
      this.emit('join', { chatId: id, participants: list });
    });
  }

  async stop() {
    this.stopped = true;
    try { this.sock?.end?.(undefined); } catch { /* ignora */ }
    this.sock = null;
    this.setStatus('desligado');
  }

  async unlink() {
    this.stopped = true;
    try { await this.sock?.logout(); } catch { /* ignora */ }
    this.sock = null;
    await this.authStore.clear(this.phone).catch(() => {});
    this.setStatus('desligado');
  }

  isMe(jid) { return !!jid && this.myJids.has(bare(jid)); }

  async groupMeta(chatId, fresh = false) {
    const c = this.groupCache.get(chatId);
    if (!fresh && c && Date.now() - c.at < 5 * 60000) return c.meta;
    const meta = await this.sock?.groupMetadata(chatId).catch(() => null);
    if (meta) this.groupCache.set(chatId, { meta, at: Date.now() });
    return meta;
  }

  async isGroupAdmin(chatId) {
    const meta = await this.groupMeta(chatId, true);
    const me = meta?.participants?.find(p => this.isMe(p.id) || this.isMe(p.lid) || this.isMe(p.phoneNumber));
    return !!me?.admin;
  }

  async phoneForJid(jid, chatId) {
    const direct = phoneOf(jid);
    if (direct) return direct;
    if (!chatId) return null;
    const meta = await this.groupMeta(chatId);
    const p = meta?.participants?.find(x => x.id === jid || x.lid === jid);
    return phoneOf(p?.phoneNumber) || phoneOf(p?.jid) || null;
  }

  remember(r) {
    if (!r?.key?.id) return;
    this.sentByBot.add(r.key.id);
    if (this.sentByBot.size > 5000) this.sentByBot.delete(this.sentByBot.values().next().value);
  }

  async send(jid, content, opts) {
    if (!this.sock) throw new Error(`bot ${this.phone} desligado`);
    const r = await this.sock.sendMessage(jid, content, opts);
    this.remember(r);
    return r;
  }

  /** Executa uma acção do bot. `adminJids` = para onde vão os avisos ao vendedor. */
  async exec(a, adminJids) {
    switch (a.type) {
      case 'reply':
        return this.send(a.chatId, { text: a.text, mentions: a.mentions }, a.quote ? { quoted: a.quote } : undefined);
      case 'send':
        return this.send(a.chatId, { text: a.text, mentions: a.mentions });
      case 'admin':
        for (const j of adminJids) await this.send(j, { text: a.text });
        return;
      case 'forwardToAdmins':
        if (a.ref) for (const j of adminJids) await this.send(j, { forward: a.ref });
        return;
      case 'delete':
        if (a.key) await this.sock.sendMessage(a.chatId, { delete: a.key });
        return;
      case 'mentionAll': {
        const meta = await this.groupMeta(a.chatId);
        return this.send(a.chatId, { text: a.text, mentions: (meta?.participants || []).map(p => p.id) });
      }
      case 'group':
        if (a.op === 'remove' || a.op === 'add') return this.sock.groupParticipantsUpdate(a.chatId, a.jids, a.op);
        return this.sock.groupSettingUpdate(a.chatId, a.op);
      default:
    }
  }

  async listGroups() {
    if (!this.sock || this.status !== 'ligado') return [];
    return Object.values(await this.sock.groupFetchAllParticipating());
  }
}
