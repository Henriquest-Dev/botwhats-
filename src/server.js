// Servidor do painel web (sem frameworks): API JSON + ficheiros da pasta public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePhone } from './parser.js';

const PUBLIC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export function createServer(manager, { fraud }) {
  const hits = new Map(); // limite de tentativas de login por IP

  const limited = (ip, max = 8, windowMs = 10 * 60000) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < windowMs);
    list.push(now);
    hits.set(ip, list);
    return list.length > max;
  };

  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };

  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 200_000) { reject(new Error('demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('JSON inválido')); } });
  });

  const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
  const sessionCookie = (token, maxAge = 30 * 24 * 3600) =>
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.HTTPS === '1' ? '; Secure' : ''}`;

  const orderView = o => ({
    id: o.id, status: o.status, createdAt: o.createdAt, doneAt: o.doneAt, customerName: o.customerName, customerPhone: o.customerPhone,
    targetPhone: o.targetPhone, packageName: o.packageName, amount: o.amount, provider: o.provider, txId: o.txId,
    needsReview: o.needsReview, reviewReason: o.reviewReason, rejectReason: o.rejectReason, kind: o.kind,
  });

  async function api(req, res, url) {
    const method = req.method;
    const p = url.pathname;
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

    // ---------- Login ----------
    if (method === 'POST' && p === '/api/login') {
      if (limited(ip)) return json(res, 429, { error: 'Demasiadas tentativas. Espera 10 minutos.' });
      const { phone } = await readBody(req);
      const n = normalizePhone(phone);
      if (!n) return json(res, 400, { error: 'Número inválido. Usa um número moçambicano (ex: 84 123 4567).' });
      try { return json(res, 200, await manager.beginLogin(n)); }
      catch (e) { return json(res, 503, { error: e.message }); }
    }
    let m;
    if (method === 'GET' && (m = p.match(/^\/api\/login\/([a-f0-9]{32})$/))) {
      const r = manager.loginStatus(m[1]);
      if (r.token) return json(res, 200, { status: 'ligado' }, { 'Set-Cookie': sessionCookie(r.token) });
      return json(res, 200, r);
    }
    if (method === 'POST' && (m = p.match(/^\/api\/login\/([a-f0-9]{32})\/otp$/))) {
      if (limited(ip + ':otp', 15)) return json(res, 429, { error: 'Demasiadas tentativas.' });
      const r = manager.verifyOtp(m[1], (await readBody(req)).code);
      if (r.error) return json(res, 400, r);
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(r.token) });
    }

    // ---------- A partir daqui é preciso sessão ----------
    const token = cookie(req, 'sid');
    const phone = manager.sessionPhone(token);
    if (!phone) return json(res, 401, { error: 'Sessão expirada. Faz login outra vez.' });
    const t = manager.get(phone);
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'painel') return json(res, 403, { error: 'Pedido inválido.' });

    if (method === 'POST' && p === '/api/logout') {
      manager.endSession(token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (method === 'GET' && p === '/api/me') {
      const orders = t.store.data.orders;
      const today = new Date().toDateString();
      const doneToday = orders.filter(o => o.status === 'concluido' && new Date(o.doneAt).toDateString() === today);
      return json(res, 200, {
        phone, status: t.status, config: t.config, aiAvailable: !!manager.deps.ai?.enabled,
        stats: {
          pending: t.store.pending().length,
          doneToday: doneToday.length,
          revenueToday: doneToday.reduce((s, o) => s + (o.amount || 0), 0),
          totalOrders: orders.length,
          openReports: fraud.reportsOf(phone).filter(r => r.status === 'aberta').length,
        },
        activity: manager.activity.get(phone) || [],
      });
    }
    if (method === 'PUT' && p === '/api/config') {
      t.updateConfig(await readBody(req));
      return json(res, 200, { ok: true, config: t.config });
    }
    if (method === 'GET' && p === '/api/groups') {
      try { return json(res, 200, { groups: await t.listGroups() }); }
      catch (e) { return json(res, 500, { error: 'Não consegui ler os grupos: ' + e.message }); }
    }
    if (method === 'PUT' && p === '/api/groups') {
      const { groups, settings } = await readBody(req);
      if (Array.isArray(groups)) t.config.groups = groups.filter(g => typeof g === 'string' && g.endsWith('@g.us'));
      if (settings && typeof settings === 'object') {
        t.config.groupSettings ||= {};
        for (const [id, s] of Object.entries(settings)) t.config.groupSettings[id] = { ...t.config.groupSettings[id], ...s };
      }
      t.saveConfig();
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && p === '/api/orders') {
      return json(res, 200, { orders: t.store.data.orders.slice(-200).reverse().map(orderView) });
    }
    if (method === 'POST' && (m = p.match(/^\/api\/orders\/(\d+)\/(done|reject)$/))) {
      const ok = m[2] === 'done' ? await t.completeOrder(m[1]) : await t.rejectOrder(m[1], (await readBody(req)).reason);
      return json(res, ok ? 200 : 404, ok ? { ok } : { error: 'Pedido não encontrado ou já fechado.' });
    }
    if (method === 'GET' && p === '/api/fraud') {
      const banned = Object.entries(fraud.data.banned).map(([ph, b]) => ({ phone: ph, ...b, mine: b.tenant === phone })).sort((a, b) => b.at - a.at);
      return json(res, 200, { reports: fraud.reportsOf(phone).slice().reverse(), banned });
    }
    if (method === 'GET' && p === '/api/fraud/check') {
      const n = normalizePhone(url.searchParams.get('phone'));
      return n ? json(res, 200, fraud.check(n)) : json(res, 400, { error: 'Número inválido.' });
    }
    if (method === 'POST' && p === '/api/fraud/ban') {
      const { phone: ph, reason } = await readBody(req);
      const n = normalizePhone(ph);
      if (!n) return json(res, 400, { error: 'Número inválido.' });
      await t.ban(n, reason);
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && p === '/api/fraud/unban') {
      const n = normalizePhone((await readBody(req)).phone);
      const b = n && fraud.isBanned(n);
      if (!b) return json(res, 404, { error: 'Não está banido.' });
      if (b.tenant !== phone) return json(res, 403, { error: 'Só quem baniu pode desbanir.' });
      fraud.unban(n);
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && (m = p.match(/^\/api\/fraud\/reports\/(\d+)$/))) {
      const r = fraud.data.reports.find(x => x.id === Number(m[1]) && x.tenant === phone);
      if (!r) return json(res, 404, { error: 'Denúncia não encontrada.' });
      const { action } = await readBody(req);
      if (action === 'ban') await t.ban(r.phone, r.reason);
      else fraud.resolveReport(r.id, 'descartada');
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && p === '/api/unlink') {
      await t.unlink();
      manager.endSession(token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    return json(res, 404, { error: 'Não encontrado' });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      // ficheiros estáticos
      let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: e.message });
    }
  });
}
