// js/stockRisk.js
// Nivel de riesgo de stock, compartido entre pages/inicio.html y
// js/inventarioDashboard.js (Rediseño v3) -- antes vivía duplicado como
// función local dentro del <script> inline de Inicio.

// Nivel de riesgo de un producto según su stock vs. stock mínimo. Devuelve
// null si no aplica (sin stock_minimo configurado) -- no se dibuja un
// badge sin una base real de comparación.
export function nivelRiesgoStock(stock, stockMinimo) {
  const s = Number(stock) || 0;
  const min = Number(stockMinimo) || 0;
  if (min <= 0) return null;
  if (s <= min * 0.5) return { nivel: 'critico', etiqueta: 'Crítico', icono: '🔴' };
  if (s <= min) return { nivel: 'bajo', etiqueta: 'Bajo', icono: '🟠' };
  return null;
}
