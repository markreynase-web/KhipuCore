// js/utils.js
// Funciones puras de formateo y parsing. Sin estado, sin DOM.

export const fmtNum = n => Number.isFinite(n)
  ? n.toLocaleString('es-PE', { maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })
  : "—";

export const fmtCorto = n => {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + "K";
  return fmtNum(n);
};

export function normalizarTexto(s) {
  return String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Escapa cualquier texto que venga del archivo del usuario (nombres de columna,
// valores de celdas) antes de insertarlo con innerHTML/insertAdjacentHTML.
// Nunca insertes datos del CSV sin pasar por aquí si usas innerHTML.
export function escapeHtml(valor) {
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseFechaFlexible(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  let s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    const mes = a > 12 ? b : a;
    const dia = a > 12 ? a : b;
    return `${m[3]}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/);
  if (m) {
    const yy = parseInt(m[3], 10);
    const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    const mes = a > 12 ? b : a;
    const dia = a > 12 ? a : b;
    return `${yyyy}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  const soloFecha = s.split(/[T\s]/)[0];
  const d = new Date(soloFecha.includes('-') || soloFecha.includes('/') ? soloFecha : s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function parseNumeroFlexible(v) {
  if (v === undefined || v === null || String(v).trim() === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[^0-9.,-]/g, '');
  if (s === '' || s === '-') return NaN;
  if (s.includes('.') && s.includes(',')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const partes = s.split(',');
    s = partes[partes.length - 1].length === 2 ? partes.slice(0, -1).join('') + '.' + partes[partes.length - 1] : s.replace(/,/g, '');
  }
  return parseFloat(s);
}

export function conTimeout(promesa, ms, etiqueta) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Tiempo agotado leyendo ${etiqueta}`)), ms))
  ]);
}
