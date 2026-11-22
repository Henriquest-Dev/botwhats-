// Gere todos os vendedores (tenants) e o login do painel web.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Tenant } from './tenant.js';

const LOGIN_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 3600 * 1000;

export class Manager {
  constructor({ dataDir, fraud, ai, socketFactory }) {
    this.deps = { dataDir, fraud, ai, socketFactory };
    this.tenants = new Map();
    this.logins = new Map();
    this.activity = new Map();
    this.sessionsFile = path.join(dataDir, 'sessions.json');
    this.sessions = fs.existsSync(this.sessionsFile) ? JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8')) : {};
    setInterval(() => this.tickAll(), 60_000).unref();
  }

  get(phone) {
    let t = this.tenants.get(phone);
    if (!t) {
      t = new Tenant(phone, this.deps);
      t.on('activity', a => {
        const list = this.activity.get(phone) || [];
        list.unshift({ ...a, at: Date.now() });
        this.activity.set(phone, list.slice(0, 50));
      });
      this.tenants.set(phone, t);
    }
    return t;
  }

  /** Arranca todos os vendedores que já fizeram login antes. */
  async loadAll() {
    const dir = path.join(this.deps.dataDir, 'tenants');
    if (!fs.existsSync(dir)) return;
    for (const phone of fs.readdirSync(dir)) {
      if (fs.existsSync(path.join(dir, phone, 'auth', 'creds.json'))) {
        this.get(phone).start().catch(e => console.error(`[${phone}]`, e.message));
      }
    }
  }

  async tickAll() {
    for (const t of this.tenants.values()) await t.tick().catch(() => {});
  }

  waitFor(t, cond, ms) {
    return new Promise(resolve => {
      if (cond()) return resolve(true);
      const timer = setTimeout(() => { t.off('status', check); resolve(cond()); }, ms);
      const check = () => { if (cond()) { clearTimeout(timer); t.off('status', check); resolve(true); } };
      t.on('status', check);
    });
  }

  /**
   * Passo 1 do login.
   * - Número novo → pede ao WhatsApp um código de ligação (8 letras) que a pessoa escreve no telemóvel.
   * - Número já ligado → envia um código de 6 dígitos para o próprio WhatsApp da pessoa.
   */
  async beginLogin(phone) {
    const t = this.get(phone);
    const loginId = crypto.randomBytes(16).toString('hex');

    if (t.registered && t.status !== 'ligado') {
      await t.start().catch(() => {});
      await this.waitFor(t, () => t.status === 'ligado' || t.status === 'sessao_terminada', 20_000);
    }

    if (t.status === 'ligado') {
      const otp = String(crypto.randomInt(100000, 1000000));
      await t.sendToSelf(`🔐 Código de acesso ao painel do bot: *${otp}*\n\nVálido por 10 minutos. Não partilhes este código com ninguém.`);
      this.logins.set(loginId, { phone, mode: 'otp', otp, tries: 0, at: Date.now() });
      return { loginId, mode: 'otp' };
    }

    // Ligar dispositivo novo
    if (t.sock && !t.pairingCode) await t.stop();
    t.pairingCode = null;
    await t.start();
    await this.waitFor(t, () => !!t.pairingCode || t.status === 'ligado', 25_000);
    if (!t.pairingCode && t.status !== 'ligado') throw new Error('Não consegui obter o código do WhatsApp. Tenta outra vez daqui a pouco.');
    this.logins.set(loginId, { phone, mode: 'pairing', at: Date.now() });
    return { loginId, mode: 'pairing', code: t.pairingCode };
  }

  /** Passo 2 (ligação nova): o browser vai perguntando até o WhatsApp ficar ligado. */
  loginStatus(loginId) {
    const l = this.logins.get(loginId);
    if (!l || Date.now() - l.at > LOGIN_TTL) return { status: 'expirado' };
    const t = this.get(l.phone);
    if (l.mode === 'pairing' && t.status === 'ligado') {
      this.logins.delete(loginId);
      return { status: 'ligado', token: this.createSession(l.phone) };
    }
    return { status: t.status, code: t.pairingCode };
  }

  /** Passo 2 (já ligado): verificar o código de 6 dígitos. */
  verifyOtp(loginId, code) {
    const l = this.logins.get(loginId);
    if (!l || l.mode !== 'otp' || Date.now() - l.at > LOGIN_TTL) return { error: 'Código expirado. Pede um novo.' };
    if (++l.tries > 5) { this.logins.delete(loginId); return { error: 'Demasiadas tentativas. Pede um novo código.' }; }
    const ok = String(code).trim().length === l.otp.length
      && crypto.timingSafeEqual(Buffer.from(String(code).trim()), Buffer.from(l.otp));
    if (!ok) return { error: 'Código errado.' };
    this.logins.delete(loginId);
    return { token: this.createSession(l.phone) };
  }

  createSession(phone) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions[token] = { phone, at: Date.now() };
    this.saveSessions();
    return token;
  }

  sessionPhone(token) {
    const s = token && this.sessions[token];
    if (!s || Date.now() - s.at > SESSION_TTL) return null;
    return s.phone;
  }

  endSession(token) { delete this.sessions[token]; this.saveSessions(); }

  saveSessions() {
    fs.mkdirSync(path.dirname(this.sessionsFile), { recursive: true });
    fs.writeFileSync(this.sessionsFile, JSON.stringify(this.sessions));
  }
}
