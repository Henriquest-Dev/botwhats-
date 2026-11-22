// Leitura de comprovativos de pagamento (M-Pesa, e-Mola, mKesh) e números de telefone.

// Números moçambicanos de telemóvel: 82/83/84/85/86/87 + 7 dígitos, com ou sem +258.
const PHONE_RE = /(?:\+?258[\s-]?)?(8[2-7])[\s-]?(\d{3})[\s-]?(\d{4})(?!\d)/g;

export function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const m = digits.match(/^(?:258)?(8[2-7]\d{7})$/);
  return m ? m[1] : null;
}

export function findPhones(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PHONE_RE)) {
    const n = m[1] + m[2] + m[3];
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function toAmount(s) {
  // "1.000,00" -> 1000 ; "100.00" -> 100 ; "100,00" -> 100 ; "1,000.00" -> 1000
  let v = s.trim();
  if (/,\d{2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(/,/g, '');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const PROOF_HINT = /(confirmado|id da transac|transferiste|transfer[eê]ncia|pagaste|enviaste|recebeste|transac[çc][aã]o)/i;
const AMOUNT_RE = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(?:MT|MZN|Mt)\b/;

/**
 * Tenta ler um comprovativo. Devolve null se o texto não parecer um comprovativo.
 * { provider, txId, amount, recipient }
 */
export function parseProof(text) {
  const t = String(text || '');
  if (!PROOF_HINT.test(t)) return null;

  // Valor: de preferência o que vem depois de "Transferiste/Pagaste/Enviaste".
  let amount = null;
  const verb = t.match(/(?:transferiste|pagaste|enviaste|transferido|valor(?: de)?:?)\s*(\d[\d.,]*)\s?(?:MT|MZN)/i);
  if (verb) amount = toAmount(verb[1]);
  if (amount == null) {
    const a = t.match(AMOUNT_RE);
    if (a) amount = toAmount(a[1]);
  }
  if (amount == null) return null; // sem valor não tratamos como comprovativo

  // ID da transacção
  let txId = null;
  const idPatterns = [
    /id\s*da\s*transac[çc]?[aã]o\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-]{4,})/i,
    /confirmado\s*[:\-]?\s*([A-Z0-9]{6,})/i,
    /(?:refer[eê]ncia|ref\.?|transac[çc][aã]o\s*n[ºo°]?\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-]{4,})/i,
  ];
  for (const re of idPatterns) {
    const m = t.match(re);
    if (m) { txId = m[1].replace(/[.\-]+$/, '').toUpperCase(); break; }
  }

  // Destinatário do pagamento (o vendedor)
  let recipient = null;
  const r = t.match(/para\s*(?:a\s*)?(?:conta\s*|o\s*n[uú]mero\s*)?[:\-]?\s*(\+?258)?\s*(8[2-7]\d{7})/i);
  if (r) recipient = r[2];

  let provider = 'desconhecido';
  if (/e-?mola/i.test(t) || /^PP\d/i.test(txId || '')) provider = 'e-Mola';
  else if (/m-?kesh/i.test(t)) provider = 'mKesh';
  else if (/m-?pesa|confirmado/i.test(t)) provider = 'M-Pesa';
  else if (recipient && /^8[67]/.test(recipient)) provider = 'e-Mola';
  else if (recipient && /^8[45]/.test(recipient)) provider = 'M-Pesa';
  else if (recipient && /^8[23]/.test(recipient)) provider = 'mKesh';

  return { provider, txId, amount, recipient };
}
