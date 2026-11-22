// Textos do bot. Altera à vontade para o teu estilo.
export const fmtMT = v => `${Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} MT`;

export const T = {
  menu: (cfg) => {
    const lines = cfg.packages.map(p => `• *${p.name}* — ${fmtMT(p.price)}${p.validity ? ` (${p.validity})` : ''}`);
    const pay = cfg.paymentAccounts.map(a => `• ${a.provider}: *${a.number}* (${a.name})`);
    return [
      `📶 *${cfg.businessName}* — Pacotes disponíveis`,
      '',
      ...lines,
      '',
      '💳 *Pagamento:*',
      ...pay,
      '',
      '📝 *Como comprar:*',
      '1. Faz o pagamento',
      '2. Envia aqui a *mensagem de confirmação* (copia e cola o SMS) + o *número* que vai receber os megas',
      '3. O bot regista o teu pedido e avisa quando for enviado ✅',
      '',
      'Escreve *estado* para ver os teus pedidos.',
    ].join('\n');
  },

  received: (o, pos, etaMin, closedMsg) => [
    `✅ *Comprovativo recebido!* Pedido *#${o.id}*`,
    '',
    o.packageName ? `📦 Pacote: *${o.packageName}*` : `💰 Valor: *${fmtMT(o.amount)}*`,
    `📱 Número: *${o.targetPhone}*`,
    o.txId ? `🧾 Transacção: ${o.txId}` : null,
    '',
    closedMsg || `⏳ O teu pagamento está a ser processado. Estás na posição *${pos}* da fila — tempo estimado: *~${etaMin} min*.`,
    'Por favor aguarda, não é preciso reenviar o comprovativo. 🙏',
  ].filter(l => l !== null).join('\n'),

  receivedImage: (o, pos, etaMin, closedMsg) => [
    `🧾 *Comprovativo (imagem) recebido!* Pedido *#${o.id}*`,
    `📱 Número: *${o.targetPhone}*`,
    '',
    closedMsg || `⏳ Vamos verificar o pagamento manualmente. Posição na fila: *${pos}* — tempo estimado: *~${etaMin} min*.`,
    '💡 Dica: para ser mais rápido, copia e cola o *SMS de confirmação* em vez de enviar print.',
  ].join('\n'),

  askNumber: (o, ownPhone) => [
    `🧾 Comprovativo recebido (pedido *#${o.id}*).`,
    '',
    ownPhone
      ? `📱 Para qual número enviamos os megas? Responde com o número, ou *SIM* para enviar para *${ownPhone}*.`
      : '📱 Para qual número enviamos os megas? Responde só com o número (ex: 84 123 4567).',
  ].join('\n'),

  duplicate: (txId, prevId) =>
    `⚠️ Este comprovativo (${txId}) já foi usado no pedido *#${prevId}*. Se achas que é um erro, fala com o vendedor.`,

  wrongRecipient: (o) =>
    `⚠️ Pedido *#${o.id}*: o pagamento parece ter sido feito para *${o.recipient}*, que não é um dos nossos números. O vendedor vai verificar manualmente.`,

  done: (o) =>
    `🎉 *Pedido #${o.id} concluído!*\n${o.packageName ? `📦 ${o.packageName} ` : ''}enviado para *${o.targetPhone}*.\nObrigado pela preferência! 🙌`,

  rejected: (o, reason) =>
    `❌ *Pedido #${o.id} não foi aprovado.*${reason ? `\nMotivo: ${reason}` : ''}\nQualquer dúvida, fala com o vendedor.`,

  status: (orders) => {
    if (!orders.length) return 'ℹ️ Não tens pedidos registados. Escreve *menu* para ver os pacotes.';
    const icon = { pendente: '⏳', concluido: '✅', rejeitado: '❌', aguarda_numero: '📱' };
    return '📋 *Os teus últimos pedidos:*\n' + orders.slice(-5).reverse()
      .map(o => `${icon[o.status] || '•'} #${o.id} — ${o.packageName || fmtMT(o.amount ?? 0)} → ${o.targetPhone || '?'} (${o.status.replace('_', ' ')})`)
      .join('\n');
  },

  closed: (cfg) =>
    `🌙 Estamos fechados agora (horário: ${cfg.hours.open}–${cfg.hours.close}). O teu pedido fica na fila e será processado assim que abrirmos.`,
  paused: '⏸️ As vendas estão pausadas de momento. O teu pedido fica na fila e será processado assim que retomarmos.',

  // ---- Mensagens para o vendedor (admin) ----
  adminNew: (o, pos) => [
    `🆕 *Novo pedido #${o.id}*${o.needsReview ? '  ⚠️ VERIFICAR' : ''}`,
    `👤 ${o.customerName || 'Cliente'} (${o.customerPhone || o.userKey})`,
    o.packageName ? `📦 ${o.packageName}` : null,
    o.amount != null ? `💰 ${fmtMT(o.amount)} via ${o.provider}` : '🖼️ Comprovativo em imagem',
    o.txId ? `🧾 ${o.txId}` : null,
    o.reviewReason ? `⚠️ ${o.reviewReason}` : null,
    `📱 Enviar para: *${o.targetPhone}*`,
    `📊 Na fila: ${pos}`,
    '',
    `Responde: *ok ${o.id}* quando enviares, ou *rejeitar ${o.id} motivo*`,
  ].filter(l => l !== null).join('\n'),

  adminReminder: (list) =>
    `⏰ *Pedidos à espera há muito tempo:*\n` +
    list.map(o => `• #${o.id} — ${o.packageName || fmtMT(o.amount ?? 0)} → ${o.targetPhone} (${Math.round((Date.now() - o.createdAt) / 60000)} min)`).join('\n'),

  adminQueue: (list) => list.length
    ? `📋 *Fila (${list.length}):*\n` + list.map(o => `• #${o.id} — ${o.packageName || fmtMT(o.amount ?? 0)} → *${o.targetPhone}*${o.needsReview ? ' ⚠️' : ''}`).join('\n')
    : '✅ Fila vazia, nenhum pedido pendente.',

  fraudAlert: (phone, reason) => [
    '🚨 *ALERTA DE FRAUDE* 🚨',
    '',
    `O número *${phone}* foi *banido* por fraude${reason ? `: ${reason}` : ''}.`,
    'Não façam negócio com este número. Em caso de dúvida, escrevam *verificar 84XXXXXXX*.',
  ].join('\n'),

  riskReport: (r) => {
    const head = { limpo: '✅ *Sem registos*', suspeito: '⚠️ *Suspeito*', alto: '🔴 *Risco alto*', banido: '🚫 *BANIDO*' }[r.level];
    return [
      `🔎 Verificação de *${r.phone}*: ${head}`,
      r.reports ? `• ${r.reports} denúncia(s) de ${r.sellers} vendedor(es)` : '• Nenhuma denúncia registada',
      r.banned?.reason ? `• Motivo do banimento: ${r.banned.reason}` : null,
      r.level === 'limpo' ? '_Isto não garante que o número é de confiança. Paga sempre só a vendedores conhecidos._' : '❗ Cuidado ao negociar com este número.',
    ].filter(Boolean).join('\n');
  },

  adminHelp: [
    '🛠️ *Comandos do administrador*',
    '',
    '*Pedidos*',
    '• *ok 12* (ou *ok 12 13 14*) — marca como enviado e avisa o cliente',
    '• *rejeitar 12 motivo* — rejeita o pedido',
    '• *fila* · *pedido 12* · *vendas*',
    '• *pausar* / *retomar* — pausa ou retoma as vendas',
    '',
    '*Tabela de preços*',
    '• *!preco 1GB Vodacom 50 | 24h* — cria ou muda um pacote',
    '• *!removerpacote 1GB Vodacom*',
    '',
    '*Grupo*',
    '• *!remover @pessoa* (ou responde à mensagem dela)',
    '• *!adicionar 84XXXXXXX*',
    '• *!advertir @pessoa motivo* — 3 advertências = removido',
    '• *!fechargrupo* / *!abrirgrupo*',
    '• *!aviso texto* — anúncio que menciona todos',
    '• *!antilink on|todos|off*',
    '• *!boasvindas Olá {nome}! {menu}* (ou *off*)',
    '• *!ia on|off*',
    '',
    '*Fraudes*',
    '• *!banir 84XXXXXXX motivo* — lista negra + remove dos grupos + alerta',
    '• *!desbanir 84XXXXXXX* · *!denuncias*',
    '',
    '*Assinatura*',
    '• *assinatura* — plano, validade, grupos e como renovar',
    '• *!desativar* (no grupo) — liberta o lugar para outro grupo',
    '',
    '🤖 Também podes falar com a IA: "@bot muda o preço do 2GB para 85"',
].join('\n'),
};
