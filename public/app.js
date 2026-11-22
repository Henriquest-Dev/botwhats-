// Painel do BotMegas — JavaScript simples, sem frameworks.
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mt = v => `${Number(v || 0).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} MT`;
const ago = ts => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : new Date(ts).toLocaleDateString('pt-PT');
};
const fmtPhone = p => (p ? String(p).replace(/^(\d{2})(\d{3})(\d{4})$/, '$1 $2 $3') : '—');

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'painel' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.allow401) { state.me = null; renderLogin(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const state = { me: null, tab: 'inicio', groups: null, orders: null, fraud: null, orderFilter: 'pendente', dirty: false };
const logo = `<span class="brand-mark"><svg width="18" height="18" viewBox="0 0 32 32"><path d="M6 23l6-7 5 4 9-11" stroke="#1d2b00" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

// ======================= LOGIN =======================
function renderLogin(step = 'phone', data = {}) {
  app.innerHTML = `
  <div class="auth">
    <section class="auth-hero">
      <div class="brand">${logo} BotMegas</div>
      <h1>O teu bot de vendas de <em>megas</em> no WhatsApp.</h1>
      <p>Responde aos clientes, organiza a fila, avisa quando os megas foram enviados e protege o teu grupo contra burlas. Liga em 1 minuto, sem instalar nada.</p>
      <ul class="feat">
        <li>Lê comprovativos M-Pesa, e-Mola e mKesh</li>
        <li>Responde "aguarda, estás na posição 3" automaticamente</li>
        <li>Lista negra de burladores partilhada entre vendedores</li>
        <li>Assistente com IA que responde a perguntas no grupo</li>
      </ul>
    </section>
    <section class="auth-panel"><div class="auth-card" id="authCard"></div></section>
  </div>`;
  const card = $('#authCard');

  if (step === 'phone') {
    card.innerHTML = `
      <h2>Entrar</h2>
      <p class="sub">Escreve o número do WhatsApp onde queres instalar o bot.</p>
      <form id="f">
        <div class="phone-field"><span>🇲🇿 +258</span><input id="ph" inputmode="numeric" autocomplete="tel" placeholder="84 123 4567" maxlength="14" required></div>
        <p class="err" id="err"></p>
        <button class="btn btn-primary btn-block" id="go">Continuar</button>
      </form>
      <p class="small muted" style="margin-top:18px;line-height:1.5">Se for a primeira vez, vais receber um código para ligar o bot ao teu WhatsApp. Se já estiver ligado, enviamos um código de acesso para o teu WhatsApp.</p>`;
    const ph = $('#ph');
    ph.focus();
    ph.addEventListener('input', () => {
      const d = ph.value.replace(/\D/g, '').replace(/^258/, '').slice(0, 9);
      ph.value = d.replace(/^(\d{2})(\d{0,3})(\d{0,4}).*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));
    });
    $('#f').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#go');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> A preparar…';
      $('#err').textContent = '';
      try {
        const r = await api('/api/login', { method: 'POST', body: { phone: ph.value }, allow401: true });
        renderLogin(r.mode, { ...r, phone: ph.value });
      } catch (err) {
        $('#err').textContent = err.message;
        btn.disabled = false; btn.textContent = 'Continuar';
      }
    };
  }

  if (step === 'pairing') {
    const code = (data.code || '').replace(/(.{4})(.{4})/, '$1-$2');
    card.innerHTML = `
      <button class="btn-link" id="back">← Mudar número</button>
      <h2>Liga o teu WhatsApp</h2>
      <p class="sub">No telemóvel com o número <b>${esc(data.phone)}</b>:</p>
      <ol class="steps">
        <li><span>Abre o <b>WhatsApp</b> e toca em <b>⋮</b> (ou <b>Definições</b> no iPhone)</span></li>
        <li><span>Toca em <b>Dispositivos ligados</b> → <b>Ligar um dispositivo</b></span></li>
        <li><span>Toca em <b>Ligar com número de telefone</b> (em baixo)</span></li>
        <li><span>Escreve este código:</span></li>
      </ol>
      <div class="code-box"><div class="code" id="code">${esc(code)}</div><button id="copy">Copiar código</button></div>
      <div class="waiting"><span class="spin"></span><span id="wtxt">À espera que ligues o WhatsApp…</span></div>
      <p class="err" id="err"></p>`;
    $('#back').onclick = () => { stopPoll(); renderLogin('phone'); };
    $('#copy').onclick = () => navigator.clipboard?.writeText(data.code).then(() => toast('Código copiado'));
    startPoll(async () => {
      const r = await api(`/api/login/${data.loginId}`, { allow401: true });
      if (r.status === 'ligado') { stopPoll(); toast('WhatsApp ligado! 🎉'); state.tab = 'grupos'; boot(); }
      else if (r.status === 'expirado') { stopPoll(); $('#err').textContent = 'O código expirou. Volta atrás e tenta de novo.'; }
      else if (r.code && r.code !== data.code) { data.code = r.code; $('#code').textContent = r.code.replace(/(.{4})(.{4})/, '$1-$2'); }
      else if (r.status === 'a_ligar') $('#wtxt').textContent = 'Ligado! A preparar o bot…';
    });
  }

  if (step === 'otp') {
    card.innerHTML = `
      <button class="btn-link" id="back">← Mudar número</button>
      <h2>Código de acesso</h2>
      <p class="sub">Enviámos um código de 6 dígitos para o teu WhatsApp <b>${esc(data.phone)}</b>. Abre a conversa <b>contigo próprio</b> ("Tu" / "Mensagem para mim").</p>
      <form id="f">
        <input class="otp" id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" required>
        <p class="err" id="err"></p>
        <button class="btn btn-primary btn-block" id="go">Entrar</button>
      </form>`;
    $('#back').onclick = () => renderLogin('phone');
    $('#otp').focus();
    $('#f').onsubmit = async e => {
      e.preventDefault();
      try {
        await api(`/api/login/${data.loginId}/otp`, { method: 'POST', body: { code: $('#otp').value }, allow401: true });
        boot();
      } catch (err) { $('#err').textContent = err.message; }
    };
  }
}

let pollTimer;
function startPoll(fn, ms = 2000) { stopPoll(); const loop = async () => { try { await fn(); } catch {} if (pollTimer) pollTimer = setTimeout(loop, ms); }; pollTimer = setTimeout(loop, ms); }
function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }

// ======================= PAINEL =======================
async function boot() {
  try {
    state.me = await api('/api/me', { allow401: true });
  } catch {
    return renderLogin();
  }
  renderShell();
  startPoll(refreshMe, 8000);
}

async function refreshMe() {
  if (state.dirty) return;
  const me = await api('/api/me');
  const changed = JSON.stringify(me.stats) !== JSON.stringify(state.me.stats) || me.status !== state.me.status;
  state.me = me;
  if (changed) {
    state.orders = null;
    renderTop();
    if (['inicio', 'pedidos'].includes(state.tab)) renderTab();
  }
}

const TABS = [
  ['inicio', 'Início'], ['grupos', 'Grupos'], ['pedidos', 'Pedidos'], ['pacotes', 'Pacotes'], ['fraudes', 'Fraudes'], ['definicoes', 'Definições'],
];
const STATUS = { ligado: ['on', 'WhatsApp ligado'], a_ligar: ['warn', 'A ligar…'], aguarda_codigo: ['warn', 'À espera do código'], desligado: ['', 'Desligado'], sessao_terminada: ['', 'Sessão terminada'] };

function renderShell() {
  app.innerHTML = `
    <header class="top"><div class="top-in" id="topbar"></div><nav class="tabs" id="tabs"></nav></header>
    <main id="main"></main>
    <div class="savebar" id="savebar"><span>Tens alterações por guardar</span><button class="btn btn-accent btn-sm" id="saveBtn">Guardar</button></div>`;
  renderTop();
  renderTab();
}

function renderTop() {
  const me = state.me;
  const [cls, label] = STATUS[me.status] || ['', me.status];
  $('#topbar').innerHTML = `
    <div class="brand">${logo}<span class="ellipsis" style="max-width:40vw">${esc(me.config.businessName)}</span></div>
    <span class="pill ${cls}"><i></i>${label}</span>
    <span class="spacer"></span>
    <button class="btn-link" id="logout">Sair</button>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); stopPoll(); state.me = null; renderLogin(); };
  $('#tabs').innerHTML = TABS.map(([id, name]) => {
    const badge = id === 'pedidos' && me.stats.pending ? `<span class="badge">${me.stats.pending}</span>`
      : id === 'fraudes' && me.stats.openReports ? `<span class="badge">${me.stats.openReports}</span>` : '';
    return `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${name}${badge}</button>`;
  }).join('');
  $('#tabs').onclick = e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (state.dirty && !confirm('Tens alterações por guardar. Sair sem guardar?')) return;
    setDirty(false);
    state.tab = b.dataset.tab;
    renderTop();
    renderTab();
  };
}

function setDirty(v, onSave) {
  state.dirty = v;
  $('#savebar')?.classList.toggle('show', v);
  if (onSave) $('#saveBtn').onclick = onSave;
}

function renderTab() {
  const main = $('#main');
  ({ inicio: tabInicio, grupos: tabGrupos, pedidos: tabPedidos, pacotes: tabPacotes, fraudes: tabFraudes, definicoes: tabDefinicoes })[state.tab](main);
}

// ---------- Início ----------
function tabInicio(main) {
  const { stats, config, activity, status } = state.me;
  const noGroups = !(config.groups || []).length;
  main.innerHTML = `
    ${status !== 'ligado' ? `<div class="banner" style="background:#fff4d6;border-color:#f0d58a"><div class="grow"><b>⚠️ O bot não está ligado ao WhatsApp</b><p>Sai e entra outra vez com o teu número para o voltar a ligar.</p></div></div>` : ''}
    ${noGroups ? `<div class="banner"><div class="grow"><b>Último passo: escolhe os grupos</b><p>Diz ao bot em que grupos deve trabalhar. No privado ele já está a funcionar.</p></div><button class="btn btn-primary" data-go="grupos">Escolher grupos →</button></div>` : ''}
    <div class="h"><div><h2>Olá 👋</h2><p>Resumo de hoje</p></div></div>
    <div class="grid stats">
      <div class="card stat hl"><div class="k">Pendentes</div><div class="v">${stats.pending}</div></div>
      <div class="card stat"><div class="k">Concluídos hoje</div><div class="v">${stats.doneToday}</div></div>
      <div class="card stat"><div class="k">Facturado hoje</div><div class="v">${mt(stats.revenueToday)}</div></div>
      <div class="card stat"><div class="k">Denúncias abertas</div><div class="v">${stats.openReports}</div></div>
    </div>
    <div class="section-t">Actividade recente</div>
    <div class="card feed">${activity.length ? activity.slice(0, 12).map(a => `
      <div class="it"><span class="muted small" style="flex:none;width:64px">${ago(a.at)}</span><span class="grow ellipsis"><b>${esc(fmtPhone(a.from))}</b> <span class="muted">${esc(a.text)}</span></span></div>`).join('')
      : '<div class="empty"><div class="e">💬</div>Ainda sem mensagens. Quando os clientes escreverem, aparece aqui.</div>'}
    </div>
    <div class="section-t">Comandos no WhatsApp (só para ti)</div>
    <div class="card cmds">
      <div><code>ok 12</code> pedido enviado</div>
      <div><code>rejeitar 12 motivo</code></div>
      <div><code>fila</code> · <code>vendas</code></div>
      <div><code>!preco 1GB Vodacom 50 | 24h</code></div>
      <div><code>!remover @pessoa</code></div>
      <div><code>!advertir @pessoa</code></div>
      <div><code>!banir 84XXXXXXX motivo</code></div>
      <div><code>!aviso texto</code> menciona todos</div>
      <div><code>!fechargrupo</code> · <code>!abrirgrupo</code></div>
      <div><code>!antilink on</code> · <code>!ia on/off</code></div>
      <div><code>bot, muda o 2GB para 85</code> (IA)</div>
      <div><code>ajuda</code> lista completa</div>
    </div>`;
  main.querySelector('[data-go]')?.addEventListener('click', () => { state.tab = 'grupos'; renderTop(); renderTab(); });
}

// ---------- Grupos ----------
async function tabGrupos(main) {
  main.innerHTML = `<div class="h"><div><h2>Grupos</h2><p>Activa o bot nos grupos onde vendes. Para remover e adicionar membros, o teu número tem de ser administrador do grupo.</p></div></div><div class="list" id="gl"><div class="card empty"><span class="spin" style="display:inline-block"></span></div></div>`;
  try {
    state.groups = (await api('/api/groups')).groups;
  } catch (e) {
    $('#gl').innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
    return;
  }
  const gl = $('#gl');
  if (!state.groups.length) {
    gl.innerHTML = `<div class="card empty"><div class="e">👥</div>${state.me.status === 'ligado' ? 'Não encontrei grupos neste WhatsApp.' : 'Liga o WhatsApp para ver os teus grupos.'}</div>`;
    return;
  }
  const aiOk = state.me.aiAvailable;
  gl.innerHTML = state.groups.map(g => {
    const s = g.settings || {};
    return `
    <div class="card group ${g.enabled ? 'on' : ''}" data-id="${esc(g.id)}">
      <div class="group-head">
        <div class="avatar">${esc((g.name || '?').trim()[0]?.toUpperCase())}</div>
        <div class="grow" style="min-width:0">
          <div class="ellipsis" style="font-weight:700">${esc(g.name)}</div>
          <div class="small muted">${g.size} membros · ${g.botIsAdmin ? '<span class="tag green">és admin</span>' : '<span class="tag amber">não és admin</span>'}</div>
        </div>
        <label class="switch" title="Activar bot"><input type="checkbox" data-k="enabled" ${g.enabled ? 'checked' : ''}><span></span></label>
      </div>
      ${g.enabled ? `<div class="gopts">
        <div class="gopt"><span class="grow">🤖 Responder perguntas com IA${aiOk ? '' : ' <span class="tag">indisponível</span>'}</span><label class="switch"><input type="checkbox" data-k="ai" ${s.ai !== false ? 'checked' : ''} ${aiOk ? '' : 'disabled'}><span></span></label></div>
        <div class="gopt"><span class="grow">🔗 Anti-link (apaga links de outros grupos)</span><label class="switch"><input type="checkbox" data-k="antilink" ${s.antilink ? 'checked' : ''}><span></span></label></div>
        <div class="gopt"><span class="grow">👋 Boas-vindas a novos membros</span><label class="switch"><input type="checkbox" data-k="welcomeOn" ${s.welcome ? 'checked' : ''}><span></span></label></div>
        ${s.welcome ? `<textarea class="in" data-k="welcome" rows="2">${esc(s.welcome)}</textarea><div class="small muted">Usa {nome} para mencionar a pessoa e {menu} para mostrar os pacotes.</div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  const save = async (id, patch) => {
    const g = state.groups.find(x => x.id === id);
    const enabledIds = state.groups.filter(x => x.enabled).map(x => x.id);
    await api('/api/groups', { method: 'PUT', body: { groups: enabledIds, settings: patch ? { [id]: patch } : undefined } });
    Object.assign(g.settings ||= {}, patch || {});
    state.me.config.groups = enabledIds;
  };
  gl.onchange = async e => {
    const el = e.target;
    const card = el.closest('[data-id]');
    const id = card.dataset.id;
    const g = state.groups.find(x => x.id === id);
    const k = el.dataset.k;
    try {
      if (k === 'enabled') { g.enabled = el.checked; await save(id); toast(el.checked ? `Bot activo em "${g.name}" ✅` : 'Bot desactivado neste grupo'); }
      else if (k === 'ai') await save(id, { ai: el.checked });
      else if (k === 'antilink') await save(id, { antilink: el.checked ? 'convites' : false });
      else if (k === 'welcomeOn') await save(id, { welcome: el.checked ? `Bem-vindo(a) {nome}! 👋\nEscreve *menu* para veres os pacotes.` : null });
      else if (k === 'welcome') { await save(id, { welcome: el.value.trim() || null }); toast('Mensagem guardada'); return; }
      tabGrupos(main);
    } catch (err) { toast(err.message); }
  };
}

// ---------- Pedidos ----------
async function tabPedidos(main) {
  if (!state.orders) {
    main.innerHTML = `<div class="card empty"><span class="spin" style="display:inline-block"></span></div>`;
    state.orders = (await api('/api/orders')).orders;
  }
  const f = state.orderFilter;
  const list = state.orders.filter(o => f === 'todos' || o.status === f || (f === 'pendente' && o.status === 'aguarda_numero'));
  const statusTag = { pendente: '<span class="tag amber">pendente</span>', aguarda_numero: '<span class="tag blue">falta número</span>', concluido: '<span class="tag green">concluído</span>', rejeitado: '<span class="tag red">rejeitado</span>' };
  main.innerHTML = `
    <div class="h"><div><h2>Pedidos</h2><p>Envia os megas e toca em "Enviado": o cliente é avisado no WhatsApp.</p></div>
      <div class="seg" id="seg">${[['pendente', 'Pendentes'], ['concluido', 'Concluídos'], ['rejeitado', 'Rejeitados'], ['todos', 'Todos']].map(([k, n]) => `<button class="${f === k ? 'on' : ''}" data-f="${k}">${n}</button>`).join('')}</div>
    </div>
    <div class="list">${list.length ? list.map(o => `
      <div class="card order" data-id="${o.id}">
        <div class="order-top"><span class="order-id">#${o.id}</span>${statusTag[o.status] || ''}<span class="muted small">${ago(o.createdAt)} · ${esc(o.customerName || fmtPhone(o.customerPhone))}</span></div>
        <div class="row"><div class="grow">
          <div class="order-target">${esc(fmtPhone(o.targetPhone))}</div>
          <div class="small muted">${esc(o.packageName || (o.amount != null ? mt(o.amount) : 'Comprovativo em imagem'))}${o.provider && o.provider !== 'imagem' ? ` · ${esc(o.provider)}` : ''}${o.txId ? ` · <span class="mono">${esc(o.txId)}</span>` : ''}</div>
        </div>${o.amount != null ? `<b>${mt(o.amount)}</b>` : ''}</div>
        ${o.needsReview && o.reviewReason ? `<div class="review">⚠️ ${esc(o.reviewReason)}</div>` : ''}
        ${o.rejectReason ? `<div class="small muted">Motivo: ${esc(o.rejectReason)}</div>` : ''}
        ${o.status === 'pendente' ? `<div class="order-actions">
          <button class="btn btn-ok btn-sm" data-a="done">✓ Enviado</button>
          <button class="btn btn-sm" data-a="copy">Copiar número</button>
          <button class="btn btn-danger btn-sm" data-a="reject">Rejeitar</button></div>` : ''}
      </div>`).join('') : `<div class="card empty"><div class="e">${f === 'pendente' ? '🎉' : '📭'}</div>${f === 'pendente' ? 'Nenhum pedido à espera.' : 'Sem pedidos aqui.'}</div>`}
    </div>`;
  $('#seg').onclick = e => { const b = e.target.closest('[data-f]'); if (b) { state.orderFilter = b.dataset.f; tabPedidos(main); } };
  main.querySelector('.list').onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    const o = state.orders.find(x => String(x.id) === id);
    try {
      if (b.dataset.a === 'copy') { await navigator.clipboard?.writeText(o.targetPhone); return toast('Número copiado'); }
      if (b.dataset.a === 'done') { b.disabled = true; await api(`/api/orders/${id}/done`, { method: 'POST' }); toast(`#${id} concluído — cliente avisado ✅`); }
      if (b.dataset.a === 'reject') {
        const reason = prompt('Motivo da rejeição (o cliente vai ver):', 'Pagamento não recebido');
        if (reason === null) return;
        await api(`/api/orders/${id}/reject`, { method: 'POST', body: { reason } });
        toast(`#${id} rejeitado`);
      }
      state.orders = null;
      state.me = await api('/api/me');
      renderTop();
      tabPedidos(main);
    } catch (err) { toast(err.message); b.disabled = false; }
  };
}

// ---------- Pacotes ----------
function tabPacotes(main) {
  const pk = structuredClone(state.me.config.packages);
  const draw = () => {
    main.innerHTML = `
      <div class="h"><div><h2>Tabela de preços</h2><p>O bot reconhece o pacote pelo valor pago, por isso cada preço deve ser diferente.</p></div></div>
      <div class="card form" id="pk">
        ${pk.map((p, i) => `
          <div class="pkg-row" data-i="${i}">
            <input class="in" data-k="name" value="${esc(p.name)}" placeholder="Ex: 1GB Vodacom" aria-label="Nome">
            <input class="in" data-k="price" type="number" min="0" step="0.5" value="${esc(p.price)}" placeholder="MT" aria-label="Preço (MT)">
            <input class="in val" data-k="validity" value="${esc(p.validity || '')}" placeholder="Validade (ex: 24h)" aria-label="Validade">
            <button class="icon-btn" data-del="${i}" title="Remover" aria-label="Remover">✕</button>
          </div>`).join('')}
        ${dupes().length ? `<div class="review">⚠️ Preços repetidos: ${dupes().map(mt).join(', ')}. O bot não vai saber distinguir estes pacotes.</div>` : ''}
        <div><button class="btn btn-sm" id="add">+ Adicionar pacote</button></div>
      </div>
      <p class="small muted">Também podes mudar preços pelo WhatsApp: <code>!preco 1GB Vodacom 45 | 24h</code> ou falando com a IA: <i>"bot, põe o 5GB a 190"</i>.</p>`;
    $('#add').onclick = () => { pk.push({ name: '', price: '', validity: '' }); draw(); setDirty(true, save); main.querySelector('.pkg-row:last-of-type input')?.focus(); };
    $('#pk').oninput = e => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const p = pk[row.dataset.i];
      const k = e.target.dataset.k;
      p[k] = k === 'price' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
      setDirty(true, save);
    };
    $('#pk').onclick = e => { const d = e.target.closest('[data-del]'); if (d) { pk.splice(Number(d.dataset.del), 1); draw(); setDirty(true, save); } };
  };
  const dupes = () => { const seen = {}; pk.forEach(p => { if (p.price !== '') seen[p.price] = (seen[p.price] || 0) + 1; }); return Object.keys(seen).filter(k => seen[k] > 1); };
  const save = async () => {
    const clean = pk.filter(p => p.name.trim() && p.price !== '').map(p => ({ name: p.name.trim(), price: Number(p.price), ...(p.validity?.trim() ? { validity: p.validity.trim() } : {}) }));
    try {
      state.me.config = (await api('/api/config', { method: 'PUT', body: { packages: clean } })).config;
      setDirty(false);
      toast('Tabela guardada ✅');
      tabPacotes(main);
    } catch (e) { toast(e.message); }
  };
  draw();
}

// ---------- Fraudes ----------
async function tabFraudes(main) {
  main.innerHTML = `<div class="card empty"><span class="spin" style="display:inline-block"></span></div>`;
  const { reports, banned } = await api('/api/fraud');
  const open = reports.filter(r => r.status === 'aberta');
  main.innerHTML = `
    <div class="h"><div><h2>Fraudes</h2><p>Os clientes denunciam com <code>denunciar 84XXXXXXX motivo</code>. A lista negra é partilhada com todos os vendedores do BotMegas.</p></div></div>
    <div class="two">
      <div class="card form">
        <b>🔎 Verificar um número</b>
        <div class="row"><input class="in grow" id="chk" inputmode="numeric" placeholder="84 123 4567"><button class="btn btn-primary" id="chkBtn">Verificar</button></div>
        <div id="chkRes"></div>
      </div>
      <div class="card form">
        <b>🚫 Banir um número</b>
        <input class="in" id="banPh" inputmode="numeric" placeholder="84 123 4567">
        <input class="in" id="banWhy" placeholder="Motivo (ex: comprovativo falso)">
        <button class="btn btn-danger" id="banBtn">Banir e remover dos meus grupos</button>
      </div>
    </div>
    <div class="section-t">Denúncias abertas (${open.length})</div>
    <div class="list" id="rep">${open.length ? open.map(r => `
      <div class="card row" data-id="${r.id}" style="flex-wrap:wrap">
        <div class="grow"><b class="mono" style="font-size:16px">${esc(fmtPhone(r.phone))}</b> <span class="muted small">#${r.id} · ${ago(r.at)}</span>
          <div class="small">${esc(r.reason || 'Sem motivo')}</div><div class="small muted">por ${esc(r.byName || r.by)}</div></div>
        <div class="order-actions"><button class="btn btn-danger btn-sm" data-a="ban">Banir</button><button class="btn btn-sm" data-a="dismiss">Descartar</button></div>
      </div>`).join('') : '<div class="card empty"><div class="e">🛡️</div>Nenhuma denúncia aberta.</div>'}</div>
    <div class="section-t">Lista negra (${banned.length})</div>
    <div class="card">${banned.length ? banned.slice(0, 100).map(b => `
      <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <span class="mono grow"><b>${esc(fmtPhone(b.phone))}</b> <span class="muted small">${esc(b.reason || '')}</span></span>
        ${b.mine ? `<button class="btn btn-sm" data-unban="${esc(b.phone)}">Desbanir</button>` : '<span class="tag">outro vendedor</span>'}
      </div>`).join('') : '<div class="empty">A lista negra está vazia.</div>'}</div>`;

  $('#chkBtn').onclick = async () => {
    try {
      const r = await api(`/api/fraud/check?phone=${encodeURIComponent($('#chk').value)}`);
      const txt = { limpo: '✅ Sem registos', suspeito: `⚠️ Suspeito — ${r.reports} denúncia(s)`, alto: `🔴 Risco alto — ${r.reports} denúncias de ${r.sellers} vendedor(es)`, banido: `🚫 BANIDO${r.banned?.reason ? ': ' + r.banned.reason : ''}` }[r.level];
      $('#chkRes').innerHTML = `<div class="risk ${r.level}">${esc(txt)}</div>`;
    } catch (e) { $('#chkRes').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#banBtn').onclick = async () => {
    const phone = $('#banPh').value;
    if (!confirm(`Banir ${phone}? Será removido dos teus grupos e marcado para todos os vendedores.`)) return;
    try { await api('/api/fraud/ban', { method: 'POST', body: { phone, reason: $('#banWhy').value } }); toast('Número banido 🚫'); tabFraudes(main); } catch (e) { toast(e.message); }
  };
  $('#rep').onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    try { await api(`/api/fraud/reports/${id}`, { method: 'POST', body: { action: b.dataset.a } }); toast(b.dataset.a === 'ban' ? 'Banido 🚫' : 'Denúncia descartada'); state.me = await api('/api/me'); renderTop(); tabFraudes(main); } catch (err) { toast(err.message); }
  };
  main.onclick = async e => {
    const u = e.target.closest('[data-unban]');
    if (!u) return;
    try { await api('/api/fraud/unban', { method: 'POST', body: { phone: u.dataset.unban } }); toast('Desbanido'); tabFraudes(main); } catch (err) { toast(err.message); }
  };
}

// ---------- Definições ----------
function tabDefinicoes(main) {
  const c = structuredClone(state.me.config);
  c.ai ||= {};
  const accRow = (a, i) => `
    <div class="pkg-row" data-acc="${i}">
      <select class="in" data-k="provider">${['M-Pesa', 'e-Mola', 'mKesh'].map(p => `<option ${a.provider === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <input class="in" data-k="number" inputmode="numeric" value="${esc(a.number)}" placeholder="Número">
      <input class="in val" data-k="name" value="${esc(a.name)}" placeholder="Nome da conta">
      <button class="icon-btn" data-delacc="${i}" aria-label="Remover">✕</button>
    </div>`;
  const draw = () => {
    main.innerHTML = `
      <div class="h"><div><h2>Definições</h2></div></div>
      <div class="card form" id="df">
        <label class="f">Nome do negócio<input class="in" data-k="businessName" value="${esc(c.businessName)}"></label>
        <div class="section-t" style="margin:6px 0 0">Contas para receber pagamentos</div>
        <div class="form" id="accs">${c.paymentAccounts.map(accRow).join('')}</div>
        <div><button class="btn btn-sm" id="addAcc">+ Adicionar conta</button></div>
        <label class="f">Administradores <small>Números que recebem os avisos e podem dar comandos (separados por vírgula)</small>
          <input class="in" data-k="admins" value="${esc((c.admins || []).join(', '))}"></label>
        <div class="two">
          <label class="f">Abre às <small>Vazio = 24 horas</small><input class="in" type="time" data-k="open" value="${esc(c.hours?.open || '')}"></label>
          <label class="f">Fecha às<input class="in" type="time" data-k="close" value="${esc(c.hours?.close || '')}"></label>
        </div>
        <div class="two">
          <label class="f">Minutos por pedido <small>Para o tempo estimado</small><input class="in" type="number" min="1" data-k="minutesPerOrder" value="${esc(c.minutesPerOrder)}"></label>
          <label class="f">Lembrar-me após (min) <small>Pedidos parados</small><input class="in" type="number" min="1" data-k="reminderMinutes" value="${esc(c.reminderMinutes)}"></label>
        </div>
        <div class="gopt"><span class="grow">Aceitar prints (imagens) como comprovativo</span><label class="switch"><input type="checkbox" data-k="acceptImageProofs" ${c.acceptImageProofs !== false ? 'checked' : ''}><span></span></label></div>
        <div class="gopt"><span class="grow">Responder no privado</span><label class="switch"><input type="checkbox" data-k="privateChats" ${c.privateChats !== false ? 'checked' : ''}><span></span></label></div>

        <div class="section-t" style="margin:10px 0 0">Assistente com IA ${state.me.aiAvailable ? '' : '<span class="tag">não configurada no servidor</span>'}</div>
        <div class="gopt"><span class="grow">Ligar a IA</span><label class="switch"><input type="checkbox" data-k="aiEnabled" ${c.ai.enabled !== false ? 'checked' : ''}><span></span></label></div>
        <div class="gopt"><span class="grow">Responder a perguntas no grupo sem ser mencionada</span><label class="switch"><input type="checkbox" data-k="aiAnswer" ${c.ai.answerQuestions !== false ? 'checked' : ''}><span></span></label></div>
        <label class="f">Informação extra para a IA <small>Regras do grupo, promoções, prazos de entrega… A IA usa isto para responder.</small>
          <textarea class="in" data-k="extraInfo" placeholder="Ex: Entregamos em 5 minutos. Promoção de sexta: 10GB a 300MT.">${esc(c.ai.extraInfo || '')}</textarea></label>
      </div>
      <div class="section-t">Zona de perigo</div>
      <div class="card row" style="flex-wrap:wrap"><div class="grow"><b>Desligar o WhatsApp</b><div class="small muted">O bot deixa de funcionar e o dispositivo é removido do teu WhatsApp.</div></div><button class="btn btn-danger" id="unlink">Desligar</button></div>`;
    $('#df').oninput = $('#df').onchange = e => {
      const el = e.target;
      const k = el.dataset.k;
      const acc = el.closest('[data-acc]');
      if (acc) { c.paymentAccounts[acc.dataset.acc][k] = el.value; }
      else if (k === 'admins') c.admins = el.value.split(/[,;\s]+/).map(s => s.replace(/\D/g, '').replace(/^258/, '')).filter(Boolean);
      else if (k === 'open' || k === 'close') { c.hours = { ...(c.hours || {}), [k]: el.value }; }
      else if (k === 'aiEnabled') c.ai.enabled = el.checked;
      else if (k === 'aiAnswer') c.ai.answerQuestions = el.checked;
      else if (k === 'extraInfo') c.ai.extraInfo = el.value;
      else if (el.type === 'checkbox') c[k] = el.checked;
      else if (el.type === 'number') c[k] = Number(el.value);
      else if (k) c[k] = el.value;
      setDirty(true, save);
    };
    $('#addAcc').onclick = () => { c.paymentAccounts.push({ provider: 'e-Mola', number: '', name: '' }); draw(); setDirty(true, save); };
    $('#accs').onclick = e => { const d = e.target.closest('[data-delacc]'); if (d) { c.paymentAccounts.splice(Number(d.dataset.delacc), 1); draw(); setDirty(true, save); } };
    $('#unlink').onclick = async () => {
      if (!confirm('Desligar o bot do teu WhatsApp?')) return;
      await api('/api/unlink', { method: 'POST' });
      stopPoll(); renderLogin();
    };
  };
  const save = async () => {
    const hours = c.hours?.open && c.hours?.close ? { open: c.hours.open, close: c.hours.close } : null;
    const body = {
      businessName: c.businessName.trim() || 'Os Meus Megas',
      paymentAccounts: c.paymentAccounts.filter(a => a.number.trim()).map(a => ({ ...a, number: a.number.replace(/\D/g, '').replace(/^258/, '') })),
      admins: c.admins, hours, minutesPerOrder: c.minutesPerOrder || 3, reminderMinutes: c.reminderMinutes || 10,
      acceptImageProofs: c.acceptImageProofs !== false, privateChats: c.privateChats !== false, ai: c.ai,
    };
    try {
      state.me.config = (await api('/api/config', { method: 'PUT', body })).config;
      setDirty(false);
      renderTop();
      toast('Definições guardadas ✅');
    } catch (e) { toast(e.message); }
  };
  draw();
}

window.addEventListener('beforeunload', e => { if (state.dirty) e.preventDefault(); });
boot();
