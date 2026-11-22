// Um "tenant" = um vendedor com o seu WhatsApp ligado ao sistema.
// Cada um tem a sua pasta: data/tenants/<numero>/{auth/, config.json, db.json}
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import { Bot } from './bot.js';
import { Store } from './store.js';
import { normalizePhone } from './parser.js';
import { defaultConfig } from './defaults.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

const phoneOf = jid => {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return null;
  return normalizePhone(jid.split('@')[0].split(':')[0]);
};
const bare = jid => (jid || '').split('@')[0].split(':')[0];

export class Tenant extends EventEmitter {
  /**
   * @param {string} phone  9 dígitos (ex: 841234567)
   * @param {object} deps   { dataDir, fraud, ai, socketFactory }
   */
  constructor(phone, deps) {
    super();
    this.phone = phone;
    this.deps = deps;
    this.dir = path.join(deps.dataDir, 'tenants', phone);
    fs.mkdirSync(this.dir, { recursive: true });
    this.configFile = path.join(this.dir, 'config.json');
    this.config = fs.existsSync(this.configFile)
      ? { ...defaultConfig(phone), ...JSON.parse(fs.readFileSync(this.configFile, 'utf8')) }
      : defaultConfig(phone);
    this.store = new Store(path.join(this.dir, 'db.json'));
    this.bot = new Bot(this.config, this.store, {
      fraud: deps.fraud, ai: deps.ai, tenantId: phone, saveConfig: () => this.saveConfig(),
    });
    this.status = 'desligado'; // desligado | a_ligar | aguarda_codigo | ligado | sessao_terminada
    this.pairingCode = null;
    this.sock = null;
    this.myJids = new Set();
    this.sentByBot = new Set();
    this.groupCache = new Map();
    this.saveConfig();
  }

  get registered() { return fs.existsSync(path.join(this.dir, 'auth', 'creds.json')) && this._registered !== false; }

  saveConfig() {
    fs.writeFileSync(this.configFile + '.tmp', JSON.stringify(this.config, null, 2));
    fs.renameSync(this.configFile + '.tmp', this.configFile);
    this.bot.refreshNumbers();
  }

  updateConfig(patch) {
    const allowed = ['businessName', 'admins', 'paymentAccounts', 'packages', 'hours', 'minutesPerOrder', 'reminderMinutes',
      'acceptImageProofs', 'replyUnknownInPrivate', 'privateChats', 'ai', 'maxWarnings', 'autoAlertReports', 'groupSettings', 'groups'];
    for (const k of allowed) if (k in patch) this.config[k] = patch[k];
    this.saveConfig();
  }

  setStatus(s) { this.status = s; this.emit('status', s); }

  /** Liga ao WhatsApp. Se ainda não estiver registado, pede um código de ligação. */
  async start() {
    if (this.sock) return;
    this.stopped = false;
    this.setStatus('a_ligar');
    const sock = this.sock = await this.deps.socketFactory(path.join(this.dir, 'auth'), logger);
    this._registered = !!sock.authState?.creds?.registered;

    sock.ev.on('creds.update', sock.saveCreds || (() => {}));
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr && !this._registered && !this.pairingCode) {
        try {
          this.pairingCode = await sock.requestPairingCode(`258${this.phone}`);
          this.setStatus('aguarda_codigo');
        } catch (e) {
          logger.error(e, 'pairing');
          this.emit('error', e);
        }
      }
      if (connection === 'open') {
        this._registered = true;
        this.pairingCode = null;
        this.myJids = new Set([sock.user?.id, sock.user?.lid].filter(Boolean).map(bare));
        this.setStatus('ligado');
        console.log(`✅ [${this.phone}] ligado`);
      }
      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        this.sock = null;
        if (code === 401 /* loggedOut */) {
          this._registered = false;
          fs.rmSync(path.join(this.dir, 'auth'), { recursive: true, force: true });
          this.setStatus('sessao_terminada');
          console.log(`❌ [${this.phone}] sessão terminada no telemóvel`);
          return;
        }
        if (this.stopped) return this.setStatus('desligado');
        // 515 = reiniciar após ligação inicial; outros = falha de rede
        this.setStatus('a_ligar');
        setTimeout(() => this.start().catch(e => logger.error(e)), code === 515 ? 500 : 3000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) await this.onMessage(m).catch(e => logger.error(e, 'msg'));
    });

    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
      if (action !== 'add') return;
      const list = participants.map(p => (typeof p === 'string' ? { id: p } : p))
        .map(p => ({ jid: p.id, phone: phoneOf(p.phoneNumber) || phoneOf(p.id) }));
      await this.run(this.bot.onJoin(id, list));
    });
  }

  async stop() {
    this.stopped = true;
    try { this.sock?.end?.(undefined); } catch { /* ignora */ }
    this.sock = null;
    this.setStatus('desligado');
  }

  /** Desliga o WhatsApp do sistema (remove o dispositivo ligado). */
  async unlink() {
    this.stopped = true;
    try { await this.sock?.logout(); } catch { /* ignora */ }
    this.sock = null;
    this._registered = false;
    fs.rmSync(path.join(this.dir, 'auth'), { recursive: true, force: true });
    this.setStatus('desligado');
  }

  async listGroups() {
    if (!this.sock || this.status !== 'ligado') return [];
    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => {
      const me = g.participants?.find(p => this.myJids.has(bare(p.id)) || this.myJids.has(bare(p.lid)) || this.myJids.has(bare(p.phoneNumber)));
      return {
        id: g.id, name: g.subject, size: g.participants?.length || g.size || 0,
        botIsAdmin: !!me?.admin, enabled: (this.config.groups || []).includes(g.id),
        settings: this.config.groupSettings?.[g.id] || {},
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  async groupMeta(chatId) {
    const c = this.groupCache.get(chatId);
    if (c && Date.now() - c.at < 5 * 60000) return c.meta;
    const meta = await this.sock.groupMetadata(chatId).catch(() => null);
    if (meta) this.groupCache.set(chatId, { meta, at: Date.now() });
    return meta;
  }

  async phoneForJid(jid, chatId) {
    const direct = phoneOf(jid);
    if (direct) return direct;
    if (!chatId) return null;
    const meta = await this.groupMeta(chatId);
    const p = meta?.participants?.find(x => x.id === jid || x.lid === jid);
    return phoneOf(p?.phoneNumber) || phoneOf(p?.jid) || null;
  }

  adminJids() {
    const list = (this.config.admins || []).map(normalizePhone).filter(Boolean).map(p => `258${p}@s.whatsapp.net`);
    return list.length ? list : [`258${this.phone}@s.whatsapp.net`];
  }

  remember(r) {
    if (!r?.key?.id) return;
    this.sentByBot.add(r.key.id);
    if (this.sentByBot.size > 2000) this.sentByBot.delete(this.sentByBot.values().next().value);
  }

  async onMessage(m) {
    if (!m.message || m.key.remoteJid === 'status@broadcast') return;
    if (m.key.fromMe && this.sentByBot.has(m.key.id)) return; // eco do próprio bot
    const chatId = m.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    if (isGroup && !(this.config.groups || []).includes(chatId)) return; // só grupos activados no painel
    if (!isGroup && this.config.privateChats === false) return;

    const msg = m.message.ephemeralMessage?.message || m.message.viewOnceMessage?.message || m.message;
    const text = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.caption || '';
    const hasImage = !!(msg.imageMessage || msg.documentMessage?.mimetype?.startsWith('image/'));
    if (!text && !hasImage) return;
    const ctx = msg.extendedTextMessage?.contextInfo || msg.imageMessage?.contextInfo || {};

    const senderJid = isGroup ? m.key.participant : chatId;
    const customerPhone = phoneOf(m.key.participantAlt) || phoneOf(m.key.remoteJidAlt) || await this.phoneForJid(senderJid, isGroup ? chatId : null);
    const admins = new Set((this.config.admins || []).map(normalizePhone).filter(Boolean));
    const isAdmin = !!m.key.fromMe || (customerPhone && admins.has(customerPhone));

    const isMe = j => j && this.myJids.has(bare(j));
    const mentioned = ctx.mentionedJid || [];
    const targets = [];
    for (const j of mentioned.filter(j => !isMe(j))) targets.push({ jid: j, phone: await this.phoneForJid(j, chatId) });
    if (ctx.participant && !isMe(ctx.participant) && !targets.length) {
      targets.push({ jid: ctx.participant, phone: await this.phoneForJid(ctx.participant, chatId) });
    }

    const actions = await this.bot.handle({
      chatId, isGroup, userKey: senderJid, userJid: senderJid, customerPhone, isAdmin, fromMe: !!m.key.fromMe,
      customerName: m.pushName || null, text, hasImage, targets,
      mentionsBot: mentioned.some(isMe), replyToBot: isMe(ctx.participant),
      ref: m, quoteRef: { key: m.key, message: { conversation: text || '🖼️ comprovativo' } },
    });
    if (actions.length) this.emit('activity', { chatId, from: customerPhone || senderJid, text: text.slice(0, 80), actions: actions.length });
    await this.run(actions);
  }

  async run(actions) {
    const sock = this.sock;
    if (!sock) return;
    for (const a of actions) {
      try {
        switch (a.type) {
          case 'reply':
            this.remember(await sock.sendMessage(a.chatId, { text: a.text, mentions: a.mentions }, a.quote ? { quoted: a.quote } : undefined));
            break;
          case 'send':
            this.remember(await sock.sendMessage(a.chatId, { text: a.text, mentions: a.mentions }));
            break;
          case 'admin':
            for (const j of this.adminJids()) this.remember(await sock.sendMessage(j, { text: a.text }));
            break;
          case 'forwardToAdmins':
            if (a.ref) for (const j of this.adminJids()) this.remember(await sock.sendMessage(j, { forward: a.ref }));
            break;
          case 'delete':
            if (a.key) await sock.sendMessage(a.chatId, { delete: a.key });
            break;
          case 'mentionAll': {
            const meta = await this.groupMeta(a.chatId);
            const mentions = (meta?.participants || []).map(p => p.id);
            this.remember(await sock.sendMessage(a.chatId, { text: a.text, mentions }));
            break;
          }
          case 'group':
            if (a.op === 'remove' || a.op === 'add') await sock.groupParticipantsUpdate(a.chatId, a.jids, a.op);
            else await sock.groupSettingUpdate(a.chatId, a.op);
            break;
        }
      } catch (e) {
        logger.warn({ err: e.message, action: a.type }, 'acção falhou');
        if (a.type === 'group' && !a.silent) {
          await sock.sendMessage(a.chatId, { text: '⚠️ Não consegui fazer isso. O bot precisa de ser *administrador* do grupo.' }).catch(() => {});
        }
      }
    }
  }

  /** Envia uma mensagem para o próprio número (usado no código de login). */
  async sendToSelf(text) {
    if (!this.sock) throw new Error('não ligado');
    this.remember(await this.sock.sendMessage(`258${this.phone}@s.whatsapp.net`, { text }));
  }

  // Acções a partir do painel web
  async completeOrder(id) {
    const { out, done } = this.bot.completeOrders([Number(id)]);
    await this.run(out);
    return done.length > 0;
  }
  async rejectOrder(id, reason) {
    const a = this.bot.rejectOrder(id, reason);
    if (a) await this.run([a]);
    return !!a;
  }
  async ban(phone, reason) {
    await this.run(this.bot.banActions({ phone, jid: `258${phone}@s.whatsapp.net` }, reason, null).slice(1));
  }
  async tick() { if (this.status === 'ligado') await this.run(this.bot.tick()); }
}
