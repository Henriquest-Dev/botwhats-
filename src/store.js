// Armazenamento simples em ficheiro JSON (sem base de dados para instalar).
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = () => ({ nextId: 1, orders: [], usedTx: {}, drafts: {}, warnings: {}, paused: false });

export class Store {
  constructor(file) {
    this.file = file;
    if (file && fs.existsSync(file)) {
      this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } else {
      this.data = EMPTY();
    }
  }

  save() {
    if (!this.file) return; // modo memória (testes)
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  createOrder(fields) {
    const order = { id: this.data.nextId++, status: 'pendente', createdAt: Date.now(), ...fields };
    this.data.orders.push(order);
    if (order.txId) this.data.usedTx[order.txId] = order.id;
    this.save();
    return order;
  }

  getOrder(id) { return this.data.orders.find(o => o.id === Number(id)); }

  updateOrder(id, patch) {
    const o = this.getOrder(id);
    if (!o) return null;
    Object.assign(o, patch);
    this.save();
    return o;
  }

  txUsed(txId) { return txId ? this.data.usedTx[txId] : undefined; }

  pending() { return this.data.orders.filter(o => o.status === 'pendente'); }
  awaitingNumber(userKey) {
    return this.data.orders.find(o => o.status === 'aguarda_numero' && o.userKey === userKey);
  }
  ordersOf(userKey) { return this.data.orders.filter(o => o.userKey === userKey); }

  setDraft(userKey, draft) { this.data.drafts[userKey] = { ...draft, at: Date.now() }; this.save(); }
  getDraft(userKey, maxAgeMs) {
    const d = this.data.drafts[userKey];
    if (!d || Date.now() - d.at > maxAgeMs) return null;
    return d;
  }
  clearDraft(userKey) { delete this.data.drafts[userKey]; this.save(); }

  addWarning(groupId, who) {
    this.data.warnings ||= {};
    const g = (this.data.warnings[groupId] ||= {});
    g[who] = (g[who] || 0) + 1;
    this.save();
    return g[who];
  }
  resetWarnings(groupId, who) { if (this.data.warnings?.[groupId]) { delete this.data.warnings[groupId][who]; this.save(); } }

  setPaused(v) { this.data.paused = v; this.save(); }
}
