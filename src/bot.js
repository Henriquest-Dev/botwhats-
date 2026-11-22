// Lógica do bot, independente do WhatsApp (fácil de testar).
// Recebe uma mensagem já "traduzida" e devolve uma lista de acções a executar.
import { parseProof, findPhones, normalizePhone } from './parser.js';
import { T, fmtMT } from './messages.js';
import { FraudRegistry } from './fraud.js';
import { AI_TOOLS_ADMIN, AI_TOOLS_PUBLIC } from './ai.js';

const DRAFT_MAX_AGE = 15 * 60 * 1000;
const INVITE_LINK = /chat\.whatsapp\.com\/[A-Za-z0-9]+/i;
const ANY_LINK = /(https?:\/\/|www\.)\S+/i;
const AI_PREFIX = /^(bot|ia|assistente)\s*[,:]/i;
const jidOf = phone => `258${phone}@s.whatsapp.net`;

// Comandos que só o administrador pode usar (com ou sem "!")
const ADMIN_ONLY = /^[!/.]?(remover|expulsar|kick|adicionar|add|banir|ban|desbanir|advertir|aviso|todos|fechargrupo|abrirgrupo|fechar grupo|abrir grupo|preco|preço|removerpacote|antilink|boasvindas|ia|denuncias|denúncias|fila|vendas|pausar|retomar|ok|feito|rejeitar|pedido)\b/i;

export class Bot {
  constructor(config, store, opts = {}) {
    if (typeof opts === 'function') opts = { now: opts }; // compatibilidade
    this.cfg = config;
    this.store = store;
    this.now = opts.now || (() => Date.now());
    this.fraud = opts.fraud || new FraudRegistry(null);
    this.ai = opts.ai || null;
    this.tenantId = opts.tenantId || 'local';
    this.saveConfig = opts.saveConfig || (() => {});
    this.history = new Map(); // memória curta da IA por conversa
    this.aiCooldown = new Map();
    this.refreshNumbers();
  }

  refreshNumbers() {
    this.ourNumbers = new Set((this.cfg.paymentAccounts || []).map(a => normalizePhone(a.number)).filter(Boolean));
  }

  groupSettings(chatId) {
    this.cfg.groupSettings ||= {};
    return (this.cfg.groupSettings[chatId] ||= {});
  }

  /**
   * msg: {
   *   chatId, isGroup, userKey, userJid, customerPhone, customerName, isAdmin, fromMe,
   *   text, hasImage, ref, quoteRef,
   *   targets: [{jid, phone}]  (pessoas mencionadas ou a mensagem respondida),
   *   mentionsBot, replyToBot
   * }
   */
  async handle(msg) {
    const text = (msg.text || '').trim();
    const lower = text.toLowerCase();
    msg.targets ||= [];

    if (msg.isAdmin) {
      const res = await this.handleAdmin(msg, lower, text);
      if (res) return res;
      // Mensagens normais do próprio vendedor são ignoradas, excepto se falar com a IA ("bot, ...")
      if (msg.fromMe && !(msg.mentionsBot || msg.replyToBot || AI_PREFIX.test(text))) return [];
    } else if (/^[!/.]/.test(text) && ADMIN_ONLY.test(lower)) {
      return [reply(msg, '⛔ Este comando é só para o administrador.')];
    }

    // --- Moderação automática nos grupos ---
    if (msg.isGroup && !msg.isAdmin) {
      const mod = this.moderate(msg, text);
      if (mod) return mod;
    }

    // --- Comandos do cliente ---
    if (/^[!/.]?(menu|pacotes|precos|preços|tabela)$/.test(lower)) return [reply(msg, T.menu(this.cfg))];
    if (/^[!/.]?(estado|status|meu pedido|meus pedidos)$/.test(lower)) {
      return [reply(msg, T.status(this.store.ordersOf(msg.userKey)))];
    }
    if (/^[!/.]?(denunciar|denuncia|denúncia|reportar|golpe)\b/.test(lower)) return this.cmdReport(msg, text);
    if (/^[!/.]?(verificar|checar|consultar)\b/.test(lower)) return this.cmdCheck(msg, text);

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

    // --- Comprovativos ---
    const proof = parseProof(text);
    if (proof) return this.handleProof(msg, text, proof);
    if (msg.hasImage && this.cfg.acceptImageProofs !== false) return this.handleImageProof(msg, text);

    // --- Só um número (talvez o comprovativo venha a seguir) ---
    const phones = findPhones(text).filter(p => !this.ourNumbers.has(p));
    if (phones.length && text.replace(/[\d\s+\-]/g, '').length < 20) {
      this.store.setDraft(msg.userKey, { phone: phones[0] });
      return [];
    }

    // --- IA: conversa natural ---
    if (this.shouldUseAI(msg, lower)) return this.askAI(msg, text);

    if (!msg.isGroup && this.cfg.replyUnknownInPrivate !== false) {
      return [reply(msg, `Olá${msg.customerName ? ' ' + msg.customerName : ''}! 👋\n\n` + T.menu(this.cfg))];
    }
    return [];
  }

  // ---------------- Moderação ----------------
  moderate(msg, text) {
    const gs = this.groupSettings(msg.chatId);
    const banned = this.fraud.isBanned(msg.customerPhone);
    if (banned) {
      return [
        { type: 'delete', chatId: msg.chatId, key: msg.ref?.key },
        { type: 'group', op: 'remove', chatId: msg.chatId, jids: [msg.userJid] },
        { type: 'send', chatId: msg.chatId, text: T.fraudAlert(msg.customerPhone, banned.reason) },
      ];
    }
    const linkRe = gs.antilink === 'all' ? ANY_LINK : INVITE_LINK;
    if (gs.antilink && linkRe.test(text)) {
      const out = [{ type: 'delete', chatId: msg.chatId, key: msg.ref?.key }];
      return out.concat(this.warn(msg.chatId, { jid: msg.userJid, phone: msg.customerPhone, key: msg.userKey }, 'enviar links'));
    }
    return null;
  }

  warn(chatId, target, reason) {
    const max = this.cfg.maxWarnings || 3;
    const n = this.store.addWarning(chatId, target.key || target.jid);
    if (n >= max) {
      this.store.resetWarnings(chatId, target.key || target.jid);
      return [
        { type: 'send', chatId, text: `🚫 @${tag(target)} foi removido(a) após ${max} advertências.`, mentions: [target.jid] },
        { type: 'group', op: 'remove', chatId, jids: [target.jid] },
      ];
    }
    return [{ type: 'send', chatId, text: `⚠️ @${tag(target)}, advertência *${n}/${max}*${reason ? ` por ${reason}` : ''}.`, mentions: [target.jid] }];
  }

  /** Quando alguém entra no grupo. participants: [{jid, phone}] */
  onJoin(chatId, participants) {
    if (!this.cfg.groups?.includes(chatId)) return [];
    const gs = this.groupSettings(chatId);
    const out = [];
    for (const p of participants) {
      const banned = this.fraud.isBanned(p.phone);
      const risk = this.fraud.check(p.phone);
      if (banned) {
        out.push({ type: 'group', op: 'remove', chatId, jids: [p.jid] });
        out.push({ type: 'send', chatId, text: T.fraudAlert(p.phone, banned.reason) });
      } else {
        if (risk.level === 'alto' || risk.level === 'suspeito') {
          out.push({ type: 'admin', text: `⚠️ Entrou no grupo um número com *${risk.reports} denúncia(s)*: ${p.phone}. Usa *!banir ${p.phone}* se for fraude.` });
        }
        if (gs.welcome) {
          out.push({ type: 'send', chatId, text: gs.welcome.replace(/\{nome\}/g, '@' + tag(p)).replace(/\{menu\}/g, T.menu(this.cfg)), mentions: [p.jid] });
        }
      }
    }
    return out;
  }

  // ---------------- Fraudes ----------------
  resolveTarget(msg, text) {
    if (msg.targets[0]) return msg.targets[0];
    const phone = findPhones(text)[0];
    return phone ? { jid: jidOf(phone), phone } : null;
  }

  cmdReport(msg, text) {
    const target = this.resolveTarget(msg, text);
    if (!target?.phone) {
      return [reply(msg, '🚨 Para denunciar, escreve: *denunciar 84XXXXXXX motivo*\n(ou responde à mensagem da pessoa com *denunciar motivo*)')];
    }
    const reason = text.replace(/^[!/.]?\S+/, '').replace(/(?:\+?258)?\s?8[2-7][\s\d-]{7,11}/, '').replace(/@\d+/g, '').trim() || null;
    const r = this.fraud.report({
      tenant: this.tenantId, phone: target.phone, reason, by: msg.customerPhone || msg.userKey, byName: msg.customerName, groupId: msg.isGroup ? msg.chatId : null,
    });
    const risk = this.fraud.check(target.phone);
    const out = [
      reply(msg, `✅ Denúncia *#${r.id}* registada contra *${target.phone}*. Obrigado por ajudares a manter o grupo seguro! 🛡️`),
      { type: 'admin', text: `🚨 *Nova denúncia #${r.id}*\nContra: *${target.phone}*\nMotivo: ${reason || '—'}\nPor: ${msg.customerName || ''} (${msg.customerPhone || msg.userKey})\nTotal de denúncias: ${risk.reports}\n\nUsa *!banir ${target.phone} motivo* para banir.` },
    ];
    if (msg.isGroup && risk.reports >= (this.cfg.autoAlertReports || 3)) {
      out.push({ type: 'send', chatId: msg.chatId, text: `⚠️ *ATENÇÃO:* o número *${target.phone}* tem *${risk.reports} denúncias* de fraude. Cuidado ao negociar!` });
    }
    return out;
  }

  cmdCheck(msg, text) {
    const target = this.resolveTarget(msg, text);
    if (!target?.phone) return [reply(msg, '🔎 Escreve: *verificar 84XXXXXXX*')];
    return [reply(msg, T.riskReport(this.fraud.check(target.phone)))];
  }

  // ---------------- Pedidos ----------------
  matchPackage(amount) {
    if (amount == null) return null;
    return this.cfg.packages.find(p => Math.abs(p.price - amount) < 0.01) || null;
  }

  riskReasons(phone) {
    const risk = this.fraud.check(phone);
    if (risk.level === 'limpo') return [];
    return [`Cliente ${risk.level === 'banido' ? 'BANIDO' : `com ${risk.reports} denúncia(s)`}`];
  }

  handleProof(msg, text, proof) {
    if (proof.txId) {
      const prev = this.store.txUsed(proof.txId);
      if (prev) {
        this.fraud.report({ tenant: this.tenantId, phone: msg.customerPhone, reason: `Comprovativo repetido ${proof.txId}`, by: 'bot', groupId: msg.isGroup ? msg.chatId : null });
        return [
          reply(msg, T.duplicate(proof.txId, prev)),
          { type: 'admin', text: `🚨 Comprovativo repetido ${proof.txId} enviado por ${msg.customerName || ''} (${msg.customerPhone || msg.userKey}). Original: pedido #${prev}. Denúncia automática registada.` },
        ];
      }
    }

    const reasons = this.riskReasons(msg.customerPhone);
    if (!proof.txId) reasons.push('Não encontrei o ID da transacção');
    const wrongRecipient = proof.recipient && this.ourNumbers.size && !this.ourNumbers.has(proof.recipient);
    if (wrongRecipient) reasons.push(`Pagamento feito para ${proof.recipient}, que não é nosso número`);
    const pkg = this.matchPackage(proof.amount);
    if (!pkg) reasons.push(`Valor ${fmtMT(proof.amount)} não corresponde a nenhum pacote`);

    const phones = findPhones(text).filter(p => !this.ourNumbers.has(p) && p !== proof.recipient);
    const draft = this.store.getDraft(msg.userKey, DRAFT_MAX_AGE);
    const targetPhone = phones[0] || draft?.phone || null;

    const order = this.store.createOrder({
      kind: 'texto', chatId: msg.chatId, userKey: msg.userKey, customerPhone: msg.customerPhone, customerName: msg.customerName,
      provider: proof.provider, txId: proof.txId, amount: proof.amount, recipient: proof.recipient,
      packageName: pkg?.name || null, needsReview: reasons.length > 0, reviewReason: reasons.join('; ') || null,
      targetPhone, status: targetPhone ? 'pendente' : 'aguarda_numero', ref: msg.quoteRef ?? null,
    });
    if (draft) this.store.clearDraft(msg.userKey);

    if (!targetPhone) return [reply(msg, T.askNumber(order, msg.customerPhone))];
    const actions = this.announce(order, msg, false);
    if (wrongRecipient) actions.push(reply(msg, T.wrongRecipient(order)));
    return actions;
  }

  handleImageProof(msg, caption) {
    const phones = findPhones(caption).filter(p => !this.ourNumbers.has(p));
    const draft = this.store.getDraft(msg.userKey, DRAFT_MAX_AGE);
    const targetPhone = phones[0] || draft?.phone || null;
    const reasons = ['Comprovativo em imagem — confirma o pagamento no teu telemóvel', ...this.riskReasons(msg.customerPhone)];
    const order = this.store.createOrder({
      kind: 'imagem', chatId: msg.chatId, userKey: msg.userKey, customerPhone: msg.customerPhone, customerName: msg.customerName,
      provider: 'imagem', txId: null, amount: null, packageName: null, needsReview: true, reviewReason: reasons.join('; '),
      targetPhone, status: targetPhone ? 'pendente' : 'aguarda_numero', ref: msg.quoteRef ?? null,
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

  completeOrders(ids) {
    const out = [], done = [], missing = [];
    for (const id of ids) {
      const o = this.store.getOrder(id);
      if (!o || o.status === 'concluido' || o.status === 'rejeitado') { missing.push(id); continue; }
      this.store.updateOrder(id, { status: 'concluido', doneAt: this.now() });
      out.push({ type: 'reply', chatId: o.chatId, text: T.done(o), quote: o.ref });
      done.push(id);
    }
    return { out, done, missing };
  }

  rejectOrder(id, reason) {
    const o = this.store.getOrder(id);
    if (!o) return null;
    this.store.updateOrder(o.id, { status: 'rejeitado', rejectReason: reason || null, doneAt: this.now() });
    return { type: 'reply', chatId: o.chatId, text: T.rejected(o, reason), quote: o.ref };
  }

  // ---------------- Tabela de preços ----------------
  setPackage(name, price, validity) {
    const existing = this.cfg.packages.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { existing.price = price; if (validity) existing.validity = validity; }
    else this.cfg.packages.push({ name, price, ...(validity ? { validity } : {}) });
    this.saveConfig(this.cfg);
    return existing ? 'actualizado' : 'criado';
  }

  removePackage(name) {
    const i = this.cfg.packages.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    if (i < 0) return false;
    this.cfg.packages.splice(i, 1);
    this.saveConfig(this.cfg);
    return true;
  }

  // ---------------- Vendedor (administrador) ----------------
  async handleAdmin(msg, lower, text) {
    const cmd = lower.replace(/^[!/.]/, '');
    const raw = text.replace(/^[!/.]/, '');
    let m;

    if ((m = cmd.match(/^(?:ok|feito|enviado|done)\s+#?(\d+(?:[\s,]+#?\d+)*)\s*$/))) {
      const { out, done, missing } = this.completeOrders(m[1].split(/[\s,#]+/).filter(Boolean).map(Number));
      out.push(reply(msg, [
        done.length ? `✅ Concluído(s): ${done.map(i => '#' + i).join(', ')}` : null,
        missing.length ? `⚠️ Não encontrado(s) ou já fechado(s): ${missing.map(i => '#' + i).join(', ')}` : null,
        `📋 Pendentes: ${this.store.pending().length}`,
      ].filter(Boolean).join('\n')));
      return out;
    }
    if ((m = raw.match(/^(?:rejeitar|recusar|cancelar)\s+#?(\d+)\s*(.*)$/i))) {
      const a = this.rejectOrder(m[1], m[2]);
      if (!a) return [reply(msg, `⚠️ Pedido #${m[1]} não existe.`)];
      return [a, reply(msg, `❌ Pedido #${m[1]} rejeitado.`)];
    }
    if (/^(fila|pendentes)$/.test(cmd)) return [reply(msg, T.adminQueue(this.store.pending()))];
    if ((m = cmd.match(/^pedido\s+#?(\d+)$/))) {
      const o = this.store.getOrder(m[1]);
      return [reply(msg, o ? T.adminNew(o, '-') + `\n\nEstado: *${o.status}*` : `⚠️ Pedido #${m[1]} não existe.`)];
    }
    if (/^(vendas|resumo|stats)$/.test(cmd)) return [reply(msg, this.salesSummary())];
    if (/^pausar$/.test(cmd)) { this.store.setPaused(true); return [reply(msg, '⏸️ Vendas pausadas. Os pedidos continuam a ser registados.')]; }
    if (/^retomar$/.test(cmd)) { this.store.setPaused(false); return [reply(msg, '▶️ Vendas retomadas.')]; }
    if (/^(ajuda|comandos|admin)$/.test(cmd)) return [reply(msg, T.adminHelp)];

    // Tabela de preços: !preco 1GB Vodacom 50 | 24h
    if ((m = raw.match(/^pre[cç]o\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:mt)?\s*(?:\|\s*(.+))?$/i))) {
      const r = this.setPackage(m[1].trim(), parseFloat(m[2].replace(',', '.')), m[3]?.trim());
      return [reply(msg, `💾 Pacote *${m[1].trim()}* ${r}: ${fmtMT(m[2])}${m[3] ? ` (${m[3].trim()})` : ''}`)];
    }
    if ((m = raw.match(/^removerpacote\s+(.+)$/i))) {
      return [reply(msg, this.removePackage(m[1].trim()) ? `🗑️ Pacote *${m[1].trim()}* removido.` : `⚠️ Não encontrei o pacote "${m[1].trim()}".`)];
    }

    // Fraudes
    if ((m = raw.match(/^(?:banir|ban)\b\s*(.*)$/i))) {
      const target = this.resolveTarget(msg, m[1]);
      if (!target?.phone) return [reply(msg, 'Usa: *!banir 84XXXXXXX motivo* (ou responde à mensagem da pessoa)')];
      const reason = m[1].replace(/(?:\+?258)?\s?8[2-7][\s\d-]{7,11}/, '').replace(/@\d+/g, '').trim() || null;
      return this.banActions(target, reason, msg);
    }
    if ((m = cmd.match(/^desbanir\s+(.+)$/))) {
      const p = findPhones(m[1])[0];
      if (!p) return [reply(msg, 'Usa: *!desbanir 84XXXXXXX*')];
      this.fraud.unban(p);
      return [reply(msg, `✅ ${p} removido da lista negra.`)];
    }
    if (/^(denuncias|denúncias)$/.test(cmd)) {
      const open = this.fraud.reportsOf(this.tenantId).filter(r => r.status === 'aberta');
      return [reply(msg, open.length
        ? '🚨 *Denúncias abertas:*\n' + open.slice(-15).map(r => `• #${r.id} — *${r.phone}*: ${r.reason || '—'} (por ${r.byName || r.by})`).join('\n')
        : '✅ Nenhuma denúncia aberta.')];
    }

    // Gestão do grupo
    if (msg.isGroup) {
      if ((m = cmd.match(/^(?:remover|expulsar|kick)\b(.*)$/))) {
        const target = this.resolveTarget(msg, m[1]);
        if (!target) return [reply(msg, 'Usa: *!remover @pessoa* (ou responde à mensagem dela)')];
        return [{ type: 'group', op: 'remove', chatId: msg.chatId, jids: [target.jid] }, reply(msg, `👋 Removido(a).`)];
      }
      if ((m = cmd.match(/^(?:adicionar|add)\s+(.+)$/))) {
        const phones = findPhones(m[1]);
        if (!phones.length) return [reply(msg, 'Usa: *!adicionar 84XXXXXXX*')];
        const blocked = phones.filter(p => this.fraud.isBanned(p));
        const ok = phones.filter(p => !this.fraud.isBanned(p));
        const out = [];
        if (ok.length) out.push({ type: 'group', op: 'add', chatId: msg.chatId, jids: ok.map(jidOf) });
        out.push(reply(msg, [ok.length ? `➕ A adicionar: ${ok.join(', ')}` : null, blocked.length ? `🚫 Banido(s), não adicionado(s): ${blocked.join(', ')}` : null].filter(Boolean).join('\n')));
        return out;
      }
      if ((m = raw.match(/^advertir\b(.*)$/i))) {
        const target = this.resolveTarget(msg, m[1]);
        if (!target) return [reply(msg, 'Usa: *!advertir @pessoa motivo*')];
        const reason = m[1].replace(/@\d+/g, '').replace(/(?:\+?258)?\s?8[2-7][\s\d-]{7,11}/, '').trim();
        return this.warn(msg.chatId, target, reason);
      }
      if (/^(fechargrupo|fechar grupo)$/.test(cmd)) return [{ type: 'group', op: 'announcement', chatId: msg.chatId }, reply(msg, '🔒 Grupo fechado: só administradores podem escrever.')];
      if (/^(abrirgrupo|abrir grupo)$/.test(cmd)) return [{ type: 'group', op: 'not_announcement', chatId: msg.chatId }, reply(msg, '🔓 Grupo aberto: todos podem escrever.')];
      if ((m = raw.match(/^(?:aviso|todos)\s*([\s\S]*)$/i))) {
        return [{ type: 'mentionAll', chatId: msg.chatId, text: m[1].trim() ? `📢 *AVISO*\n\n${m[1].trim()}` : '📢 Atenção a todos!' }];
      }
      if ((m = cmd.match(/^antilink\s+(on|off|todos|all)$/))) {
        const gs = this.groupSettings(msg.chatId);
        gs.antilink = m[1] === 'off' ? false : (m[1] === 'on' ? 'convites' : 'all');
        this.saveConfig(this.cfg);
        return [reply(msg, gs.antilink ? `🔗 Anti-link activo (${gs.antilink === 'all' ? 'todos os links' : 'links de grupos'}).` : '🔗 Anti-link desligado.')];
      }
      if ((m = raw.match(/^boasvindas\s+([\s\S]+)$/i))) {
        const gs = this.groupSettings(msg.chatId);
        gs.welcome = /^off$/i.test(m[1].trim()) ? null : m[1].trim();
        this.saveConfig(this.cfg);
        return [reply(msg, gs.welcome ? '👋 Mensagem de boas-vindas guardada. Usa {nome} para mencionar e {menu} para mostrar os pacotes.' : '👋 Boas-vindas desligadas.')];
      }
    }
    if ((m = cmd.match(/^ia\s+(on|off)$/))) {
      if (msg.isGroup) this.groupSettings(msg.chatId).ai = m[1] === 'on';
      else (this.cfg.ai ||= {}).enabled = m[1] === 'on';
      this.saveConfig(this.cfg);
      return [reply(msg, m[1] === 'on' ? '🤖 IA ligada.' : '🤖 IA desligada.')];
    }
    return null; // não é comando: segue o fluxo normal (pode ir para a IA)
  }

  banActions(target, reason, msg) {
    this.fraud.ban(target.phone, { tenant: this.tenantId, reason });
    const out = [msg ? reply(msg, `🚫 *${target.phone}* banido e adicionado à lista negra.`) : { type: 'noop' }];
    const groups = msg?.isGroup ? [msg.chatId] : (this.cfg.groups || []);
    for (const g of groups) {
      out.push({ type: 'group', op: 'remove', chatId: g, jids: [target.jid || jidOf(target.phone)], silent: true });
      out.push({ type: 'send', chatId: g, text: T.fraudAlert(target.phone, reason) });
    }
    return out;
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

  // ---------------- IA ----------------
  shouldUseAI(msg, lower) {
    if (!this.ai?.enabled) return false;
    const enabled = msg.isGroup ? (this.groupSettings(msg.chatId).ai ?? this.cfg.ai?.enabled ?? true) : (this.cfg.ai?.enabled ?? true);
    if (!enabled) return false;
    if (!msg.isGroup) return true;
    if (msg.mentionsBot || msg.replyToBot || AI_PREFIX.test(lower)) return true;
    if (this.cfg.ai?.answerQuestions === false) return false;
    return /\?|quanto (custa|é|e)\b|pre[cç]o|tem (megas|pacote|\d+ ?gb)|como (compr|pag|fa[cç]o)|vende[ms]?\b|dispon[ií]vel/i.test(lower);
  }

  systemPrompt(msg) {
    const c = this.cfg;
    return [
      `És o assistente do "${c.businessName}", um revendedor de megas (pacotes de internet) em Moçambique, a falar no WhatsApp.`,
      'Fala português de Moçambique, de forma simpática, curta e directa (máximo 5 linhas). Usa emojis com moderação.',
      'Regras:',
      '- Nunca inventes preços nem pacotes. Usa apenas a tabela abaixo.',
      '- Nunca confirmes que um pagamento foi recebido: isso é feito pelo sistema quando o cliente envia o comprovativo.',
      '- Para comprar: pagar para um dos números abaixo e enviar aqui o SMS de confirmação + o número que vai receber os megas.',
      '- Se alguém falar de burla/golpe, explica que pode escrever "denunciar 84XXXXXXX motivo" e "verificar 84XXXXXXX".',
      '- Não fales de assuntos que não têm a ver com o negócio por muito tempo; volta educadamente ao tema.',
      msg.isAdmin ? '- Estás a falar com o ADMINISTRADOR (dono). Podes usar as ferramentas para mudar a tabela de preços, ver a fila, concluir pedidos, banir números e fazer anúncios. Confirma o que fizeste.' : '- Estás a falar com um cliente. Não tens poderes de administrador.',
      '',
      'Tabela de preços:',
      ...c.packages.map(p => `- ${p.name}: ${p.price} MT${p.validity ? ` (${p.validity})` : ''}`),
      'Pagamento:',
      ...c.paymentAccounts.map(a => `- ${a.provider}: ${a.number} (${a.name})`),
      c.hours ? `Horário: ${c.hours.open}–${c.hours.close}` : 'Horário: 24h',
      c.ai?.extraInfo ? `\nInformação extra do vendedor:\n${c.ai.extraInfo}` : '',
    ].join('\n');
  }

  async askAI(msg, text) {
    const key = msg.userKey;
    const last = this.aiCooldown.get(key) || 0;
    if (!msg.isAdmin && this.now() - last < (this.cfg.ai?.cooldownSeconds ?? 8) * 1000) return [];
    this.aiCooldown.set(key, this.now());

    const histKey = msg.chatId;
    const hist = this.history.get(histKey) || [];
    const userLine = msg.isGroup ? `${msg.customerName || 'Cliente'}: ${text}` : text;
    const messages = [{ role: 'system', content: this.systemPrompt(msg) }, ...hist, { role: 'user', content: userLine }];
    const tools = msg.isAdmin ? AI_TOOLS_ADMIN : AI_TOOLS_PUBLIC;
    const actions = [];

    try {
      let answer = '';
      for (let step = 0; step < 4; step++) {
        const r = await this.ai.chat(messages, tools);
        if (!r.toolCalls.length) { answer = r.content; break; }
        messages.push({ role: 'assistant', content: r.content || '', tool_calls: r.raw.tool_calls });
        for (const tc of r.toolCalls) {
          const result = this.runTool(tc.name, tc.args, msg, actions);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
      }
      if (!answer) answer = actions.length ? '✅ Feito.' : '';
      hist.push({ role: 'user', content: userLine }, { role: 'assistant', content: answer });
      this.history.set(histKey, hist.slice(-12));
      return answer ? [...actions, reply(msg, answer)] : actions;
    } catch (e) {
      console.error('IA:', e.message);
      return msg.isGroup ? actions : [...actions, reply(msg, T.menu(this.cfg))];
    }
  }

  runTool(name, a, msg, actions) {
    const admin = !!msg.isAdmin;
    switch (name) {
      case 'verificar_numero': {
        const p = normalizePhone(a.numero) || findPhones(String(a.numero))[0];
        return p ? JSON.stringify(this.fraud.check(p)) : 'número inválido';
      }
      case 'definir_preco':
        if (!admin) return 'sem permissão';
        return `pacote ${this.setPackage(String(a.nome), Number(a.preco), a.validade)}`;
      case 'remover_pacote':
        if (!admin) return 'sem permissão';
        return this.removePackage(String(a.nome)) ? 'removido' : 'não encontrado';
      case 'ver_fila':
        if (!admin) return 'sem permissão';
        return JSON.stringify(this.store.pending().map(o => ({ id: o.id, pacote: o.packageName, valor: o.amount, numero: o.targetPhone, verificar: o.needsReview })));
      case 'concluir_pedido': {
        if (!admin) return 'sem permissão';
        const { out, done } = this.completeOrders([Number(a.id)]);
        actions.push(...out);
        return done.length ? 'concluído e cliente avisado' : 'pedido não encontrado ou já fechado';
      }
      case 'banir_numero': {
        if (!admin) return 'sem permissão';
        const p = normalizePhone(a.numero) || findPhones(String(a.numero))[0];
        if (!p) return 'número inválido';
        actions.push(...this.banActions({ phone: p, jid: jidOf(p) }, a.motivo, msg).slice(1));
        return 'banido';
      }
      case 'anunciar':
        if (!admin || !msg.isGroup) return 'só funciona num grupo, pelo administrador';
        actions.push({ type: 'mentionAll', chatId: msg.chatId, text: `📢 *AVISO*\n\n${a.texto}` });
        return 'anúncio enviado';
      default:
        return 'ferramenta desconhecida';
    }
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
function tag(t) {
  return (t.jid || '').split('@')[0] || t.phone;
}
