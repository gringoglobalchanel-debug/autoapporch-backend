/**
 * Rutas de mejoras de apps
 * Maneja el chat de mejoras y descuento de tokens
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { query, transaction } from '../config/database.js';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Costo en tokens por tipo de mejora
const IMPROVEMENT_COSTS = {
  simple: 2000,   // Cambios visuales, textos, colores
  medium: 8000,   // Agregar sección, cambiar layout
  complex: 20000  // Nuevo módulo, nueva funcionalidad, nueva integración
};

/**
 * GET /api/apps/:id/improvements
 * Obtener historial de mejoras de una app
 */
router.get('/:id/improvements', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const appResult = await query(
    'SELECT id, name FROM apps WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (appResult.rows.length === 0) throw new AppError('App no encontrada', 404);

  const improvements = await query(
    `SELECT * FROM app_improvements 
     WHERE app_id = $1 
     ORDER BY created_at DESC 
     LIMIT 20`,
    [id]
  );

  // Tokens disponibles del usuario
  const subResult = await query(
    `SELECT plan, token_limit, tokens_used 
     FROM subscriptions 
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );

  const sub = subResult.rows[0];
  const tokensAvailable = sub ? (sub.token_limit - sub.tokens_used) : 0;

  res.json({
    success: true,
    app: appResult.rows[0],
    improvements: improvements.rows,
    tokens: {
      available: tokensAvailable,
      costs: IMPROVEMENT_COSTS
    }
  });
}));

/**
 * POST /api/apps/:id/improvements/chat
 * Enviar mensaje al chat de mejoras
 */
router.post('/:id/improvements/chat', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message, history = [] } = req.body;

  if (!message) throw new AppError('Mensaje requerido', 400);

  // Verificar que la app pertenece al usuario
  const appResult = await query(
    'SELECT id, name, description FROM apps WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (appResult.rows.length === 0) throw new AppError('App no encontrada', 404);

  const app = appResult.rows[0];

  // Verificar tokens disponibles
  const subResult = await query(
    `SELECT plan, token_limit, tokens_used 
     FROM subscriptions 
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );

  const sub = subResult.rows[0];
  if (!sub) throw new AppError('No tienes una suscripción activa', 403);

  const tokensAvailable = sub.token_limit - sub.tokens_used;
  if (tokensAvailable < IMPROVEMENT_COSTS.simple) {
    throw new AppError(
      `No tienes suficientes tokens. Disponibles: ${tokensAvailable}. Mínimo requerido: ${IMPROVEMENT_COSTS.simple}`,
      403
    );
  }

  // Construir historial para Claude
  const messages = history.map(m => ({ role: m.role, content: m.content }));
  messages.push({ role: 'user', content: message });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `Eres un asistente experto en mejoras de aplicaciones web para la plataforma AutoAppOrchestrator.

El usuario quiere mejorar su app llamada "${app.name}": ${app.description}

Tu trabajo es:
1. Entender qué mejora quiere el usuario
2. Clasificar la complejidad y mostrar el costo en tokens
3. Cuando el usuario confirme, responder con [MEJORA_CONFIRMADA] seguido de un JSON

COSTOS DE TOKENS:
- Mejora simple (colores, textos, estilos): ${IMPROVEMENT_COSTS.simple} tokens
- Mejora media (nueva sección, cambio de layout): ${IMPROVEMENT_COSTS.medium} tokens  
- Mejora compleja (nuevo módulo, nueva funcionalidad): ${IMPROVEMENT_COSTS.complex} tokens

Tokens disponibles del usuario: ${tokensAvailable}

Cuando el usuario confirme una mejora, responde EXACTAMENTE así:
[MEJORA_CONFIRMADA]
{"type":"simple|medium|complex","description":"descripcion detallada de la mejora","tokensRequired":2000}

REGLAS:
- Sé conciso y amigable
- Explica el costo antes de confirmar
- Si no tiene tokens suficientes, díselo claramente
- Solo una mejora a la vez`,
    messages
  });

  const content = response.content[0].text;
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;

  // Verificar si confirmó una mejora
  const isConfirmed = content.includes('[MEJORA_CONFIRMADA]');
  let improvement = null;

  if (isConfirmed) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        improvement = JSON.parse(jsonMatch[0]);

        // Descontar tokens del plan
        await query(
          `UPDATE subscriptions 
           SET tokens_used = tokens_used + $1, updated_at = NOW()
           WHERE user_id = $2`,
          [improvement.tokensRequired, req.user.id]
        );

        // Guardar mejora en DB
        await query(
          `INSERT INTO app_improvements 
           (app_id, user_id, description, type, tokens_cost, status)
           VALUES ($1, $2, $3, $4, $5, 'pending')`,
          [id, req.user.id, improvement.description, improvement.type, improvement.tokensRequired]
        );

        console.log(`✅ Mejora confirmada para app ${id}: ${improvement.type} - ${improvement.tokensRequired} tokens`);
      } catch (e) {
        console.error('Error parsing improvement JSON:', e);
      }
    }
  }

  // Descontar tokens de la conversación (costo de Claude)
  await query(
    `UPDATE subscriptions 
     SET tokens_used = tokens_used + $1, updated_at = NOW()
     WHERE user_id = $2`,
    [tokensUsed, req.user.id]
  );

  res.json({
    success: true,
    message: content.replace('[MEJORA_CONFIRMADA]', '').replace(/\{[\s\S]*\}/, '').trim(),
    confirmed: isConfirmed,
    improvement,
    tokensUsed,
    tokensRemaining: tokensAvailable - tokensUsed - (improvement?.tokensRequired || 0)
  });
}));

export default router;