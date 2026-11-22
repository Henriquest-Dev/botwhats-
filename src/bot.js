// Lógica do bot, independente do WhatsApp (fácil de testar).
// Recebe uma mensagem já "traduzida" e devolve uma lista de acções a executar.
import { parseProof, findPhones, normalizePhone } from './parser.js';
import { T, fmtMT } from './messages.js';

const DRAFT_MAX_AGE = 15 * 60 * 1000;

export class Bot {
  constructor(config, store, now = () => Date.now()) {
    this.cfg = config;
    this.store = store;
    this.now = now;
    this.ourNumbers = new Set(config.paymentAccounts.map(a => normalizePhone(a.number)).filter(Boolean));
  }

  /**
   * msg: {
   *   chatId, isGroup, userKey (id estável do remetente), customerPhone (9 dígitos ou null),
   *   customerName, isAdmin, text, hasImage, ref (mensagem original, para citar/reencaminhar)
   * }
   * Devolve acções: {type:'reply', chatId, text, quote?} | {type:'admin', text} | {type:'forwardToAdmins', ref}
   */
  handle(msg) {
    const text = (msg.text || '').trim();
    const lower = text.toLowerCase();

    if (msg.isAdmin) {
      const res = this.handleAdmin(msg, lower, text);
      if (res) return res;
      if (msg.fromMe) return []; // mensagens do próprio vendedor que não são comandos: ignorar
    }

    // --- Comandos do cliente ---
    if (/^(menu|pacotes|precos|preços|tabela|!menu)$/.test(lower)) {
      return [reply(msg, T.menu(this.cfg))];
    }
    if (/^(estado|status|meu pedido|meus pedidos|!estado)$/.test(lower)) {
      return [reply(msg, T.status(this.store.ordersOf(msg.userKey)))];
    }

    // --- Resposta a "para qual número?" ---
    const waiting = this.store.awaitingNumber(msg.userKey);
    if (waiting && !parseProof(text) && !msg.hasImage) {
      let phone = null;
      if (/^(sim|s|yes|este|esse|meu)$/i.test(lower) && msg.customerPhone) phone = msg.customerPhone;
      else phone = findPhones(text).find(p => !this.ourNumbers.has(p)) || null;
      if (phone) return this.finishOrder(waiting, phone, msg);
      if (!msg.isGroup) return [reply(msg, T.askNumber(waiting, msg.customerPhone))];
      return [];
    }

    // --- Comprovativo em texto ---
    const proof = parseProof(text);
    if (proof) return this.handleProof(msg, text, proof);

    // --- Comprovativo em imagem (print) ---
    if (msg.hasImage && this.cfg.acceptImageProofs !== false) {
      return this.handleImageProof(msg, text);
    }

    // --- Só um número (talvez o comprovativo venha a seguir) ---
    const phones = findPhones(text).filter(p => !this.ourNumbers.has(p));
    if (phones.length && text.replace(/[\d\s+\-]/g, '').length < 20) {
      this.store.setDraft(msg.userKey, { phone: phones[0] });
      return [];
    }

    // Em privado, se não percebemos a mensagem, mostramos ajuda.
    if (!msg.isGroup && this.cfg.replyUnknownInPrivate !== false) {
      return [reply(msg, `Olá${msg.customerName ? ' ' + msg.customerName : ''}! 👋\n\n` + T.menu(this.cfg))];
    }
    return [];
  }

  matchPackage(amount) {
    if (amount == null) return null;
    return this.cfg.packages.find(p => Math.abs(p.price - amount) < 0.01) || null;
  }

  handleProof(msg, text, proof) {
    if (proof.txId) {
      const prev = this.store.txUsed(proof.txId);
      if (prev) {
        return [
          reply(msg, T.duplicate(proof.txId, prev)),
          { type: 'admin', text: `🚨 Comprovativo repetido ${proof.txId} enviado por ${msg.customerName || ''} (${msg.customerPhone || msg.userKey}). Original: pedido #${prev}.` },
        ];
      }
    }

    const reasons = [];
    if (!proof.txId) reasons.push('Não encontrei o ID da transacção');
    if (proof.recipient && this.ourNumbers.size && !this.ourNumbers.has(proof.recipient)) {
      reasons.push(`Pagamento feito para ${proof.recipient}, que não é nosso número`);
    }
    const pkg = this.matchPackage(proof.amount);
    if (!pkg) reasons.push(`Valor ${fmtMT(proof.amount)} não corresponde a nenhum pacote`);

    // Número de destino: na própria mensagem (excluindo os nossos números e o destinatário), ou um rascunho anterior.
    const phones = findPhones(text).filter(p => !this.ourNumbers.has(p) && p !== proof.recipient);
    const draft = this.store.getDraft(msg.userKey, DRAFT_MAX_AGE);
    const targetPhone = phones[0] || draft?.phone || null;

    const order = this.store.createOrder({
      kind: 'texto',
      chatId: msg.chatId,
      userKey: msg.userKey,
      customerPhone: msg.customerPhone,
      customerName: msg.customerName,
      provider: proof.provider,
      txId: proof.txId,
      amount: proof.amount,
      recipient: proof.recipient,
      packageName: pkg?.name || null,
      needsReview: reasons.length > 0,
      reviewReason: reasons.join('; ') || null,
      targetPhone,
      status: targetPhone ? 'pendente' : 'aguarda_numero',
      ref: msg.quoteRef ?? null,
    });
    if (draft) this.store.clearDraft(msg.userKey);

    if (!targetPhone) return [reply(msg, T.askNumber(order, msg.customerPhone))];
    const actions = this.announce(order, msg, false);
    if (proof.recipient && this.ourNumbers.size && !this.ourNumbers.has(proof.recipient)) {
      actions.push(reply(msg, T.wrongRecipient(order)));
    }
    return actions;
  }

  handleImageProof(msg, caption) {
    const phones = findPhones(caption).filter(p => !this.ourNumbers.has(p));
    const draft = this.store.getDraft(msg.userKey, DRAFT_MAX_AGE);
    const targetPhone = phones[0] || draft?.phone || null;
    const order = this.store.createOrder({
      kind: 'imagem',
      chatId: msg.chatId,
      userKey: msg.userKey,
      customerPhone: msg.customerPhone,
      customerName: msg.customerName,
      provider: 'imagem',
      txId: null,
      amount: null,
      packageName: null,
      needsReview: true,
      reviewReason: 'Comprovativo em imagem — confirma o pagamento no teu telemóvel',
      targetPhone,
      status: targetPhone ? 'pendente' : 'aguarda_numero',
      ref: msg.quoteRef ?? null,
    });
    if (draft) this.store.clearDraft(msg.userKey);
    const actions = [{ type: 'forwardToAdmins', ref: msg.ref }];
    if (!targetPhone) return [...actions, reply(msg, T.askNumber(order, msg.customerPhone))];
    return [...actions, ...this.announce(order, msg, true)];
  }

  finishOrder(order, phone, msg) {
    this.store.updateOrder(order.id, { targetPhone: phone, status: 'pendente' });
    return this.announce(order, msg, order.kind === 'imagem');
  }

  closedMessage() {
    if (this.store.data.paused) return T.paused;
    const h = this.cfg.hours;
    if (!h) return null;
    const hhmm = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.cfg.timezone || 'Africa/Maputo', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(this.now()));
    const open = h.open <= h.close ? (hhmm >= h.open && hhmm < h.close) : (hhmm >= h.open || hhmm < h.close);
    return open ? null : T.closed(this.cfg);
  }

  announce(order, msg, isImage) {
    const pending = this.store.pending();
    const pos = pending.findIndex(o => o.id === order.id) + 1 || pending.length;
    const eta = Math.max(1, pos * (this.cfg.minutesPerOrder || 3));
    const closed = this.closedMessage();
    const text = isImage ? T.receivedImage(order, pos, eta, closed) : T.received(order, pos, eta, closed);
    return [reply(msg, text), { type: 'admin', text: T.adminNew(order, pos) }];
  }

  // ---------------- Vendedor ----------------
  handleAdmin(msg, lower, text) {
    let m;
    if ((m = lower.match(/^(?:ok|feito|enviado|done|✅)\s+#?(\d+(?:[\s,]+#?\d+)*)\s*$/))) {
      const ids = m[1].split(/[\s,#]+/).filter(Boolean).map(Number);
      const out = [];
      const done = [], missing = [];
      for (const id of ids) {
        const o = this.store.getOrder(id);
        if (!o || o.status === 'concluido' || o.status === 'rejeitado') { missing.push(id); continue; }
        this.store.updateOrder(id, { status: 'concluido', doneAt: this.now() });
        out.push({ type: 'reply', chatId: o.chatId, text: T.done(o), quote: o.ref });
        done.push(id);
      }
      out.push(reply(msg, [
        done.length ? `✅ Concluído(s): ${done.map(i => '#' + i).join(', ')}` : null,
        missing.length ? `⚠️ Não encontrado(s) ou já fechado(s): ${missing.map(i => '#' + i).join(', ')}` : null,
        `📋 Pendentes: ${this.store.pending().length}`,
      ].filter(Boolean).join('\n')));
      return out;
    }
    if ((m = text.match(/^(?:rejeitar|recusar|cancelar)\s+#?(\d+)\s*(.*)$/i))) {
      const o = this.store.getOrder(m[1]);
      if (!o) return [reply(msg, `⚠️ Pedido #${m[1]} não existe.`)];
      this.store.updateOrder(o.id, { status: 'rejeitado', rejectReason: m[2] || null, doneAt: this.now() });
      return [
        { type: 'reply', chatId: o.chatId, text: T.rejected(o, m[2]), quote: o.ref },
        reply(msg, `❌ Pedido #${o.id} rejeitado.`),
      ];
    }
    if (/^(fila|pendentes|!fila)$/.test(lower)) return [reply(msg, T.adminQueue(this.store.pending()))];
    if ((m = lower.match(/^pedido\s+#?(\d+)$/))) {
      const o = this.store.getOrder(m[1]);
      return [reply(msg, o ? T.adminNew(o, '-') + `\n\nEstado: *${o.status}*` : `⚠️ Pedido #${m[1]} não existe.`)];
    }
    if (/^(vendas|resumo|stats)$/.test(lower)) return [reply(msg, this.salesSummary())];
    if (/^(pausar|fechar)$/.test(lower)) { this.store.setPaused(true); return [reply(msg, '⏸️ Vendas pausadas. Os pedidos continuam a ser registados.')]; }
    if (/^(retomar|abrir)$/.test(lower)) { this.store.setPaused(false); return [reply(msg, '▶️ Vendas retomadas.')]; }
    if (/^(ajuda|comandos|!ajuda)$/.test(lower)) return [reply(msg, T.adminHelp)];
    return null;
  }

  salesSummary() {
    const tz = this.cfg.timezone || 'Africa/Maputo';
    const day = ts => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ts));
    const today = day(this.now());
    const todays = this.store.data.orders.filter(o => day(o.createdAt) === today);
    const done = todays.filter(o => o.status === 'concluido');
    const total = done.reduce((s, o) => s + (o.amount || 0), 0);
    return [
      `📊 *Resumo de hoje (${today})*`,
      `• Pedidos: ${todays.length}`,
      `• Concluídos: ${done.length}`,
      `• Pendentes: ${todays.filter(o => o.status === 'pendente').length}`,
      `• Rejeitados: ${todays.filter(o => o.status === 'rejeitado').length}`,
      `• Total facturado: *${fmtMT(total)}*`,
    ].join('\n');
  }

  /** Chamado a cada minuto: lembra o vendedor de pedidos parados. */
  tick() {
    const mins = this.cfg.reminderMinutes || 10;
    const limit = this.now() - mins * 60000;
    const late = this.store.pending().filter(o => o.createdAt < limit && (!o.remindedAt || o.remindedAt < limit));
    if (!late.length) return [];
    for (const o of late) this.store.updateOrder(o.id, { remindedAt: this.now() });
    return [{ type: 'admin', text: T.adminReminder(late) }];
  }
}

function reply(msg, text) {
  return { type: 'reply', chatId: msg.chatId, text, quote: msg.quoteRef };
}
