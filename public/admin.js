// Painel do dono do BotMegas.
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mt = v => `${Number(v || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} MT`;
const ph = p => (p ? String(p).replace(/^(\d{2})(\d{3})(\d{4})$/, '$1 $2 $3') : '—');
const date = ms => (ms ? new Date(ms).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const DAY = 864e5;
const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : date(ms);
};
const left = r => Math.ceil(((r.expiresAt || 0) - Date.now()) / DAY);
function expiryTag(r) {
  if (r.status === 'suspenso') return '<span class="tag bad">Suspenso</span>';
  const d = left(r);
  if (d <= 0) return '<span class="tag bad">Expirado</span>';
  if (d <= 3) return `<span class="tag warn">${d} dia${d > 1 ? 's' : ''}</span>`;
  return `<span class="tag ok">${d} dias</span>`;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'painel' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/admin/login') { renderLogin(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'Algo correu mal.');
  return data;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
async function copy(text, label = 'Copiado') { try { await navigator.clipboard.writeText(text); toast(label); } catch { prompt('Copia:', text); } }

const markSvg = '<svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9 21.5V12l7 6 7-6v9.5" stroke="#FFC83D" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ================================================================ login
function renderLogin() {
  stopPolling();
  app.innerHTML = `
    <div class="login"><form id="f">
      <span class="mark">${markSvg}<b>botmegas</b></span>
      <h1>Painel do dono</h1>
      <p>Entra para gerir revendedores, pagamentos e números do bot.</p>
      <label class="f">Palavra-passe<input class="in" type="password" id="pw" autocomplete="current-password" required></label>
      <p class="err" id="err"></p>
      <button class="btn btn-blue btn-block" id="go">Entrar</button>
    </form></div>`;
  $('#pw').focus();
  $('#f').onsubmit = async e => {
    e.preventDefault();
    $('#go').disabled = true;
    try { await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } }); route(); }
    catch (err) { $('#err').textContent = err.message; $('#go').disabled = false; }
  };
}

// ================================================================ estrutura
const NAV = [
  ['resumo', 'Resumo'], ['revendedores', 'Revendedores'], ['pagamentos', 'Pagamentos'],
  ['bots', 'Números do bot'], ['fraudes', 'Fraudes'], ['definicoes', 'Planos e definições'],
];
let counts = {};
function shell(active) {
  if (!$('.shell')) {
    app.innerHTML = `
      <div class="shell">
        <nav class="side" aria-label="Painel"></nav>
        <main id="main"></main>
      </div>`;
  }
  $('.side').innerHTML = `
    <a class="mark" href="#/resumo">${markSvg}<b>botmegas</b></a>
    ${NAV.map(([id, name]) => `<a class="nav-i" href="#/${id}" ${active === id ? 'aria-current="page"' : ''}>${name}${counts[id] ? `<span class="count">${counts[id]}</span>` : ''}</a>`).join('')}
    <div class="foot"><a href="/" target="_blank" rel="noopener">Ver o site</a><button id="logout">Sair</button></div>`;
  $('#logout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); renderLogin(); };
  return $('#main');
}

let pollT;
function stopPolling() { clearTimeout(pollT); }
function poll(fn, ms) { stopPolling(); pollT = setTimeout(async () => { try { await fn(); } catch {} poll(fn, ms); }, ms); }

async function route() {
  stopPolling();
  const [, page = 'resumo', id] = location.hash.match(/^#\/([\w]+)\/?([\w-]*)/) || [];
  const main = shell(page);
  try {
    const views = { resumo: viewResumo, revendedores: viewRevendedores, pagamentos: viewPagamentos, bots: viewBots, fraudes: viewFraudes, definicoes: viewDefinicoes };
    await (views[page] || viewResumo)(main, id);
  } catch (e) {
    if (e.message) main.innerHTML = `<div class="panel empty"><b>Não consegui carregar</b>${esc(e.message)}</div>`;
  }
}
addEventListener('hashchange', route);

// ================================================================ resumo
async function viewResumo(main) {
  const o = await api('/api/admin/overview');
  counts = { fraudes: o.openReports, revendedores: o.expiringSoon };
  shell('resumo');
  const month = new Date().toLocaleDateString('pt-PT', { month: 'long' });
  const resellers = (await api('/api/admin/resellers')).resellers;
  const expiring = resellers.filter(r => r.status === 'ativo' && left(r) <= 7).slice(0, 8);
  main.innerHTML = `
    <div class="head"><div><h1>Resumo</h1><p>Como está o negócio hoje.</p></div>
      <a class="btn btn-blue" href="#/revendedores/novo">Novo revendedor</a></div>
    <div class="figures">
      <div class="figure main"><div class="k">Recebido em ${month}</div><div class="v">${mt(o.revenueMonth)}</div><div class="s">${mt(o.revenue30)} nos últimos 30 dias</div></div>
      <div class="figure"><div class="k">Revendedores activos</div><div class="v">${o.activeResellers}</div><div class="s">${o.expired} ${o.expired === 1 ? 'expirado ou suspenso' : 'expirados ou suspensos'}</div></div>
      <div class="figure"><div class="k">Grupos com o bot</div><div class="v">${o.activeGroups}</div><div class="s">${o.bots.length} número${o.bots.length === 1 ? '' : 's'} de bot</div></div>
      <div class="figure"><div class="k">Pedidos hoje</div><div class="v">${o.ordersToday}</div><div class="s">${o.ordersPending} à espera nos grupos</div></div>
    </div>
    <div class="cols">
      <div class="stack">
        <section class="panel"><div class="panel-head"><div><h2>Pagamentos recebidos</h2><p>Últimos 30 dias, por dia</p></div></div>
          <div class="chart" id="chart"></div></section>
        <section class="panel"><div class="panel-head"><h2>Actividade nos grupos</h2></div>
          <div class="list">${o.activity.length ? o.activity.slice(0, 10).map(a => `
            <div class="li"><div><span class="t">${esc(a.reseller || '—')}</span> <span class="muted">${esc(a.text)}</span></div><span class="faint small">${ago(a.at)}</span></div>`).join('')
            : '<div class="empty">Ainda não houve actividade desde que o servidor arrancou.</div>'}</div></section>
      </div>
      <div class="stack">
        <section class="panel"><div class="panel-head"><div><h2>A expirar</h2><p>Nos próximos 7 dias</p></div></div>
          <div class="list">${expiring.length ? expiring.map(r => `
            <div class="li"><div><a class="t" href="#/revendedores/${r.id}" style="color:inherit">${esc(r.name)}</a><div class="small muted">${esc(r.planName || '')}, ${date(r.expiresAt)}</div></div>${expiryTag(r)}</div>`).join('')
            : '<div class="empty">Ninguém a expirar esta semana.</div>'}</div></section>
        <section class="panel"><div class="panel-head"><h2>Números do bot</h2><a class="link" href="#/bots">Gerir</a></div>
          <div class="list">${o.bots.length ? o.bots.map(b => `
            <div class="li"><div><span class="phone">${ph(b.phone)}</span><div class="small muted">${b.groups} grupo${b.groups === 1 ? '' : 's'}</div></div>${botTag(b.status)}</div>`).join('')
            : '<div class="empty"><b>Sem números de bot</b><a class="link" href="#/bots">Liga o primeiro número</a></div>'}</div></section>
        ${o.openReports ? `<section class="panel"><div class="panel-head"><h2>Denúncias por rever</h2><a class="link" href="#/fraudes">Ver</a></div><p class="muted" style="margin:0">${o.openReports} denúncia${o.openReports > 1 ? 's' : ''} aberta${o.openReports > 1 ? 's' : ''}. ${o.banned} ${o.banned === 1 ? 'número' : 'números'} na lista negra.</p></section>` : ''}
      </div>
    </div>`;
  barChart($('#chart'), o.revenueByDay);
  poll(() => viewResumo(main), 30000);
}

function botTag(s) {
  return { ligado: '<span class="tag ok">Ligado</span>', a_ligar: '<span class="tag warn">A ligar</span>', aguarda_codigo: '<span class="tag info">À espera do código</span>', sessao_terminada: '<span class="tag bad">Sessão terminada</span>' }[s] || '<span class="tag bad">Desligado</span>';
}

/** Barras de uma série: valores por dia, com dica ao passar o rato/dedo. */
function barChart(el, data) {
  const W = Math.max(280, Math.round(el.clientWidth || 720)), H = 180, padB = 22, padT = 8;
  const max = Math.max(1, ...data.map(d => d.amount));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const bw = W / data.length;
  const y = v => H - padB - (v / top) * (H - padB - padT);
  const lines = [];
  for (let v = 0; v <= top; v += step) lines.push(`<line class="grid-l" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${W}" y="${y(v) - 4}" text-anchor="end">${v ? v.toLocaleString('pt-PT') : ''}</text>`);
  const bars = data.map((d, i) => {
    const h = Math.max(0, H - padB - y(d.amount));
    const x = i * bw + bw * 0.18, w = bw * 0.64;
    const r = Math.min(4, w / 2, h);
    const path = h > 0 ? `M${x},${H - padB} V${H - padB - h + r} Q${x},${H - padB - h} ${x + r},${H - padB - h} H${x + w - r} Q${x + w},${H - padB - h} ${x + w},${H - padB - h + r} V${H - padB} Z` : '';
    return `<rect class="bar-hit" x="${i * bw}" y="0" width="${bw}" height="${H}" data-i="${i}"/><path class="bar" d="${path}"/>`;
  }).join('');
  const label = i => new Date(data[i].day).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pagamentos por dia nos últimos 30 dias">${lines.join('')}${bars}
    <text class="ax" x="0" y="${H - 4}">${label(0)}</text><text class="ax" x="${W / 2}" y="${H - 4}" text-anchor="middle">${label(15)}</text><text class="ax" x="${W - bw / 2}" y="${H - 4}" text-anchor="end">hoje</text></svg><div class="tip"></div>`;
  const tip = $('.tip', el);
  el.querySelectorAll('.bar-hit').forEach(r => {
    const show = () => {
      const i = Number(r.dataset.i);
      const box = el.getBoundingClientRect(), rb = r.getBoundingClientRect();
      tip.innerHTML = `${label(i)}: <b>${mt(data[i].amount)}</b>`;
      tip.style.left = `${rb.left - box.left + rb.width / 2}px`;
      tip.style.top = `${Math.max(16, (y(data[i].amount) / H) * box.height)}px`;
      tip.style.display = 'block';
    };
    r.addEventListener('mouseenter', show); r.addEventListener('touchstart', show, { passive: true });
    r.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}
function niceStep(max) { const raw = max / 3; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw); }

// ================================================================ revendedores
let resFilter = 'todos', resQuery = '';
async function viewRevendedores(main, id) {
  const [{ resellers }, settings] = await Promise.all([api('/api/admin/resellers'), api('/api/admin/settings')]);
  counts.revendedores = resellers.filter(r => r.status === 'ativo' && left(r) > 0 && left(r) <= 7).length;
  shell('revendedores');
  const filters = { todos: () => true, activos: r => r.active, expirar: r => r.active && left(r) <= 7, expirados: r => !r.active };
  const draw = () => {
    const q = resQuery.toLowerCase();
    const list = resellers.filter(filters[resFilter]).filter(r => !q || r.name.toLowerCase().includes(q) || r.phone.includes(q.replace(/\D/g, '') || '§'));
    $('#rlist').innerHTML = list.length ? `
      <div class="tscroll"><table class="t cards"><thead><tr><th>Revendedor</th><th>Plano</th><th>Grupos</th><th class="r">Vendas 30 dias</th><th>Termina</th></tr></thead><tbody>
      ${list.map(r => `<tr class="click" data-id="${r.id}">
        <td><b>${esc(r.name)}</b><div class="small muted phone">${ph(r.phone)}</div></td>
        <td class="hide-m">${esc(r.planName || '—')}</td>
        <td class="hide-m num">${r.groups.filter(g => g.active).length}/${r.maxGroups}</td>
        <td class="r hide-m num">${mt(r.volume30)}</td>
        <td>${expiryTag(r)}<div class="small faint">${date(r.expiresAt)}</div></td></tr>`).join('')}
      </tbody></table></div>`
      : `<div class="empty"><b>${resellers.length ? 'Ninguém nesta lista' : 'Ainda não tens revendedores'}</b>${resellers.length ? 'Muda o filtro ou a pesquisa.' : 'Cria o primeiro e envia-lhe o código de activação.'}</div>`;
    $('#rlist').querySelectorAll('[data-id]').forEach(tr => tr.onclick = () => { location.hash = `#/revendedores/${tr.dataset.id}`; });
  };
  main.innerHTML = `
    <div class="head"><div><h1>Revendedores</h1><p>${resellers.length} no total, ${resellers.filter(r => r.active).length} activos.</p></div>
      <a class="btn btn-blue" href="#/revendedores/novo">Novo revendedor</a></div>
    <section class="panel">
      <div class="row" style="margin-bottom:12px">
        <div class="seg" id="seg">${[['todos', 'Todos'], ['activos', 'Activos'], ['expirar', 'A expirar'], ['expirados', 'Expirados']].map(([k, n]) => `<button class="${resFilter === k ? 'on' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
        <input class="in" id="q" placeholder="Procurar por nome ou número" value="${esc(resQuery)}" style="flex:1;min-width:200px;max-width:340px">
      </div>
      <div id="rlist"></div>
    </section>`;
  $('#seg').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { resFilter = b.dataset.f; $('#seg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); } };
  $('#q').oninput = e => { resQuery = e.target.value; draw(); };
  draw();
  if (id === 'novo') openNewReseller(settings);
  else if (id) openReseller(id, settings);
}

function drawer(html) {
  closeDrawer(true);
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
  d.innerHTML = html;
  document.body.append(scrim, d);
  requestAnimationFrame(() => { scrim.classList.add('open'); d.classList.add('open'); });
  const close = () => { location.hash = '#/revendedores'; };
  scrim.onclick = close;
  $('.x', d).onclick = close;
  d.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  $('.x', d).focus();
  return d;
}
function closeDrawer(now) {
  document.querySelectorAll('.drawer, .scrim').forEach(el => { if (now) el.remove(); else { el.classList.remove('open'); setTimeout(() => el.remove(), 250); } });
}
addEventListener('hashchange', () => { if (!/#\/revendedores\/.+/.test(location.hash)) closeDrawer(); });

function openNewReseller(settings) {
  const plans = settings.plans.filter(p => p.active);
  const d = drawer(`
    <div class="drawer-head"><div><h2>Novo revendedor</h2><p class="muted" style="margin:4px 0 0">Recebe um código para activar o bot nos grupos dele.</p></div><button class="x" aria-label="Fechar">✕</button></div>
    <form class="drawer-body stack" id="nf">
      <label class="f">Nome<input class="in" name="name" required placeholder="Ex: Zé dos Megas"></label>
      <label class="f">Número de WhatsApp<input class="in" name="phone" inputmode="numeric" required placeholder="84 123 4567"></label>
      <label class="f">Plano<select class="in" name="planId">${plans.map(p => `<option value="${esc(p.id)}" ${p.highlight ? 'selected' : ''}>${esc(p.name)}: ${mt(p.price)}, ${p.days} dias, ${p.maxGroups} grupo${p.maxGroups > 1 ? 's' : ''}</option>`).join('')}</select></label>
      <label class="f" style="display:flex;gap:10px;align-items:center;font-size:15px;color:var(--ink)"><input type="checkbox" name="paid" checked style="width:18px;height:18px"> Já pagou o primeiro período</label>
      <div class="grid2">
        <label class="f">Pago por<select class="in" name="method"><option>M-Pesa</option><option>e-Mola</option><option>mKesh</option><option>Dinheiro</option></select></label>
        <label class="f">Referência<input class="in" name="reference" placeholder="Opcional"></label>
      </div>
      <label class="f">Notas <small>só tu vês</small><textarea class="in" name="notes"></textarea></label>
      <p class="err" id="err"></p>
      <button class="btn btn-blue btn-block">Criar revendedor</button>
    </form>`);
  $('#nf', d).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const { reseller } = await api('/api/admin/resellers', { method: 'POST', body: { name: f.name, phone: f.phone, planId: f.planId, notes: f.notes, firstPayment: f.paid ? { method: f.method, reference: f.reference } : null } });
      toast('Revendedor criado');
      location.hash = `#/revendedores/${reseller.id}`;
    } catch (err) { $('#err', d).textContent = err.message; }
  };
}

async function openReseller(id, settings) {
  const data = await api(`/api/admin/resellers/${id}`);
  const { reseller: r, invite, payments, orders, config } = data;
  const plan = settings.plans.find(p => p.id === r.planId);
  const waInvite = `https://wa.me/258${r.phone}?text=${encodeURIComponent(invite)}`;
  const d = drawer(`
    <div class="drawer-head"><div><h2>${esc(r.name)}</h2><div class="row small muted" style="margin-top:4px"><span class="phone">${ph(r.phone)}</span>${expiryTag(r)}</div></div><button class="x" aria-label="Fechar">✕</button></div>
    <div class="drawer-body stack">
      <section class="invite">
        <div class="small" style="color:#9AA3C2">Código de activação</div>
        <div class="code">${esc(r.inviteCode)}</div>
        <pre>${esc(invite)}</pre>
        <div class="row">
          <a class="btn btn-sun btn-sm" href="${waInvite}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
          <button class="btn btn-sm" id="cpInvite">Copiar mensagem</button>
          <button class="btn btn-sm" id="newCode">Gerar código novo</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h2>Assinatura</h2><p>${esc(plan?.name || '—')}, ${plan ? mt(plan.price) : ''} por ${plan?.days || '—'} dias. Termina a <b>${date(r.expiresAt)}</b>.</p></div></div>
        <form id="payF" class="stack">
          <div class="grid2">
            <label class="f">Valor (MT)<input class="in" name="amount" type="number" min="0" step="0.01" value="${plan?.price ?? ''}"></label>
            <label class="f">Dias a somar<input class="in" name="days" type="number" min="1" value="${plan?.days ?? 30}"></label>
            <label class="f">Pago por<select class="in" name="method"><option>M-Pesa</option><option>e-Mola</option><option>mKesh</option><option>Dinheiro</option></select></label>
            <label class="f">Referência<input class="in" name="reference" placeholder="Opcional"></label>
          </div>
          <button class="btn btn-blue">Registar pagamento</button>
          <p class="small muted" style="margin:0">Os dias somam-se à data de fim, por isso pagar antes do tempo não faz perder dias. O revendedor recebe a confirmação no WhatsApp.</p>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Grupos</h2><span class="muted small">${r.groups.filter(g => g.active).length} de ${r.maxGroups} no plano</span></div>
        <div class="list" id="glist">${r.groups.length ? r.groups.map(g => `
          <div class="li"><div><span class="t">${esc(g.name)}</span><div class="small muted">Activado a ${date(g.activatedAt)}${g.active ? '' : ', desactivado'}</div></div>
          ${g.active ? `<button class="btn btn-sm btn-red" data-off="${esc(g.jid)}">Desactivar</button>` : '<span class="tag">Inactivo</span>'}</div>`).join('')
          : '<div class="empty">Ainda não activou o bot em nenhum grupo.</div>'}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Dados</h2></div>
        <form id="edF" class="stack">
          <div class="grid2">
            <label class="f">Nome<input class="in" name="name" value="${esc(r.name)}"></label>
            <label class="f">Número<input class="in" name="phone" value="${esc(r.phone)}" inputmode="numeric"></label>
            <label class="f">Plano<select class="in" name="planId">${settings.plans.map(p => `<option value="${esc(p.id)}" ${p.id === r.planId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
            <label class="f">Nome do negócio <small>aparece no menu do bot</small><input class="in" name="businessName" value="${esc(config.businessName || '')}"></label>
          </div>
          <label class="f">Notas<textarea class="in" name="notes">${esc(r.notes || '')}</textarea></label>
          <div class="row"><button class="btn btn-blue">Guardar</button>
            <button type="button" class="btn ${r.status === 'suspenso' ? '' : 'btn-red'}" id="suspend">${r.status === 'suspenso' ? 'Reactivar' : 'Suspender'}</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Pacotes que vende</h2><span class="muted small">O revendedor muda com !preco</span></div>
        <div class="list">${(config.packages || []).map(p => `<div class="li"><span>${esc(p.name)}${p.validity ? ` <span class="faint small">${esc(p.validity)}</span>` : ''}</span><b class="num">${mt(p.price)}</b></div>`).join('') || '<div class="empty">Sem pacotes.</div>'}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Últimos pedidos</h2><span class="muted small">${r.ordersTotal} no total</span></div>
        <div class="list">${orders.length ? orders.slice(0, 10).map(o => `
          <div class="li"><div><b>#${o.id}</b> <span class="phone">${ph(o.targetPhone)}</span><div class="small muted">${esc(o.packageName || (o.amount ? mt(o.amount) : 'imagem'))}, ${ago(o.createdAt)}</div></div>
          ${{ pendente: '<span class="tag warn">Pendente</span>', concluido: '<span class="tag ok">Enviado</span>', rejeitado: '<span class="tag bad">Rejeitado</span>', aguarda_numero: '<span class="tag info">Falta número</span>' }[o.status] || ''}</div>`).join('')
          : '<div class="empty">Ainda sem pedidos.</div>'}</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Pagamentos</h2><span class="muted small">${mt(r.paid)} no total</span></div>
        <div class="list">${payments.length ? payments.map(p => `<div class="li"><div>${date(p.createdAt)}<div class="small muted">${esc(p.method || '')}${p.reference ? `, ${esc(p.reference)}` : ''}, ${p.days} dias</div></div><b class="num">${mt(p.amount)}</b></div>`).join('') : '<div class="empty">Sem pagamentos registados.</div>'}</div>
      </section>

      <button class="btn btn-red" id="del">Apagar revendedor</button>
    </div>`);

  const reload = () => { viewRevendedores($('#main'), id); };
  $('#cpInvite', d).onclick = () => copy(invite, 'Mensagem copiada');
  $('#newCode', d).onclick = async () => {
    if (!confirm('Gerar um código novo? O antigo deixa de funcionar (os grupos já activos continuam).')) return;
    await api(`/api/admin/resellers/${id}/code`, { method: 'POST' }); toast('Código novo gerado'); reload();
  };
  $('#payF', d).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api(`/api/admin/resellers/${id}/payments`, { method: 'POST', body: f }); toast('Pagamento registado'); reload(); } catch (err) { toast(err.message); }
  };
  $('#edF', d).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api(`/api/admin/resellers/${id}`, { method: 'PUT', body: { name: f.name, phone: f.phone, planId: f.planId, notes: f.notes, config: { businessName: f.businessName } } });
      toast('Alterações guardadas'); reload();
    } catch (err) { toast(err.message); }
  };
  $('#suspend', d).onclick = async () => {
    const next = r.status === 'suspenso' ? 'ativo' : 'suspenso';
    if (next === 'suspenso' && !confirm(`Suspender ${r.name}? O bot deixa de responder nos grupos dele.`)) return;
    await api(`/api/admin/resellers/${id}`, { method: 'PUT', body: { status: next } });
    toast(next === 'suspenso' ? 'Revendedor suspenso' : 'Revendedor reactivado'); reload();
  };
  $('#glist', d).onclick = async e => {
    const b = e.target.closest('[data-off]');
    if (!b || !confirm('Desactivar o bot neste grupo?')) return;
    await api(`/api/admin/groups/${encodeURIComponent(b.dataset.off)}/deactivate`, { method: 'POST' }); toast('Grupo desactivado'); reload();
  };
  $('#del', d).onclick = async () => {
    if (prompt(`Para apagar ${r.name} e todos os pedidos, escreve APAGAR`) !== 'APAGAR') return;
    await api(`/api/admin/resellers/${id}`, { method: 'DELETE' }); toast('Revendedor apagado'); location.hash = '#/revendedores';
  };
}

// ================================================================ pagamentos
async function viewPagamentos(main) {
  const { payments } = await api('/api/admin/payments');
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const month = payments.filter(p => p.createdAt >= monthStart.getTime()).reduce((s, p) => s + p.amount, 0);
  main.innerHTML = `
    <div class="head"><div><h1>Pagamentos</h1><p>${mt(month)} recebidos este mês. Para registar um pagamento, abre o revendedor.</p></div></div>
    <section class="panel">${payments.length ? `
      <div class="tscroll"><table class="t cards"><thead><tr><th>Data</th><th>Revendedor</th><th>Método</th><th class="r">Dias</th><th class="r">Valor</th></tr></thead><tbody>
      ${payments.map(p => `<tr class="click" data-id="${esc(p.resellerId)}"><td>${date(p.createdAt)}</td><td><b>${esc(p.reseller)}</b></td><td class="hide-m">${esc(p.method || '—')}${p.reference ? `<div class="small faint">${esc(p.reference)}</div>` : ''}</td><td class="r hide-m num">${p.days}</td><td class="r num"><b>${mt(p.amount)}</b></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><b>Ainda sem pagamentos</b>Quando registares o pagamento de um revendedor, aparece aqui.</div>'}
    </section>`;
  main.querySelectorAll('[data-id]').forEach(tr => tr.onclick = () => { location.hash = `#/revendedores/${tr.dataset.id}`; });
}

// ================================================================ números do bot
async function viewBots(main) {
  const { bots } = await api('/api/admin/bots');
  main.innerHTML = `
    <div class="head"><div><h1>Números do bot</h1><p>Os números que os revendedores adicionam aos grupos. Usa números só para o bot, de preferência WhatsApp Business.</p></div></div>
    <div class="cols">
      <section class="panel">${bots.length ? `<div class="list">${bots.map(b => `
        <div class="li"><div><span class="phone" style="font-size:18px">${ph(b.phone)}</span>${b.label ? ` <span class="muted">${esc(b.label)}</span>` : ''}
          <div class="small muted">${b.groups} grupo${b.groups === 1 ? '' : 's'} activos${b.pairingCode ? `, código: <b>${esc(b.pairingCode)}</b>` : ''}</div></div>
          <div class="row">${botTag(b.status)}${b.status !== 'ligado' ? `<button class="btn btn-sm" data-pair="${b.phone}">Ligar</button>` : ''}<button class="btn btn-sm btn-red" data-del="${b.phone}">Remover</button></div></div>`).join('')}</div>`
        : '<div class="empty"><b>Ainda não ligaste nenhum número</b>Liga o primeiro ao lado. Leva um minuto.</div>'}
      </section>
      <section class="panel" id="pairBox">
        <h2>Ligar um número</h2>
        <form id="bf" class="stack" style="margin-top:12px">
          <label class="f">Número do WhatsApp do bot<input class="in" name="phone" inputmode="numeric" required placeholder="84 123 4567"></label>
          <label class="f">Nome <small>opcional, só para ti</small><input class="in" name="label" placeholder="Ex: Bot 2"></label>
          <p class="err" id="err"></p>
          <button class="btn btn-blue">Pedir código de ligação</button>
        </form>
      </section>
    </div>`;
  const pair = async (phone, label) => {
    $('#pairBox').innerHTML = '<div class="empty"><span class="spin"></span> A pedir o código ao WhatsApp…</div>';
    try {
      const r = await api('/api/admin/bots', { method: 'POST', body: { phone, label } });
      if (r.status === 'ligado') { toast('Este número já está ligado'); return viewBots(main); }
      $('#pairBox').className = 'pair';
      $('#pairBox').innerHTML = `
        <div>No telemóvel do número <b>${ph(String(phone).replace(/\D/g, '').slice(-9))}</b>:</div>
        <ol><li>WhatsApp, depois Dispositivos ligados</li><li>Ligar um dispositivo</li><li>Ligar com número de telefone</li><li>Escreve o código:</li></ol>
        <div class="code">${esc(r.code.replace(/(.{4})(.{4})/, '$1-$2'))}</div>
        <div class="small" style="color:#9AA3C2"><span class="spin"></span> À espera da ligação…</div>`;
      poll(async () => {
        const { bots: now } = await api('/api/admin/bots');
        const b = now.find(x => x.phone === String(phone).replace(/\D/g, '').slice(-9));
        if (b?.status === 'ligado') { toast('Número ligado'); viewBots(main); }
      }, 2500);
    } catch (e) { $('#pairBox').innerHTML = `<div class="empty"><b>Não deu</b>${esc(e.message)}</div>`; }
  };
  $('#bf')?.addEventListener('submit', e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); pair(f.phone, f.label); });
  main.querySelectorAll('[data-pair]').forEach(b => b.onclick = () => pair(b.dataset.pair));
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm(`Remover o número ${ph(b.dataset.del)}? Os grupos que ele atende deixam de ter bot até adicionarem outro número.`)) return;
    await api(`/api/admin/bots/${b.dataset.del}`, { method: 'DELETE' }); toast('Número removido'); viewBots(main);
  });
}

// ================================================================ fraudes
async function viewFraudes(main) {
  const { reports, banned } = await api('/api/admin/fraud');
  const open = reports.filter(r => r.status === 'aberta');
  counts.fraudes = open.length; shell('fraudes');
  main.innerHTML = `
    <div class="head"><div><h1>Fraudes</h1><p>A lista negra é partilhada por todos os revendedores. Confirma só denúncias com motivo claro.</p></div></div>
    <div class="cols">
      <section class="panel">
        <div class="panel-head"><h2>Denúncias por rever</h2><span class="muted small">${open.length}</span></div>
        <div class="list" id="rep">${open.length ? open.map(r => `
          <div class="li" data-id="${r.id}"><div><span class="phone">${ph(r.phone)}</span> <span class="faint small">${ago(r.at)}</span>
            <div>${esc(r.reason || 'Sem motivo')}</div><div class="small muted">Por ${esc(r.byName || r.by || '—')}, no grupo de ${esc(r.reseller)}</div></div>
            <div class="row"><button class="btn btn-sm btn-red" data-a="confirm">Banir</button><button class="btn btn-sm" data-a="dismiss">Descartar</button></div></div>`).join('')
          : '<div class="empty">Nenhuma denúncia por rever.</div>'}</div>
      </section>
      <div class="stack">
        <section class="panel"><h2>Banir um número</h2>
          <form id="banF" class="stack" style="margin-top:12px">
            <input class="in" name="phone" inputmode="numeric" placeholder="84 123 4567" required>
            <input class="in" name="reason" placeholder="Motivo">
            <button class="btn btn-red">Banir em todos os grupos</button>
          </form></section>
        <section class="panel"><div class="panel-head"><h2>Lista negra</h2><span class="muted small">${banned.length}</span></div>
          <div class="list" id="ban">${banned.length ? banned.map(b => `
            <div class="li"><div><span class="phone">${ph(b.phone)}</span><div class="small muted">${esc(b.reason || '—')}, ${date(b.at)}</div></div><button class="btn btn-sm" data-unban="${b.phone}">Desbanir</button></div>`).join('')
            : '<div class="empty">Ninguém banido.</div>'}</div></section>
      </div>
    </div>`;
  $('#rep').onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    await api(`/api/admin/fraud/reports/${b.closest('[data-id]').dataset.id}`, { method: 'POST', body: { action: b.dataset.a } });
    toast(b.dataset.a === 'confirm' ? 'Número banido' : 'Denúncia descartada'); viewFraudes(main);
  };
  $('#ban').onclick = async e => {
    const b = e.target.closest('[data-unban]'); if (!b || !confirm(`Desbanir ${ph(b.dataset.unban)}?`)) return;
    await api('/api/admin/fraud/unban', { method: 'POST', body: { phone: b.dataset.unban } }); toast('Número desbanido'); viewFraudes(main);
  };
  $('#banF').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/admin/fraud/ban', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Número banido'); viewFraudes(main); } catch (err) { toast(err.message); }
  };
}

// ================================================================ planos e definições
async function viewDefinicoes(main) {
  const s = await api('/api/admin/settings');
  const o = s.owner || {};
  const accs = o.paymentAccounts?.length ? o.paymentAccounts : [{ provider: 'M-Pesa', number: '', name: '' }];
  main.innerHTML = `
    <div class="head"><div><h1>Planos e definições</h1><p>Os planos activos aparecem no site com estes preços.</p></div></div>
    <div class="cols">
      <section class="panel">
        <div class="panel-head"><h2>Planos</h2><button class="btn btn-sm" id="addPlan">Adicionar plano</button></div>
        <div class="tscroll"><table class="t"><thead><tr><th>Nome</th><th>Preço (MT)</th><th>Dias</th><th>Grupos</th><th>Destaque</th><th>No site</th><th></th></tr></thead>
        <tbody id="plans">${s.plans.map(p => planRow(p)).join('')}</tbody></table></div>
      </section>
      <section class="panel">
        <h2>Os teus dados</h2>
        <p class="muted small" style="margin:4px 0 14px">Usados no botão de WhatsApp do site e nas mensagens de renovação.</p>
        <form id="ownF" class="stack">
          <label class="f">O teu nome<input class="in" name="name" value="${esc(o.name || '')}"></label>
          <label class="f">O teu WhatsApp <small>recebe os avisos e os contactos do site</small><input class="in" name="phone" value="${esc(o.phone || '')}" inputmode="numeric"></label>
          <div class="f">Contas onde os revendedores te pagam</div>
          <div id="accs" class="stack">${accs.map(accRow).join('')}</div>
          <div><button type="button" class="link" id="addAcc">Adicionar conta</button></div>
          <button class="btn btn-blue">Guardar</button>
        </form>
      </section>
    </div>`;
  $('#addPlan').onclick = () => { $('#plans').insertAdjacentHTML('beforeend', planRow({ id: '', name: '', price: '', days: 30, maxGroups: 1, active: true })); };
  $('#plans').onclick = async e => {
    const tr = e.target.closest('tr');
    if (e.target.matches('[data-save]')) {
      const v = n => $(`[name=${n}]`, tr);
      try {
        await api('/api/admin/plans', { method: 'PUT', body: { id: tr.dataset.id || undefined, name: v('name').value, price: v('price').value, days: v('days').value, maxGroups: v('maxGroups').value, highlight: v('highlight').checked, active: v('active').checked } });
        toast('Plano guardado'); viewDefinicoes(main);
      } catch (err) { toast(err.message); }
    }
    if (e.target.matches('[data-delplan]')) {
      if (!tr.dataset.id) return tr.remove();
      if (!confirm('Apagar este plano?')) return;
      try { await api(`/api/admin/plans/${tr.dataset.id}`, { method: 'DELETE' }); toast('Plano apagado'); viewDefinicoes(main); } catch (err) { toast(err.message); }
    }
  };
  $('#addAcc').onclick = () => $('#accs').insertAdjacentHTML('beforeend', accRow({ provider: 'e-Mola', number: '', name: '' }));
  $('#ownF').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const paymentAccounts = [...f.querySelectorAll('.acc')].map(a => ({ provider: $('[data-k=provider]', a).value, number: $('[data-k=number]', a).value, name: $('[data-k=name]', a).value }));
    try { await api('/api/admin/settings/owner', { method: 'PUT', body: { name: f.name.value, phone: f.phone.value, paymentAccounts } }); toast('Dados guardados'); } catch (err) { toast(err.message); }
  };
}
function planRow(p) {
  return `<tr data-id="${esc(p.id)}">
    <td><input class="in" name="name" value="${esc(p.name)}" style="min-width:110px"></td>
    <td><input class="in" name="price" type="number" min="0" value="${esc(p.price)}" style="width:100px"></td>
    <td><input class="in" name="days" type="number" min="1" value="${esc(p.days)}" style="width:72px"></td>
    <td><input class="in" name="maxGroups" type="number" min="1" value="${esc(p.maxGroups)}" style="width:72px"></td>
    <td><input type="checkbox" name="highlight" ${p.highlight ? 'checked' : ''} aria-label="Destaque"></td>
    <td><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''} aria-label="Mostrar no site"></td>
    <td><div class="row" style="flex-wrap:nowrap"><button class="btn btn-sm" data-save>Guardar</button><button class="btn btn-sm btn-red" data-delplan aria-label="Apagar plano">Apagar</button></div></td></tr>`;
}
function accRow(a) {
  return `<div class="acc grid2" style="grid-template-columns:110px 1fr 1fr">
    <select class="in" data-k="provider">${['M-Pesa', 'e-Mola', 'mKesh'].map(p => `<option ${a.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <input class="in" data-k="number" value="${esc(a.number)}" placeholder="Número" inputmode="numeric">
    <input class="in" data-k="name" value="${esc(a.name)}" placeholder="Nome da conta"></div>`;
}

// ================================================================ arranque
(async () => {
  try { await fetch('/api/admin/overview', { headers: { 'X-Requested-With': 'painel' } }).then(r => { if (r.status === 401) throw 0; }); route(); }
  catch { renderLogin(); }
})();
