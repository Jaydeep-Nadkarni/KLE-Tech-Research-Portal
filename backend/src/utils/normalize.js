export const normDoi = (d) => {
  if (!d) return null;
  const s = String(d).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
  return /^10\.\d{4,9}\//.test(s) ? s : null;
};
export const normTitle = (t) =>
  t ? String(t).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim() : '';
export const normIssn = (i) => {
  if (!i) return null;
  const s = String(i).replace(/[^0-9xX]/g, '').toUpperCase();
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
};
export const normOrcid = (o) => {
  if (!o) return null;
  const m = String(o).match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i);
  return m ? m[1].toUpperCase() : null;
};
export const normEid = (e) => (e && /^2-s2\.0-\d+$/.test(String(e).trim()) ? String(e).trim() : null);
export const yearOf = (d) => { const m = String(d || '').match(/^(\d{4})/); return m ? Number(m[1]) : null; };
export const uniq = (a) => [...new Set(a.filter(Boolean))];
