// Pedidos de UM revendedor, em memória. Cada alteração é passada a `onChange`
// para ser gravada na base de dados (Supabase ou ficheiro local).
export class Store {
  /** @param {{orders?: object[], paused?: boolean, onChange?: Function}} [opts] */
  constructor(opts = null) {
    const orders = opts?.orders || [];
    this.onChange = opts?.onChange || (() => {});
    this.data = {
      nextId: orders.reduce((m, o) => Math.max(m, o.id), 0) + 1,
      orders,
      usedTx: Object.fromEntries(orders.filter(o => o.txId).map(o => [o.txId, o.id])),
      drafts: {},
      warnings: {},
      paused: !!opts?.paused,
    };
  }

  createOrder(fields) {
    const order = { id: this.data.nextId++, status: 'pendente', createdAt: Date.now(), ...fields };
    this.data.orders.push(order);
    if (order.txId) this.data.usedTx[order.txId] = order.id;
    this.onChange('order', order);
    return order;
  }

  getOrder(id) { return this.data.orders.find(o => o.id === Number(id)); }

  updateOrder(id, patch) {
    const o = this.getOrder(id);
    if (!o) return null;
    Object.assign(o, patch);
    this.onChange('order', o);
    return o;
  }

  txUsed(txId) { return txId ? this.data.usedTx[txId] : undefined; }
  pending() { return this.data.orders.filter(o => o.status === 'pendente'); }
  awaitingNumber(userKey) { return this.data.orders.find(o => o.status === 'aguarda_numero' && o.userKey === userKey); }
  ordersOf(userKey) { return this.data.orders.filter(o => o.userKey === userKey); }

  setDraft(userKey, draft) { this.data.drafts[userKey] = { ...draft, at: Date.now() }; }
  getDraft(userKey, maxAgeMs) {
    const d = this.data.drafts[userKey];
    return d && Date.now() - d.at <= maxAgeMs ? d : null;
  }
  clearDraft(userKey) { delete this.data.drafts[userKey]; }

  addWarning(groupId, who) {
    const g = (this.data.warnings[groupId] ||= {});
    g[who] = (g[who] || 0) + 1;
    return g[who];
  }
  resetWarnings(groupId, who) { if (this.data.warnings[groupId]) delete this.data.warnings[groupId][who]; }

  setPaused(v) { this.data.paused = v; this.onChange('paused', v); }
}
