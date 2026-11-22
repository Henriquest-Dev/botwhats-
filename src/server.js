// Servidor web: site público (para convencer revendedores) + painel do dono (/admin).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizePhone } from './parser.js';

const PUBLIC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const SESSION_HOURS = 24 * 14;

export function createServer(platform, { adminPassword, sessionSecret, secureCookies = false } = {}) {
  const secret = sessionSecret || crypto.createHash('sha256').update('botmegas:' + (adminPassword || crypto.randomUUID())).digest('hex');
  const hits = new Map();

  const limited = (key, max, windowMs = 15 * 60000) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    return list.length > max;
  };
  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  const makeToken = () => { const exp = String(Date.now() + SESSION_HOURS * 3600e3); return `${exp}.${sign(exp)}`; };
  const validToken = t => {
    const [exp, sig] = String(t || '').split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const good = sign(exp);
    return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
  };
  const cookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];
  const sessionCookie = (v, maxAge) => `adm=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  const json = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 300_000) { reject(new Error('Pedido demasiado grande.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('JSON inválido.')); } });
  });

  const resellerView = r => {
    const plan = platform.plan(r.planId);
    const orders = platform.state.orders[r.id] || [];
    return {
      id: r.id, name: r.name, phone: r.phone, planId: r.planId, planName: plan?.name || null, status: r.status,
      active: platform.isActive(r), expiresAt: r.expiresAt, inviteCode: r.inviteCode, botPhone: r.botPhone, notes: r.notes, createdAt: r.createdAt,
      groups: platform.state.groups.filter(g => g.resellerId === r.id).map(g => ({ jid: g.jid, name: g.name, active: g.active, botPhone: g.botPhone, activatedAt: g.activatedAt })),
      maxGroups: plan?.maxGroups ?? 1,
      ordersTotal: orders.length,
      ordersPending: orders.filter(o => o.status === 'pendente').length,
      volume30: orders.filter(o => o.status === 'concluido' && o.doneAt > Date.now() - 30 * 864e5).reduce((s, o) => s + (o.amount || 0), 0),
      paid: platform.state.payments.filter(p => p.resellerId === r.id).reduce((s, p) => s + p.amount, 0),
    };
  };
  const orderView = o => ({
    id: o.id, status: o.status, createdAt: o.createdAt, doneAt: o.doneAt, customerName: o.customerName, customerPhone: o.customerPhone,
    targetPhone: o.targetPhone, packageName: o.packageName, amount: o.amount, provider: o.provider, txId: o.txId, needsReview: o.needsReview, reviewReason: o.reviewReason,
  });

  // ------------------------------------------------------------ API pública
  async function publicApi(req, res, p) {
    if (req.method === 'GET' && p === '/api/public/site') {
      const o = platform.owner;
      return json(res, 200, {
        brand: platform.state.settings.site?.brand || 'BotMegas',
        contactPhone: o.phone || null,
        plans: platform.state.plans.filter(x => x.active).sort((a, b) => a.sort - b.sort || a.price - b.price)
          .map(({ id, name, price, days, maxGroups, highlight }) => ({ id, name, price, days, maxGroups, highlight })),
        stats: { banned: Object.keys(platform.fraud.data.banned).length, groups: platform.state.groups.filter(g => g.active).length },
      }, { 'Cache-Control': 'public, max-age=60' });
    }
    return json(res, 404, { error: 'Não encontrado.' });
  }

  // ------------------------------------------------------------ API do dono
  async function adminApi(req, res, url) {
    const { method } = req;
    const p = url.pathname;
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    let m;

    if (method === 'POST' && p === '/api/admin/login') {
      if (limited('login:' + ip, 10)) return json(res, 429, { error: 'Demasiadas tentativas. Espera 15 minutos.' });
      if (!adminPassword) return json(res, 503, { error: 'Define ADMIN_PASSWORD no servidor para activar o painel.' });
      const { password } = await readBody(req);
      const a = crypto.createHash('sha256').update(String(password || '')).digest();
      const b = crypto.createHash('sha256').update(adminPassword).digest();
      if (!crypto.timingSafeEqual(a, b)) return json(res, 401, { error: 'Palavra-passe errada.' });
      return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(makeToken(), SESSION_HOURS * 3600) });
    }
    if (!validToken(cookie(req, 'adm'))) return json(res, 401, { error: 'Sessão terminada. Entra outra vez.' });
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'painel') return json(res, 403, { error: 'Pedido inválido.' });
    const body = method === 'GET' ? {} : await readBody(req);

    if (method === 'POST' && p === '/api/admin/logout') return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });

    if (method === 'GET' && p === '/api/admin/overview') {
      return json(res, 200, { ...platform.overview(), activity: platform.activity.slice(0, 30).map(a => ({ ...a, reseller: platform.reseller(a.resellerId)?.name })) });
    }

    // Revendedores
    if (method === 'GET' && p === '/api/admin/resellers') {
      return json(res, 200, { resellers: platform.state.resellers.map(resellerView).sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0)) });
    }
    if (method === 'POST' && p === '/api/admin/resellers') {
      const r = await platform.createReseller(body);
      return json(res, 200, { reseller: resellerView(r), invite: platform.inviteMessage(r) });
    }
    if ((m = p.match(/^\/api\/admin\/resellers\/([\w-]+)(?:\/(\w+))?$/))) {
      const r = platform.reseller(m[1]);
      if (!r) return json(res, 404, { error: 'Revendedor não encontrado.' });
      const sub = m[2];
      if (method === 'GET' && !sub) {
        return json(res, 200, {
          reseller: resellerView(r), invite: platform.inviteMessage(r), config: r.config,
          payments: platform.state.payments.filter(x => x.resellerId === r.id).slice().reverse(),
          orders: (platform.state.orders[r.id] || []).slice(-50).reverse().map(orderView),
        });
      }
      if (method === 'PUT' && !sub) return json(res, 200, { reseller: resellerView(platform.updateReseller(r.id, body)) });
      if (method === 'DELETE' && !sub) { await platform.deleteReseller(r.id); return json(res, 200, { ok: true }); }
      if (method === 'POST' && sub === 'payments') { await platform.addPayment(r.id, body); return json(res, 200, { reseller: resellerView(r) }); }
      if (method === 'POST' && sub === 'code') { platform.regenerateCode(r.id); return json(res, 200, { reseller: resellerView(r), invite: platform.inviteMessage(r) }); }
    }
    if (method === 'POST' && (m = p.match(/^\/api\/admin\/groups\/(.+)\/deactivate$/))) {
      const ok = await platform.deactivateGroup(decodeURIComponent(m[1]), null, true);
      return json(res, ok ? 200 : 404, ok ? { ok } : { error: 'Grupo não encontrado.' });
    }

    if (method === 'GET' && p === '/api/admin/payments') {
      return json(res, 200, { payments: platform.state.payments.slice().reverse().slice(0, 300).map(x => ({ ...x, reseller: platform.reseller(x.resellerId)?.name || '—' })) });
    }

    // Números do bot
    if (method === 'POST' && p === '/api/admin/bots') {
      if (limited('pair:' + ip, 10)) return json(res, 429, { error: 'Demasiadas tentativas.' });
      return json(res, 200, await platform.addBotNumber(body.phone, body.label));
    }
    if (method === 'DELETE' && (m = p.match(/^\/api\/admin\/bots\/(\d{9})$/))) {
      await platform.removeBotNumber(m[1]);
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && p === '/api/admin/bots') {
      return json(res, 200, { bots: platform.overview().bots.map(b => ({ ...b, pairingCode: platform.connections.get(b.phone)?.pairingCode || null })) });
    }

    // Planos e definições
    if (method === 'GET' && p === '/api/admin/settings') {
      return json(res, 200, { plans: platform.state.plans, owner: platform.owner, site: platform.state.settings.site || {}, aiAvailable: !!platform.ai?.enabled });
    }
    if (method === 'PUT' && p === '/api/admin/plans') return json(res, 200, { plan: platform.savePlan(body) });
    if (method === 'DELETE' && (m = p.match(/^\/api\/admin\/plans\/([\w-]+)$/))) { platform.deletePlan(m[1]); return json(res, 200, { ok: true }); }
    if (method === 'PUT' && p === '/api/admin/settings/owner') {
      const owner = {
        name: String(body.name || '').trim(),
        phone: normalizePhone(body.phone) || '',
        paymentAccounts: (body.paymentAccounts || []).filter(a => normalizePhone(a.number))
          .map(a => ({ provider: String(a.provider), number: normalizePhone(a.number), name: String(a.name || '') })),
      };
      platform.saveSettings('owner', owner);
      return json(res, 200, { owner });
    }

    // Fraudes (lista negra global)
    if (method === 'GET' && p === '/api/admin/fraud') {
      const name = id => platform.reseller(id)?.name || '—';
      return json(res, 200, {
        reports: platform.fraud.data.reports.slice().reverse().slice(0, 300).map(r => ({ ...r, reseller: name(r.tenant) })),
        banned: Object.entries(platform.fraud.data.banned).map(([phone, b]) => ({ phone, ...b, reseller: name(b.tenant) })).sort((a, b) => b.at - a.at),
      });
    }
    if (method === 'POST' && p === '/api/admin/fraud/unban') {
      const n = normalizePhone(body.phone);
      if (!n || !platform.fraud.isBanned(n)) return json(res, 404, { error: 'Este número não está banido.' });
      platform.fraud.unban(n);
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && p === '/api/admin/fraud/ban') {
      const n = normalizePhone(body.phone);
      if (!n) return json(res, 400, { error: 'Número inválido.' });
      platform.fraud.ban(n, { tenant: null, reason: body.reason || null });
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && (m = p.match(/^\/api\/admin\/fraud\/reports\/(\d+)$/))) {
      const r = platform.fraud.resolveReport(m[1], body.action === 'confirm' ? 'confirmada' : 'descartada');
      if (r && body.action === 'confirm') platform.fraud.ban(r.phone, { tenant: r.tenant, reason: r.reason });
      return json(res, r ? 200 : 404, r ? { ok: true } : { error: 'Denúncia não encontrada.' });
    }
    return json(res, 404, { error: 'Não encontrado.' });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      if (url.pathname.startsWith('/api/public/')) return await publicApi(req, res, url.pathname);
      if (url.pathname.startsWith('/api/admin/')) return await adminApi(req, res, url);
      let rel = url.pathname === '/' ? 'index.html' : url.pathname === '/admin' || url.pathname === '/admin/' ? 'admin.html' : url.pathname;
      let file = path.normalize(path.join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<p style="font-family:sans-serif;padding:40px">Página não encontrada. <a href="/">Voltar ao início</a></p>');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent) json(res, 400, { error: e.message });
    }
  });
}
