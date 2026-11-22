// Registo de fraudes: denúncias por vendedor + lista negra GLOBAL partilhada
// por todos os vendedores do sistema (quem é banido num grupo fica marcado em todos).

export class FraudRegistry {
  /** @param {{reports?: object[], banned?: object, onChange?: Function}} [opts] */
  constructor(opts = null) {
    this.data = { banned: opts?.banned || {}, reports: opts?.reports || [] };
    this.onChange = opts?.onChange || (() => {});
  }

  save(kind, item) { this.onChange(kind, item); }

  /** Denúncia de um cliente/vendedor. */
  report({ tenant, phone, reason, by, byName, groupId }) {
    const r = { id: this.data.reports.reduce((m, x) => Math.max(m, x.id), 0) + 1, tenant, phone, reason: reason || null, by, byName: byName || null, groupId: groupId || null, at: Date.now(), status: 'aberta' };
    this.data.reports.push(r);
    this.save('report', r);
    return r;
  }

  reportsAgainst(phone) { return this.data.reports.filter(r => r.phone === phone && r.status !== 'descartada'); }
  reportsOf(tenant) { return this.data.reports.filter(r => r.tenant === tenant); }

  resolveReport(id, status) {
    const r = this.data.reports.find(x => x.id === Number(id));
    if (r) { r.status = status; this.save('report', r); }
    return r;
  }

  ban(phone, { tenant, reason }) {
    this.data.banned[phone] = { tenant, reason: reason || null, at: Date.now() };
    this.save('ban', { phone, ...this.data.banned[phone] });
    for (const r of this.data.reports) if (r.phone === phone && r.status === 'aberta') { r.status = 'confirmada'; this.save('report', r); }
  }

  unban(phone) { delete this.data.banned[phone]; this.save('unban', { phone }); }
  isBanned(phone) { return phone ? this.data.banned[phone] || null : null; }

  /** Resumo de risco de um número. */
  check(phone) {
    const banned = this.isBanned(phone);
    const reports = this.reportsAgainst(phone);
    const sellers = new Set(reports.map(r => r.tenant)).size;
    let level = 'limpo';
    if (banned) level = 'banido';
    else if (reports.length >= 3 || sellers >= 2) level = 'alto';
    else if (reports.length) level = 'suspeito';
    return { phone, level, banned, reports: reports.length, sellers };
  }
}
