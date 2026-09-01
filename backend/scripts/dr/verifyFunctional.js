// scripts/dr/verifyFunctional.js
// Verificación funcional post-restore: levanta el servidor de test real
// (contra TEST_DATABASE_URL) y hace, por HTTP real, exactamente lo que
// pide C3.10 -- login de Empresa A, cliente A visible, cliente B NO
// visible, venta A visible con datos económicos correctos.
//
// No corre la suite de 36 tests -- es una verificación puntual, acotada al
// dataset QA-DR, para no alterar más evidencia antes de guardarla.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { poolTest as pool } from './precheck.js';
import { iniciarServidorTest } from '../../tests/helpers/servidorTest.js';
import { DIR_SALIDA_DR, DR_PASSWORD } from './dataset.js';

const rutaManifiesto = path.join(DIR_SALIDA_DR, 'dr_manifest.json');
if (!existsSync(rutaManifiesto)) {
  console.error(`[dr:functional] No existe ${rutaManifiesto}.`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(rutaManifiesto, 'utf8'));

function assert(cond, mensaje) {
  if (!cond) throw new Error(`ASERCIÓN FALLIDA: ${mensaje}`);
  console.log(`[dr:functional] OK -- ${mensaje}`);
}

async function principal() {
  // El email del usuario A no está en el manifiesto (solo su ID) -- se
  // reconstruye con el mismo patrón determinista que usa seed.js.
  const { rows } = await pool.query('SELECT email FROM usuarios WHERE id = $1', [m.empresaA.usuarioId]);
  if (!rows.length) throw new Error(`Usuario A (id=${m.empresaA.usuarioId}) no existe -- ¿restore incompleto?`);
  const emailA = rows[0].email;

  const servidor = await iniciarServidorTest();
  try {
    const rLogin = await fetch(`${servidor.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailA, password: DR_PASSWORD })
    });
    const loginBody = await rLogin.json();
    assert(rLogin.status === 200, `login de Empresa A responde 200 (fue ${rLogin.status})`);
    const token = loginBody.token;
    const headers = { Authorization: `Bearer ${token}` };

    const rClientes = await fetch(`${servidor.baseUrl}/api/clientes`, { headers });
    const clientes = await rClientes.json();
    assert(clientes.some(c => c.id === m.empresaA.clienteId), 'cliente de Empresa A aparece en su propia lista');
    assert(!clientes.some(c => c.id === m.empresaB.clienteId), 'cliente de Empresa B NO aparece en la lista de A');

    const rVentas = await fetch(`${servidor.baseUrl}/api/ventas`, { headers });
    const ventas = await rVentas.json();
    const ventaA = ventas.find(v => v.id === m.empresaA.ventaId);
    assert(Boolean(ventaA), 'venta de Empresa A aparece restaurada en su lista');
    assert(Number(ventaA.cantidad) === 3 && Number(ventaA.precio_unitario) === 100 && Number(ventaA.monto) === 300,
      `datos económicos de la venta A son correctos (cantidad=3, precio=100, monto=300 -- fueron cantidad=${ventaA.cantidad}, precio=${ventaA.precio_unitario}, monto=${ventaA.monto})`);

    console.log('[dr:functional] Verificación funcional post-restore: TODO OK.');
  } finally {
    await servidor.detener();
  }
  await pool.end();
}

principal().catch(err => { console.error('[dr:functional] ERROR:', err.message); process.exit(1); });
