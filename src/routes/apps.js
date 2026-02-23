/**
 * Rutas de gestión de aplicaciones
 * CRUD de apps y generación con Claude API
 * ✅ CON VALIDACIÓN Y REINTENTOS AUTOMÁTICOS
 */

import express from 'express';
import { query, transaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { generationRateLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { getUserSubscription, canCreateApp, incrementAppCount } from '../services/planService.js';
import { appGenerator } from '../services/appGenerator.js';

const router = express.Router();

/**
 * GET /api/apps
 * Listar apps del usuario autenticado
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const offset = (page - 1) * limit;

  let queryText = `
    SELECT a.*, 
           COUNT(*) OVER() as total_count,
           (SELECT COUNT(*) FROM app_versions av WHERE av.app_id = a.id) as version_count
    FROM apps a
    WHERE a.user_id = $1
  `;
  
  const params = [req.user.id];

  if (status) {
    queryText += ` AND a.status = $${params.length + 1}`;
    params.push(status);
  }

  queryText += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(queryText, params);

  res.json({
    success: true,
    apps: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: result.rows[0]?.total_count || 0,
      totalPages: Math.ceil((result.rows[0]?.total_count || 0) / limit)
    }
  });
}));

/**
 * GET /api/apps/:id
 * Obtener una app específica con todas sus versiones
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const appResult = await query(
    'SELECT * FROM apps WHERE id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (appResult.rows.length === 0) {
    throw new AppError('App not found', 404);
  }

  const versionsResult = await query(
    'SELECT * FROM app_versions WHERE app_id = $1 ORDER BY version DESC',
    [id]
  );

  res.json({
    success: true,
    app: appResult.rows[0],
    versions: versionsResult.rows
  });
}));

/**
 * POST /api/apps/create
 * Generar nueva app con Claude (VERSIÓN MEJORADA CON VALIDACIÓN)
 */
router.post('/create', 
  authenticate, 
  generationRateLimiter,
  asyncHandler(async (req, res) => {
    const { name, description, style = 'modern', colors, googleApis = [], requiresPayments = false, stripePriceIds = null } = req.body;

    // Validación básica
    if (!name || !description) {
      throw new AppError('Name and description are required', 400);
    }

    // Verificar límite del plan
    const canCreate = await canCreateApp(req.user.id);
    if (!canCreate) {
      const sub = await getUserSubscription(req.user.id);
      throw new AppError(
        `Has alcanzado el límite de ${sub.apps_allowed} apps. Actualiza tu plan para seguir creando.`,
        403
      );
    }

    console.log(`🚀 Iniciando generación de app para usuario ${req.user.id}: "${name}"`);
    console.log(`📋 Requiere pagos: ${requiresPayments ? 'SÍ' : 'NO'}`);

    try {
      // Usar el nuevo generador con validaciones
      const result = await appGenerator.generateApp(req.user.id, {
        name,
        description,
        style,
        colors: colors || getDefaultColors(style),
        googleApis,
        requiresPayments,
        stripePriceIds
      });

      // Incrementar contador de apps creadas
      await incrementAppCount(req.user.id);

      // Si la generación fue exitosa pero con fallback
      if (result.fallbackUsed) {
        console.log(`⚠️ App ${result.app.id} generada con template de fallback`);
        
        return res.status(202).json({
          success: true,
          message: 'Tu app está siendo preparada. Recibirás una notificación cuando esté lista.',
          app: {
            id: result.app.id,
            name: result.app.name,
            status: 'generating'
          }
        });
      }

      // Si hubo error completo
      if (!result.success) {
        console.error(`❌ Error en generación para usuario ${req.user.id}:`, result.error);
        
        return res.status(202).json({
          success: true,
          message: 'Tu app está siendo preparada. Nuestro equipo la revisará y estará lista pronto.',
          app: {
            id: result.app.id,
            name: result.app.name,
            status: 'review_needed'
          }
        });
      }

      // Éxito total
      console.log(`✅ App ${result.app.id} generada exitosamente en ${result.quality?.attempts || 1} intentos`);
      
      res.status(202).json({
        success: true,
        message: 'App generation started',
        app: {
          id: result.app.id,
          name: result.app.name,
          status: result.app.status
        },
        quality: result.quality
      });

    } catch (error) {
      console.error('❌ Error crítico en generación:', error);
      
      // Crear app en estado de error para no perder el registro
      const appResult = await query(
        `INSERT INTO apps (user_id, name, description, prompt, tech_stack, status, error_details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, status`,
        [
          req.user.id,
          name,
          description,
          description,
          JSON.stringify({ style, colors: colors || getDefaultColors(style) }),
          'error',
          JSON.stringify({ message: error.message })
        ]
      );

      const app = appResult.rows[0];

      res.status(202).json({
        success: true,
        message: 'Tu app está siendo procesada. Te notificaremos cuando esté lista.',
        app: {
          id: app.id,
          name: app.name,
          status: 'processing'
        }
      });
    }
  })
);

/**
 * Función auxiliar para obtener colores por defecto según estilo
 */
function getDefaultColors(style) {
  const colors = {
    modern: {
      primary: '#3B82F6',
      secondary: '#1E40AF',
      accent: '#F59E0B',
      background: '#FFFFFF',
      surface: '#F9FAFB',
      text: '#111827'
    },
    elegant: {
      primary: '#000000',
      secondary: '#1F2937',
      accent: '#FFD700',
      background: '#FFFFFF',
      surface: '#F3F4F6',
      text: '#111827'
    },
    minimal: {
      primary: '#4B5563',
      secondary: '#1F2937',
      accent: '#10B981',
      background: '#F9FAFB',
      surface: '#FFFFFF',
      text: '#1F2937'
    },
    ocean: {
      primary: '#0EA5E9',
      secondary: '#0284C7',
      accent: '#F59E0B',
      background: '#FFFFFF',
      surface: '#F0F9FF',
      text: '#0C4A6E'
    },
    emerald: {
      primary: '#10B981',
      secondary: '#059669',
      accent: '#F59E0B',
      background: '#FFFFFF',
      surface: '#ECFDF5',
      text: '#064E3B'
    },
    radiant: {
      primary: '#EF4444',
      secondary: '#DC2626',
      accent: '#F59E0B',
      background: '#FFFFFF',
      surface: '#FEF2F2',
      text: '#991B1B'
    },
    royal: {
      primary: '#8B5CF6',
      secondary: '#7C3AED',
      accent: '#FCD34D',
      background: '#FFFFFF',
      surface: '#F5F3FF',
      text: '#5B21B6'
    },
    midnight: {
      primary: '#1E293B',
      secondary: '#0F172A',
      accent: '#F59E0B',
      background: '#F8FAFC',
      surface: '#F1F5F9',
      text: '#0F172A'
    },
    sunset: {
      primary: '#F97316',
      secondary: '#EA580C',
      accent: '#3B82F6',
      background: '#FFFFFF',
      surface: '#FFF7ED',
      text: '#9A3412'
    }
  };
  return colors[style] || colors.modern;
}

export default router;