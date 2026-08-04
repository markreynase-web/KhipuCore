// src/routes/khipuAi.js
// Fase D: "Khipu AI" -- un solo endpoint que sirve tanto preguntas sueltas
// como reportes automáticos (son el mismo agente con tool use, solo cambia
// el mensaje de entrada). Cada llamada es una petición real y facturada a
// Claude ("generación en vivo", sin caché de respuestas -- decisión del
// usuario).
//
// Patrón: loop agentic manual (while stop_reason === 'tool_use') -- ver
// typescript/claude-api/tool-use.md de la skill claude-api. Se usa el loop
// manual (no el Tool Runner beta) porque es una sola llamada corta por
// request HTTP, sin necesidad de streaming ni de la dependencia beta.

import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { construirHerramientas } from '../khipuAiTools.js';

const router = Router();
router.use(auth, requireEmpresa);

// Si falta la API key, el cliente queda null a propósito -- así el resto del
// backend arranca normal y esta ruta sola responde 500 con un mensaje claro,
// en vez de tumbar el proceso entero al importar este archivo.
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// Techo barato de costo/abuso: es un endpoint nuevo que factura por uso real
// en vivo (sin caché) y se expone como widget en cada página. Contador en
// memoria del proceso (se resetea si el servidor reinicia -- aceptable para
// este tamaño de cliente; no hace falta una tabla nueva para esto).
const MAX_PREGUNTAS_DIA = 40;
const contadorDiario = new Map(); // usuario_id -> { fecha: 'YYYY-MM-DD', conteo }

function excedeLimiteDiario(usuarioId) {
  const hoy = new Date().toISOString().slice(0, 10);
  const actual = contadorDiario.get(usuarioId);
  if (!actual || actual.fecha !== hoy) {
    contadorDiario.set(usuarioId, { fecha: hoy, conteo: 1 });
    return false;
  }
  if (actual.conteo >= MAX_PREGUNTAS_DIA) return true;
  actual.conteo += 1;
  return false;
}

const MAX_ITERACIONES = 6;   // tope de vueltas del loop, por si Claude insiste en llamar herramientas
const MAX_TURNOS_HISTORIAL = 8; // el chat vive en el navegador (ver components/khipuAiWidget.js); solo se manda un recorte

router.post('/preguntar', verificarPermiso('khipu_ai.ver'), async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: 'Khipu AI no está configurado en este servidor (falta ANTHROPIC_API_KEY).' });
  }

  const pregunta = (req.body?.pregunta || '').trim();
  if (!pregunta) return res.status(400).json({ error: 'Escribe una pregunta.' });

  if (excedeLimiteDiario(req.usuario.id)) {
    return res.status(429).json({
      error: `Khipu AI llegó a su límite de ${MAX_PREGUNTAS_DIA} preguntas por día para tu usuario. Vuelve a intentar mañana.`
    });
  }

  try {
    const { rows } = await pool.query(
      'SELECT modulo_id FROM empresa_modulos WHERE empresa_id = $1',
      [req.usuario.empresa_id]
    );
    const modulosHabilitados = new Set(rows.map(r => r.modulo_id));

    const herramientas = construirHerramientas({ pool, empresaId: req.usuario.empresa_id, modulosHabilitados });
    const herramientasPorNombre = new Map(herramientas.map(h => [h.name, h]));
    const toolsParaClaude = herramientas.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

    const historial = Array.isArray(req.body?.historial) ? req.body.historial.slice(-MAX_TURNOS_HISTORIAL) : [];
    const messages = historial
      .filter(t => t && (t.rol === 'user' || t.rol === 'assistant') && typeof t.texto === 'string' && t.texto.trim())
      .map(t => ({ role: t.rol, content: t.texto }));
    messages.push({ role: 'user', content: pregunta });

    const systemPrompt = `Eres Khipu AI, el asistente de análisis de datos de KhipuCore para la empresa "${req.usuario.empresa_nombre}".
Hoy es ${new Date().toISOString().slice(0, 10)}.
Respondes siempre en español, de forma breve y concreta -- este chat es un widget flotante, no un reporte largo.
Usa las herramientas disponibles para obtener cifras reales antes de responder cualquier pregunta sobre ventas, inventario, finanzas, clientes u otros datos del negocio -- nunca inventes números.
Si una pregunta necesita datos que ninguna herramienta puede darte, dilo con claridad en vez de adivinar.
Si el usuario pide un resumen o reporte general sin especificar más, combina 2-3 herramientas relevantes (ventas, alertas de stock, finanzas) para dar una vista general útil.`;

    const herramientasUsadas = new Set();
    let respuestaFinal = '';

    for (let iteracion = 0; iteracion < MAX_ITERACIONES; iteracion++) {
      const respuesta = await client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolsParaClaude,
        messages
      });

      messages.push({ role: 'assistant', content: respuesta.content });

      if (respuesta.stop_reason !== 'tool_use') {
        respuestaFinal = respuesta.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        break;
      }

      const bloquesHerramienta = respuesta.content.filter(b => b.type === 'tool_use');
      const resultados = [];
      for (const bloque of bloquesHerramienta) {
        const tool = herramientasPorNombre.get(bloque.name);
        let contenido;
        try {
          const resultado = tool ? await tool.ejecutar(bloque.input || {}) : { error: 'Herramienta no disponible.' };
          herramientasUsadas.add(bloque.name);
          contenido = JSON.stringify(resultado);
        } catch (err) {
          console.error(`Khipu AI: error ejecutando ${bloque.name}`, err);
          contenido = JSON.stringify({ error: 'No se pudo obtener este dato.' });
        }
        resultados.push({ type: 'tool_result', tool_use_id: bloque.id, content: contenido });
      }
      messages.push({ role: 'user', content: resultados });
    }

    if (!respuestaFinal) {
      respuestaFinal = 'No pude terminar de armar una respuesta. Intenta preguntar algo más específico.';
    }

    res.json({ respuesta: respuestaFinal, herramientas_usadas: [...herramientasUsadas] });
  } catch (err) {
    console.error('Khipu AI error:', err);
    res.status(500).json({ error: 'Khipu AI no pudo responder en este momento. Intenta de nuevo en un momento.' });
  }
});

export default router;
