// js/filters.js
// Todo lo relacionado a filtrar el dataset por rango de fechas.
// Aquí es donde en la Fase de "Filtros adicionales" agregaríamos
// filtro por categoría y búsqueda de texto libre.

export function rangoFechasDisponible(filas) {
  const fechas = filas.map(r => r._fecha).filter(Boolean).sort();
  if (!fechas.length) return null;
  return { min: fechas[0], max: fechas[fechas.length - 1] };
}

// desdeStr / hastaStr en formato 'AAAA-MM-DD'. Si vienen vacíos, se usa todo el rango disponible.
export function filtrarPeriodo(filas, desdeStr, hastaStr) {
  const conFecha = filas.filter(r => r._fecha);
  if (!conFecha.length) return { actual: filas, anterior: [], desde: null, hasta: null };

  const rango = rangoFechasDisponible(conFecha);
  const desde = desdeStr || rango.min;
  const hasta = hastaStr || rango.max;

  const actual = conFecha.filter(r => r._fecha >= desde && r._fecha <= hasta);

  // Periodo anterior: misma duración exacta, terminando justo antes de "desde".
  const msPorDia = 86400000;
  const dDesde = new Date(desde + 'T00:00:00');
  const dHasta = new Date(hasta + 'T00:00:00');
  const duracionDias = Math.max(1, Math.round((dHasta - dDesde) / msPorDia) + 1);
  const antHasta = new Date(dDesde.getTime() - msPorDia).toISOString().slice(0, 10);
  const antDesde = new Date(dDesde.getTime() - msPorDia * duracionDias).toISOString().slice(0, 10);
  const anterior = conFecha.filter(r => r._fecha >= antDesde && r._fecha <= antHasta);

  const esTodoElRango = desde === rango.min && hasta === rango.max;
  return { actual, anterior: esTodoElRango ? [] : anterior, desde, hasta, rango };
}

export function sincronizarSelectorDeRango(mapa, filas, dom) {
  if (!mapa.colFecha) { dom.dateRangeWrap.style.display = 'none'; return; }
  dom.dateRangeWrap.style.display = 'flex';
  const rango = rangoFechasDisponible(filas);
  if (rango) {
    dom.fechaDesde.min = rango.min; dom.fechaDesde.max = rango.max;
    dom.fechaHasta.min = rango.min; dom.fechaHasta.max = rango.max;
    // Solo pre-cargamos valores si están vacíos (evita pisar una selección del usuario al re-renderizar)
    if (!dom.fechaDesde.value) dom.fechaDesde.value = rango.min;
    if (!dom.fechaHasta.value) dom.fechaHasta.value = rango.max;
  }
}
