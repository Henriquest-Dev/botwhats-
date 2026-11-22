// Dados de exemplo para a demonstração (DEMO=1). Só corre se ainda não houver revendedores.
import { fakeGroups, fakeSockets } from './fake-socket.js';

const DAY = 864e5;
const BOT = '841000000';

export async function seedDemo(platform) {
  const st = platform.state;
  if (st.resellers.length) return;
  platform.saveSettings('owner', { name: 'Luís', phone: '845550000', paymentAccounts: [{ provider: 'M-Pesa', number: '845550000', name: 'Luís S.' }, { provider: 'e-Mola', number: '865550000', name: 'Luís S.' }] });
  st.botNumbers.push({ phone: BOT, label: 'Bot principal', status: 'desligado', createdAt: Date.now() - 40 * DAY });
  await platform.authStore.writeMany(BOT, [{ key: 'creds', value: '{}' }]);

  const people = [
    ['Zé dos Megas', '841112233', 'mensal', 22], ['Megas Baratos Matola', '862223344', 'pro', 11],
    ['Celso Net', '847778800', 'semanal', 2], ['Amina Dados', '823334455', 'mensal', -3], ['Net Rápida Beira', '871234567', 'mensal', 27],
  ];
  const groupNames = { '841112233': ['Megas do Zé 🇲🇿'], '862223344': ['Matola Internet', 'Vendas Machava', 'Megas 24h'], '847778800': ['Celso Net Clientes'], '823334455': ['Amina — Megas'], '871234567': ['Beira Megas'] };
  for (const [name, phone, planId, daysLeft] of people) {
    const r = await platform.createReseller({ name, phone, planId });
    const plan = platform.plan(planId);
    // histórico de pagamentos
    for (let k = 0; k < 3; k++) {
      const p = await platform.repo.addPayment({ resellerId: r.id, amount: plan.price, days: plan.days, method: k % 2 ? 'e-Mola' : 'M-Pesa', createdAt: Date.now() - (daysLeft < 0 ? 40 : 5) * DAY - k * plan.days * DAY });
      st.payments.push(p);
    }
    r.expiresAt = Date.now() + daysLeft * DAY;
    r.createdAt = Date.now() - 80 * DAY;
    r.botPhone = BOT;
    platform.repo.saveReseller(r);
    for (const gname of groupNames[phone]) {
      const jid = `1203630${Math.floor(Math.random() * 1e9)}@g.us`;
      fakeGroups[jid] = { id: jid, subject: gname, participants: [{ id: `258${BOT}@s.whatsapp.net`, admin: 'admin' }, { id: `258${phone}@s.whatsapp.net`, admin: 'superadmin' }] };
      const g = { jid, resellerId: r.id, botPhone: BOT, name: gname, active: true, activatedAt: Date.now() - 30 * DAY, activatedBy: phone };
      st.groups.push(g);
      platform.repo.saveGroup(g);
    }
  }
  // algumas denúncias
  platform.fraud.report({ tenant: st.resellers[0].id, phone: '847778899', reason: 'Recebeu o dinheiro e saiu do grupo', by: '845551234', byName: 'Ana' });
  platform.fraud.report({ tenant: st.resellers[1].id, phone: '847778899', reason: 'Comprovativo falso', by: '862223399', byName: 'Hélder' });
  platform.fraud.report({ tenant: st.resellers[1].id, phone: '829990011', reason: 'Print editado', by: '862223388', byName: 'Sónia' });
  platform.fraud.ban('826665544', { tenant: st.resellers[0].id, reason: 'Comprovativos falsos repetidos' });
}

/** Depois de ligar, simula clientes a comprar nos grupos. */
export function simulateTraffic(platform) {
  const sock = fakeSockets.get(BOT);
  if (!sock) return;
  const groups = platform.state.groups.filter(g => g.active);
  const proofs = [
    ['845551234', 'Ana Cossa', 'Confirmado DK47HJ2X9P. Transferiste 50.00MT para 841112233 - ZE aos 22/11/26. Numero: 845551234'],
    ['862223344', 'Hélder M.', 'ID da transacao: PP261122.1020.A88213. Transferiste 90.00MT para conta 862223344. Para 86 222 3344'],
    ['827778899', 'Sónia', 'Confirmado QW12ER34TY. Transferiste 200.00MT para 841112233. 827778899'],
    ['849990011', 'Dércio', 'Confirmado PL09OK87IJ. Transferiste 50.00MT para 862223344. 849990011'],
  ];
  proofs.forEach(([pn, name, text], i) => {
    const g = groups[i % groups.length];
    setTimeout(() => sock.receive(g.jid, text, { participant: `258${pn}@s.whatsapp.net`, name }), 800 + i * 700);
  });
}
