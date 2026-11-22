// Arranque: painel web + bots de todos os vendedores.
//   npm start            → modo real (WhatsApp)
//   DEMO=1 npm start     → modo demonstração (sem WhatsApp, para ver o painel)
import path from 'node:path';
import { FraudRegistry } from './fraud.js';
import { AIClient } from './ai.js';
import { Manager } from './manager.js';
import { createServer } from './server.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = process.env.DATA_DIR || path.join(ROOT, 'data');
const port = Number(process.env.PORT || 3000);
const demo = process.env.DEMO === '1';

let socketFactory;
if (demo) {
  ({ fakeSocketFactory: socketFactory } = await import('./fake-socket.js'));
  console.log('🧪 MODO DEMONSTRAÇÃO: o WhatsApp é simulado.');
} else {
  const baileys = await import('baileys');
  const makeWASocket = baileys.default;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = baileys;
  let version;
  socketFactory = async (authDir, logger) => {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    version ||= (await fetchLatestBaileysVersion().catch(() => ({}))).version;
    const sock = makeWASocket({ auth: state, logger, version, browser: Browsers.ubuntu('Chrome'), markOnlineOnConnect: false });
    sock.saveCreds = saveCreds;
    return sock;
  };
}

const ai = new AIClient({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY || process.env.NVIDIA_API_KEY,
  model: process.env.AI_MODEL,
});
console.log(ai.enabled ? `🤖 IA activa (${ai.model})` : '🤖 IA desligada (define NVIDIA_API_KEY para activar)');

const fraud = new FraudRegistry(path.join(dataDir, 'fraud.json'));
const manager = new Manager({ dataDir, fraud, ai, socketFactory });
await manager.loadAll();

createServer(manager, { fraud }).listen(port, () => {
  console.log(`🌐 Painel em http://localhost:${port}`);
});
