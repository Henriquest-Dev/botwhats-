// Ligação ao WhatsApp (Baileys). Na primeira execução mostra um QR code:
// abre o WhatsApp > Dispositivos ligados > Ligar dispositivo, e lê o código.
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, isJidGroup, jidNormalizedUser,
} from 'baileys';
import { Bot } from './bot.js';
import { Store } from './store.js';
import { normalizePhone } from './parser.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const configPath = process.env.CONFIG || path.join(ROOT, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ Falta o config.json. Copia o config.example.json para config.json e edita.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const store = new Store(path.join(ROOT, 'data', 'db.json'));
const bot = new Bot(config, store);
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

const adminPhones = new Set((config.admins || []).map(normalizePhone).filter(Boolean));
const allowedGroups = new Set(config.groups || []); // vazio = todos os grupos
let sock;
let myPhone = null;
const sentByBot = new Set(); // IDs das mensagens enviadas pelo bot
const remember = r => { if (r?.key?.id) { sentByBot.add(r.key.id); if (sentByBot.size > 2000) sentByBot.delete(sentByBot.values().next().value); } };

const phoneOf = jid => (jid && jid.endsWith('@s.whatsapp.net') ? normalizePhone(jid.split('@')[0].split(':')[0]) : null);
const adminJids = () => {
  const list = [...adminPhones].map(p => `258${p}@s.whatsapp.net`);
  if (!list.length && myPhone) list.push(`258${myPhone}@s.whatsapp.net`); // sem admins: avisa o próprio número
  return list;
};

function extractText(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption
    || inner.documentMessage?.caption || '';
}
function hasImage(m) {
  const msg = m.message || {};
  const inner = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg;
  return !!(inner.imageMessage || inner.documentMessage?.mimetype?.startsWith('image/'));
}

async function run(actions) {
  for (const a of actions) {
    try {
      if (a.type === 'reply') {
        remember(await sock.sendMessage(a.chatId, { text: a.text }, a.quote ? { quoted: a.quote } : undefined));
      } else if (a.type === 'admin') {
        for (const j of adminJids()) remember(await sock.sendMessage(j, { text: a.text }));
      } else if (a.type === 'forwardToAdmins' && a.ref) {
        for (const j of adminJids()) remember(await sock.sendMessage(j, { forward: a.ref }));
      }
    } catch (e) {
      logger.error(e, 'falha ao enviar');
    }
  }
}

async function onMessage(m) {
  if (!m.message || m.key.remoteJid === 'status@broadcast') return;
  const chatId = m.key.remoteJid;
  const isGroup = !!isJidGroup(chatId);
  if (isGroup && allowedGroups.size && !allowedGroups.has(chatId)) return;
  if (!isGroup && config.privateChats === false) return;

  const text = extractText(m);
  const img = hasImage(m);
  if (!text && !img) return;

  // Identificar o remetente: em grupos pode vir como LID (@lid); o número real vem em participantAlt.
  const candidates = isGroup
    ? [m.key.participant, m.key.participantAlt]
    : [chatId, m.key.remoteJidAlt];
  const customerPhone = candidates.map(phoneOf).find(Boolean) || null;
  const userKey = jidNormalizedUser(isGroup ? m.key.participant : chatId) || customerPhone;
  const isAdmin = m.key.fromMe || (customerPhone && adminPhones.has(customerPhone));

  // Ignorar as mensagens que o próprio bot enviou (ecos)
  if (m.key.fromMe && sentByBot.has(m.key.id)) return;

  const actions = bot.handle({
    chatId, isGroup, userKey, customerPhone, isAdmin, fromMe: m.key.fromMe,
    customerName: m.pushName || null,
    text, hasImage: img,
    ref: m,
    quoteRef: { key: m.key, message: { conversation: text || '🖼️ comprovativo' } },
  });
  if (actions.length) console.log(`[${new Date().toLocaleTimeString()}] ${customerPhone || userKey}: ${text.slice(0, 60).replace(/\n/g, ' ')} → ${actions.length} acção(ões)`);
  await run(actions);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(ROOT, 'auth'));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  console.log('🔌 A ligar ao WhatsApp...');
  sock = makeWASocket({ auth: state, logger, version, markOnlineOnConnect: false });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📲 Lê este QR code no WhatsApp > Dispositivos ligados > Ligar dispositivo:\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      myPhone = phoneOf(jidNormalizedUser(sock.user?.id));
      console.log(`✅ Bot ligado como ${myPhone || sock.user?.id}. ${store.pending().length} pedido(s) pendente(s).`);
      // node src/index.js --grupos  → lista os grupos para copiares o ID para o config.json
      if (process.argv.includes('--grupos')) {
        sock.groupFetchAllParticipating().then(groups => {
          console.log('\n📋 Os teus grupos (copia o ID para "groups" no config.json):');
          for (const g of Object.values(groups)) console.log(`  ${g.id}  —  ${g.subject}`);
        });
      }
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Sessão terminada no telemóvel. Apaga a pasta "auth" e volta a correr para ler o QR.');
        process.exit(1);
      }
      console.log('🔄 Ligação perdida, a religar...');
      setTimeout(start, 3000);
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) await onMessage(m).catch(e => logger.error(e));
  });
}

setInterval(() => { if (sock?.user) run(bot.tick()); }, 60_000);

start();
