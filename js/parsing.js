// js/parsing.js
// Lectura de CSV/ZIP, detección automática de columnas y transformación de filas.
// Depende de Papa (papaparse) y JSZip, cargados como <script> globales en index.html.

import { normalizarTexto, parseFechaFlexible, parseNumeroFlexible, conTimeout } from './utils.js';

export const NOMBRES_FECHA = ['fecha', 'date', 'dia', 'día', 'mes', 'periodo', 'período', 'year', 'ano', 'año'];
export const NOMBRES_NUMERICO = ['monto', 'total', 'importe', 'venta', 'ventas', 'precio', 'valor', 'amount', 'sales', 'revenue', 'cantidad', 'qty', 'quantity', 'ingreso', 'ingresos', 'score', 'rating', 'count', 'numero', 'número'];
export const NOMBRES_CATEGORIA = ['categoria', 'categoría', 'producto', 'cliente', 'tipo', 'rubro', 'pais', 'país', 'region', 'región', 'nombre', 'name', 'estado', 'status', 'marca', 'canal'];

export async function leerTextoArchivo(file) {
  let texto = await conTimeout(file.text(), 15000, file.name);
  if (/\uFFFD/.test(texto)) {
    const buffer = await file.arrayBuffer();
    texto = new TextDecoder('iso-8859-1').decode(buffer);
  }
  return texto;
}

export async function leerTextoEntradaZip(entry) {
  let texto = await conTimeout(entry.async('string'), 15000, entry.name);
  if (/\uFFFD/.test(texto)) {
    const bytes = await entry.async('uint8array');
    texto = new TextDecoder('iso-8859-1').decode(bytes);
  }
  return texto;
}

export function analizarColumnas(filas, cols) {
  const muestra = filas.length > 800 ? filas.filter((_, i) => i % Math.ceil(filas.length / 800) === 0) : filas;
  const stats = {};
  cols.forEach(c => {
    let dateHits = 0, numHits = 0, nonEmpty = 0, valores = new Set();
    muestra.forEach(r => {
      const v = r[c];
      if (v === undefined || v === null || String(v).trim() === '') return;
      nonEmpty++;
      valores.add(String(v).trim());
      if (parseFechaFlexible(v)) dateHits++;
      if (!isNaN(parseNumeroFlexible(v))) numHits++;
    });
    stats[c] = { dateRatio: nonEmpty ? dateHits / nonEmpty : 0, numRatio: nonEmpty ? numHits / nonEmpty : 0, nonEmpty, unicos: valores.size, cardinalidad: nonEmpty ? valores.size / nonEmpty : 0 };
  });
  return stats;
}

export function elegirColumnas(cols, stats) {
  let colFecha = cols.find(c => NOMBRES_FECHA.includes(c) && stats[c].dateRatio > 0.3);
  if (!colFecha) {
    colFecha = cols.filter(c => stats[c].dateRatio > 0.6).sort((a, b) => stats[b].dateRatio - stats[a].dateRatio)[0];
  }
  let candidatosNum = cols.filter(c => c !== colFecha && stats[c].numRatio > 0.6);
  let colNum = candidatosNum.find(c => NOMBRES_NUMERICO.includes(c));
  if (!colNum) colNum = candidatosNum.sort((a, b) => stats[b].numRatio - stats[a].numRatio)[0];
  const otrosNum = candidatosNum.filter(c => c !== colNum);
  const restantes = cols.filter(c => c !== colFecha && c !== colNum && !otrosNum.includes(c));
  const candidatosCat = restantes.filter(c => stats[c].unicos > 1 && stats[c].cardinalidad < 0.9);
  let colCat1 = candidatosCat.find(c => NOMBRES_CATEGORIA.includes(c));
  const restoCat = candidatosCat.filter(c => c !== colCat1).sort((a, b) => stats[a].cardinalidad - stats[b].cardinalidad);
  if (!colCat1) colCat1 = restoCat.shift(); else { const idx = restoCat.indexOf(colCat1); if (idx > -1) restoCat.splice(idx, 1); }
  const colCat2 = restoCat[0];
  const otrasCat = restoCat.slice(1);
  return { colFecha, colNum, otrosNum, colCat1, colCat2, otrasCat };
}

export function procesarFilasEnBloques(filasCrudas, mapa, onProgreso) {
  return new Promise(resolve => {
    const TAM_BLOQUE = 5000;
    const resultado = [];
    let i = 0;
    function bloque() {
      const fin = Math.min(i + TAM_BLOQUE, filasCrudas.length);
      for (; i < fin; i++) {
        const r = filasCrudas[i];
        const extra = {};
        (mapa.otrosNum || []).forEach(col => { extra[col] = parseNumeroFlexible(r[col]); });
        const extraCat = {};
        (mapa.otrasCat || []).forEach(col => { extraCat[col] = String(r[col] || '').trim() || 'Sin dato'; });
        resultado.push({
          _fecha: mapa.colFecha ? parseFechaFlexible(r[mapa.colFecha]) : null,
          _numero: mapa.colNum ? parseNumeroFlexible(r[mapa.colNum]) : NaN,
          _cat1: mapa.colCat1 ? (String(r[mapa.colCat1] || '').trim() || 'Sin dato') : null,
          _cat2: mapa.colCat2 ? (String(r[mapa.colCat2] || '').trim() || 'Sin dato') : null,
          _extra: extra,
          _extraCat: extraCat
        });
      }
      if (onProgreso) onProgreso(i, filasCrudas.length);
      if (i < filasCrudas.length) {
        setTimeout(bloque, 0);
      } else {
        resolve(resultado);
      }
    }
    bloque();
  });
}

export async function procesarTextoCSV(texto, nombreArchivo, onProgreso) {
  const res = Papa.parse(texto, { header: true, skipEmptyLines: 'greedy', transformHeader: h => normalizarTexto(h) });
  const filasCrudas = res.data;
  const cols = res.meta.fields || [];
  if (filasCrudas.length === 0 || cols.length === 0) return { archivo: nombreArchivo, filas: [], cols: [], mapa: {}, totalFilas: 0 };
  const stats = analizarColumnas(filasCrudas, cols);
  const mapa = elegirColumnas(cols, stats);
  const filas = await procesarFilasEnBloques(filasCrudas, mapa, onProgreso);
  return { archivo: nombreArchivo, filas, cols, mapa, stats, totalFilas: filasCrudas.length };
}
