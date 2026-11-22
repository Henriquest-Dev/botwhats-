// Site público: preços ao vivo, links de WhatsApp e a conversa animada.
document.documentElement.classList.add('js');
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mt = v => Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 2 });
$('#year').textContent = new Date().getFullYear();

let contact = null;
const waLink = text => (contact ? `https://wa.me/258${contact}?text=${encodeURIComponent(text)}` : '#precos');

function wireWhatsApp() {
  document.querySelectorAll('[data-wa]').forEach(a => {
    a.href = waLink(a.dataset.wa);
    if (contact) { a.target = '_blank'; a.rel = 'noopener'; }
  });
}

function renderPlans(plans) {
  const cards = $('#cards');
  if (!plans.length) { cards.innerHTML = '<p class="cards-empty">Fala connosco no WhatsApp para saberes os preços.</p>'; return; }
  cards.innerHTML = plans.map(p => {
    const per = p.days === 7 ? 'por semana' : p.days === 30 ? 'por mês' : `por ${p.days} dias`;
    const groups = p.maxGroups === 1 ? '1 grupo' : `Até ${p.maxGroups} grupos`;
    return `
    <article class="card ${p.highlight ? 'hl' : ''}">
      <div class="card-top"><span class="card-name">${esc(p.name)}</span>${p.highlight ? '<span class="card-pick">O mais escolhido</span>' : ''}</div>
      <div class="card-price">${mt(p.price)}<small>MT</small></div>
      <div class="card-per">${per}</div>
      <hr class="card-rule">
      <ul>
        <li>${groups}</li>
        <li>Pedidos e clientes ilimitados</li>
        <li>Lista negra partilhada</li>
        <li>Assistente com inteligência artificial</li>
      </ul>
      <div class="scratch" tabindex="0" aria-label="Código de activação de exemplo">!ativar MZ-7K2Q</div>
      <a class="btn btn-sun" data-wa="Olá! Quero o plano ${esc(p.name)} do BotMegas (${mt(p.price)} MT)." href="#">Escolher ${esc(p.name)}</a>
    </article>`;
  }).join('');
  cards.querySelectorAll('.scratch').forEach(s => s.addEventListener('click', () => s.classList.add('open')));
}

async function loadSite() {
  try {
    const res = await fetch('/api/public/site');
    const d = await res.json();
    contact = d.contactPhone;
    renderPlans(d.plans || []);
    if (d.stats) {
      $('#bannedNum').textContent = d.stats.banned;
      if (d.stats.banned >= 10) $('#networkIn').classList.remove('no-num');
      if (d.stats.groups >= 3) {
        const proof = $('#proof');
        proof.textContent = `Já a trabalhar em ${d.stats.groups} grupos de megas em Moçambique.`;
        proof.hidden = false;
      }
    }
  } catch {
    renderPlans([]);
  }
  wireWhatsApp();
}

// ---- Conversa animada: um único momento, quando o telemóvel aparece no ecrã
const steps = [...document.querySelectorAll('#chat [data-step]')];
const typing = $('#chat .typing');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let timers = [];

function play() {
  timers.forEach(clearTimeout);
  timers = [];
  $('#replay').hidden = true;
  steps.forEach(s => s.classList.remove('show'));
  if (reduced) { steps.forEach(s => s.classList.add('show')); return; }
  const plan = [[400, 1, false], [1500, 2, true], [3900, 3, false], [5000, 4, true]];
  for (const [at, n, botTyping] of plan) {
    if (botTyping) timers.push(setTimeout(() => { typing.classList.add('show'); typing.parentNode.insertBefore(typing, steps[n - 1]); }, at - 900));
    timers.push(setTimeout(() => { typing.classList.remove('show'); steps[n - 1].classList.add('show'); }, at));
  }
  timers.push(setTimeout(() => { $('#replay').hidden = false; }, 6200));
}
$('#replay').addEventListener('click', play);
new IntersectionObserver((entries, obs) => {
  if (entries[0].isIntersecting) { play(); obs.disconnect(); }
}, { threshold: 0.35 }).observe($('.phone'));

loadSite();
