// scripts/dr/compareSnapshots.js
// Compara pre_restore_snapshot.* contra post_restore_snapshot.*. NO se
// conecta a ninguna base -- es comparación pura de los archivos JSON ya
// generados por snapshot.js. Por eso no importa precheck.js/poolTest: no
// hay ningún destino de base que confirmar acá.
//
// No "normaliza" nada para forzar una coincidencia -- si un valor difiere,
// se reporta tal cual.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ORDEN_TABLAS, DIR_SALIDA_DR } from './dataset.js';

const rutaPreJson = path.join(DIR_SALIDA_DR, 'pre_restore_snapshot.json');
const rutaPreHash = path.join(DIR_SALIDA_DR, 'pre_restore_snapshot.sha256');
const rutaPostJson = path.join(DIR_SALIDA_DR, 'post_restore_snapshot.json');
const rutaPostHash = path.join(DIR_SALIDA_DR, 'post_restore_snapshot.sha256');

for (const ruta of [rutaPreJson, rutaPreHash, rutaPostJson, rutaPostHash]) {
  if (!existsSync(ruta)) {
    console.error(`[dr:compare] Falta ${ruta} -- corré snapshot.js pre y post antes de comparar.`);
    process.exit(1);
  }
}

const pre = JSON.parse(readFileSync(rutaPreJson, 'utf8'));
const preHash = JSON.parse(readFileSync(rutaPreHash, 'utf8'));
const post = JSON.parse(readFileSync(rutaPostJson, 'utf8'));
const postHash = JSON.parse(readFileSync(rutaPostHash, 'utf8'));

console.log(`[dr:compare] hash global pre:  ${preHash.global}`);
console.log(`[dr:compare] hash global post: ${postHash.global}`);

if (preHash.global === postHash.global) {
  console.log('[dr:compare] COINCIDENCIA EXACTA -- los datos post-restore son idénticos al snapshot pre-backup.');
  process.exit(0);
}

console.log('[dr:compare] NO COINCIDEN -- localizando diferencias antes de declarar nada...');

const tablasDivergentes = ORDEN_TABLAS.filter(t => preHash.porTabla[t] !== postHash.porTabla[t]);
console.log(`[dr:compare] Tabla(s) con hash distinto: ${tablasDivergentes.join(', ') || '(ninguna -- inconsistencia rara, revisar hash global a mano)'}`);

for (const tabla of tablasDivergentes) {
  console.log(`\n[dr:compare] --- Diferencias en "${tabla}" ---`);
  const filasPre = pre.tablas[tabla];
  const filasPost = post.tablas[tabla];

  if (filasPre.length !== filasPost.length) {
    console.log(`[dr:compare] Cantidad de filas distinta: pre=${filasPre.length} post=${filasPost.length}`);
  }

  const max = Math.max(filasPre.length, filasPost.length);
  for (let i = 0; i < max; i++) {
    const filaPre = filasPre[i];
    const filaPost = filasPost[i];
    if (!filaPre) { console.log(`[dr:compare]   Fila #${i}: existe en POST pero no en PRE -> ${JSON.stringify(filaPost)}`); continue; }
    if (!filaPost) { console.log(`[dr:compare]   Fila #${i}: existe en PRE pero no en POST -> ${JSON.stringify(filaPre)}`); continue; }

    for (let c = 0; c < filaPre.length; c++) {
      const [colPre, valPre] = filaPre[c];
      const [colPost, valPost] = filaPost[c] || [];
      if (colPre !== colPost || valPre !== valPost) {
        console.log(`[dr:compare]   Fila #${i}, campo "${colPre}": pre=${JSON.stringify(valPre)} post=${JSON.stringify(valPost)}`);
      }
    }
  }
}

process.exit(1);
