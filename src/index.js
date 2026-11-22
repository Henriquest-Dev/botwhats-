// Arranque: site + painel do dono + números de bot.
//   npm start         → produção (Supabase via DATABASE_URL, ou ficheiro local se não houver)
//   npm run demo      → demonstração com WhatsApp simulado e dados de exemplo
import path from 'node:path';
import pino from 'pino';
import { AIClient } from './ai.js';
import { JsonRepo, PgRepo } from './repo.js';
import { Platform } from './platform.js';
import { createServer } from './server.js';
import { FileAuthStore, PgAuthStore, useStoreAuthState } from './wa-auth.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
const port = Number(process.env.PORT || 3000);
const demo = process.env.DEMO === '1';
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

// ---- WhatsApp
let socketFactory;
if (demo) {
  ({ fakeSocketFactory: socketFactory } = await import('./fake-socket.js'));
  console.log('🧪 DEMONSTRAÇÃO: WhatsApp simulado, dados de exemplo.');
} else {
  const baileys = await import('baileys');
  const makeWASocket = baileys.default;
  const { fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore } = baileys;
  let version;
  socketFactory = async ({ phone, authStore, logger: log }) => {
    const { state, saveCreds } = await useStoreAuthState(authStore, phone, baileys);
    version ||= (await fetchLatestBaileysVersion().catch(() => ({}))).version;
    // As chaves ficam também em memória: menos idas ao Supabase, respostas mais rápidas
    const auth = { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log) };
    const sock = makeWASocket({ auth, logger: log, version, browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false });
    sock.saveCreds = saveCreds;
    return sock;
  };
}

// ---- Base de dados
let repo;
if (process.env.DATABASE_URL && !demo) {
  repo = await PgRepo.connect(process.env.DATABASE_URL);
  await repo.migrate();
  console.log('🗄️  Base de dados: Supabase/PostgreSQL');
} else {
  repo = new JsonRepo(path.join(dataDir, demo ? 'demo-state.json' : 'state.json'));
  console.log(`🗄️  Base de dados: ficheiro local${demo ? '' : ' (define DATABASE_URL para usar o Supabase)'}`);
}

// ---- IA
const ai = new AIClient({ baseURL: process.env.AI_BASE_URL, apiKey: process.env.AI_API_KEY || process.env.NVIDIA_API_KEY, model: process.env.AI_MODEL });
console.log(ai.enabled ? `🤖 IA activa (${ai.model})` : '🤖 IA desligada (define NVIDIA_API_KEY)');

// Sessões do WhatsApp: no Supabase se houver DATABASE_URL (sobrevivem a reinícios e mudanças de servidor)
const authStore = repo instanceof PgRepo ? new PgAuthStore(repo.pool) : new FileAuthStore(path.join(dataDir, 'bots'));

const platform = await new Platform({ repo, socketFactory, dataDir, authStore, ai, logger }).init();
if (demo) {
  const { seedDemo, simulateTraffic } = await import('./demo.js');
  await seedDemo(platform);
  setTimeout(() => simulateTraffic(platform), 1500);
}
await platform.startAll();
setInterval(() => platform.tick().catch(e => console.error('tick:', e.message)), 60_000);

const adminPassword = process.env.ADMIN_PASSWORD || (demo ? 'demo' : '');
if (!adminPassword) console.warn('⚠️  ADMIN_PASSWORD não definida: o painel /admin fica bloqueado.');
createServer(platform, { adminPassword, sessionSecret: process.env.SESSION_SECRET, secureCookies: process.env.HTTPS === '1' })
  .listen(port, () => console.log(`🌐 Site: http://localhost:${port}   Painel: http://localhost:${port}/admin${demo ? '  (palavra-passe: demo)' : ''}`));

// Grava tudo antes de sair
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await repo.flush?.(); process.exit(0); });
