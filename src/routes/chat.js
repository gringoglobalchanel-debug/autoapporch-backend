/**
 * Rutas de Chat Pre-Generación - CON LOGS DE DIAGNÓSTICO
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as analysisService from '../services/analysisService.js';

const router = express.Router();

/**
 * POST /api/chat/refine
 */
router.post('/refine', authenticate, asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;

  if (!message) {
    throw new AppError('Message is required', 400);
  }

  console.log(`💬 [REFINE] Usuario: "${message}"`);

  let history = [];
  if (conversationId) {
    const historyResult = await query(
      `SELECT messages FROM chat_sessions WHERE id = $1 AND user_id = $2`,
      [conversationId, req.user.id]
    );
    
    if (historyResult.rows.length > 0) {
      history = historyResult.rows[0].messages || [];
    }
  }

  const result = await analysisService.conversationRefinement(message, history);

  if (!result.success) {
    throw new AppError(result.error, 500);
  }

  const newConversationId = conversationId || generateId();
  const updatedHistory = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: result.message }
  ];

  await query(
    `INSERT INTO chat_sessions (id, user_id, messages, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE 
     SET messages = $3, updated_at = NOW()`,
    [newConversationId, req.user.id, JSON.stringify(updatedHistory)]
  );

  console.log(`✅ [REFINE] Claude: "${result.message?.substring(0, 100)}..."`);
  console.log(`📊 [REFINE] Confirmed: ${result.confirmed}`);

  if (result.confirmed) {
    return res.json({
      success: true,
      conversationId: newConversationId,
      confirmed: true,
      analysis: result.analysis,
      summary: result.summary,
      googleApis: result.googleApis || [],
      fileSpecs: result.fileSpecs || [],
      tokensUsed: result.tokensUsed
    });
  }

  res.json({
    success: true,
    conversationId: newConversationId,
    message: result.message,
    ready: result.ready,
    summary: result.summary,
    fileSpecs: result.fileSpecs,
    googleApis: result.googleApis,
    tokensUsed: result.tokensUsed
  });
}));

/**
 * POST /api/chat/confirm
 */
router.post('/confirm', authenticate, asyncHandler(async (req, res) => {
  const { conversationId, confirmed, fileSpecs } = req.body;

  if (!conversationId) {
    throw new AppError('conversationId is required', 400);
  }

  const sessionResult = await query(
    `SELECT messages FROM chat_sessions WHERE id = $1 AND user_id = $2`,
    [conversationId, req.user.id]
  );

  if (sessionResult.rows.length === 0) {
    throw new AppError('Chat session not found', 404);
  }

  const messages = sessionResult.rows[0].messages;
  console.log(`📝 [CONFIRM] Total mensajes: ${messages.length}`);
  
  let analysis = null;
  
  // Buscar JSON en mensajes del asistente (del más reciente al más antiguo)
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const content = messages[i].content;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
          console.log(`✅ JSON encontrado en mensaje ${i}:`, JSON.stringify(analysis).substring(0, 200));
          break;
        } catch (e) {
          console.log(`❌ Error parseando JSON en mensaje ${i}`);
        }
      }
    }
  }

  // Si no hay JSON, construir descripción desde toda la conversación
  if (!analysis) {
    console.log(`⚠️ No se encontró JSON estructurado, construyendo desde conversación`);

    // Recopilar toda la conversación del usuario para entender qué quiere
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' | ');

    const lastAssistantMessage = [...messages]
      .reverse()
      .find(m => m.role === 'assistant');

    analysis = {
      name: null, // se usará el nombre que el usuario puso en el formulario
      description: userMessages, // descripción real basada en lo que el usuario dijo
      fullConversation: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
      googleApis: [],
      fileSpecs: []
    };

    console.log(`✅ Análisis construido desde conversación: "${userMessages.substring(0, 150)}"`);
  }

  console.log(`✅ [CONFIRM] Confirmación exitosa`);

  res.json({
    success: true,
    confirmed: true,
    analysis: analysis,
    fileSpecs: fileSpecs || [],
    message: '✅ App lista para generar'
  });
}));

function generateId() {
  return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export default router;