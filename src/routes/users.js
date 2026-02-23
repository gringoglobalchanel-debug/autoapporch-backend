/**
 * Rutas de gestión de usuarios
 * Perfil, estadísticas y configuración
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * GET /api/users/me
 * Obtener perfil del usuario autenticado
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, email, full_name, avatar_url, role, plan, created_at FROM users WHERE id = $1',
    [req.user.id]
  );

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    user: result.rows[0]
  });
}));

/**
 * PUT /api/users/me
 * Actualizar perfil del usuario
 */
router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const { fullName, avatarUrl } = req.body;

  const result = await query(
    `UPDATE users 
     SET full_name = COALESCE($1, full_name),
         avatar_url = COALESCE($2, avatar_url),
         updated_at = NOW()
     WHERE id = $3
     RETURNING id, email, full_name, avatar_url, role, plan`,
    [fullName, avatarUrl, req.user.id]
  );

  res.json({
    success: true,
    message: 'Profile updated successfully',
    user: result.rows[0]
  });
}));

/**
 * GET /api/users/stats
 * Obtener estadísticas del usuario
 */
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  // Total de apps
  const appsCount = await query(
    'SELECT COUNT(*) as count FROM apps WHERE user_id = $1',
    [req.user.id]
  );

  // Apps por estado
  const appsByStatus = await query(
    `SELECT status, COUNT(*) as count 
     FROM apps 
     WHERE user_id = $1 
     GROUP BY status`,
    [req.user.id]
  );

  // Total de versiones generadas
  const versionsCount = await query(
    `SELECT COUNT(*) as count 
     FROM app_versions av
     JOIN apps a ON av.app_id = a.id
     WHERE a.user_id = $1`,
    [req.user.id]
  );

  // Uso de API este mes
  const apiUsage = await query(
    `SELECT 
       COUNT(*) as requests,
       COALESCE(SUM(tokens_used), 0) as total_tokens,
       COALESCE(SUM(cost_usd), 0) as total_cost
     FROM api_usage
     WHERE user_id = $1 
       AND created_at > DATE_TRUNC('month', CURRENT_DATE)`,
    [req.user.id]
  );

  // Apps creadas por mes (últimos 6 meses)
  const appsPerMonth = await query(
    `SELECT 
       TO_CHAR(created_at, 'YYYY-MM') as month,
       COUNT(*) as count
     FROM apps
     WHERE user_id = $1
       AND created_at > CURRENT_DATE - INTERVAL '6 months'
     GROUP BY TO_CHAR(created_at, 'YYYY-MM')
     ORDER BY month DESC`,
    [req.user.id]
  );

  res.json({
    success: true,
    stats: {
      totalApps: parseInt(appsCount.rows[0].count),
      appsByStatus: appsByStatus.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {}),
      totalVersions: parseInt(versionsCount.rows[0].count),
      apiUsage: {
        requestsThisMonth: parseInt(apiUsage.rows[0].requests),
        tokensThisMonth: parseInt(apiUsage.rows[0].total_tokens),
        costThisMonth: parseFloat(apiUsage.rows[0].total_cost)
      },
      appsPerMonth: appsPerMonth.rows
    }
  });
}));

/**
 * GET /api/users/activity
 * Obtener actividad reciente del usuario
 */
router.get('/activity', authenticate, asyncHandler(async (req, res) => {
  const { limit = 20 } = req.query;

  // Logs recientes
  const logs = await query(
    `SELECT l.*, a.name as app_name
     FROM logs l
     LEFT JOIN apps a ON l.app_id = a.id
     WHERE l.user_id = $1
     ORDER BY l.created_at DESC
     LIMIT $2`,
    [req.user.id, limit]
  );

  // Solicitudes de mejora recientes
  const improvements = await query(
    `SELECT ir.*, a.name as app_name
     FROM improvement_requests ir
     JOIN apps a ON ir.app_id = a.id
     WHERE ir.user_id = $1
     ORDER BY ir.created_at DESC
     LIMIT $2`,
    [req.user.id, limit]
  );

  res.json({
    success: true,
    activity: {
      logs: logs.rows,
      improvements: improvements.rows
    }
  });
}));

/**
 * GET /api/users/limits
 * Obtener límites según el plan del usuario
 */
router.get('/limits', authenticate, asyncHandler(async (req, res) => {
  const userResult = await query(
    'SELECT plan FROM users WHERE id = $1',
    [req.user.id]
  );

  const plan = userResult.rows[0]?.plan || 'free';

  // Definir límites por plan
  const limits = {
    free: {
      appsPerMonth: 3,
      maxVersionsPerApp: 5,
      apiCallsPerHour: 10,
      features: ['basic_generation']
    },
    basic: {
      appsPerMonth: 10,
      maxVersionsPerApp: 20,
      apiCallsPerHour: 50,
      features: ['basic_generation', 'improvements', 'templates']
    },
    pro: {
      appsPerMonth: -1, // Ilimitado
      maxVersionsPerApp: -1,
      apiCallsPerHour: 200,
      features: ['basic_generation', 'improvements', 'templates', 'advanced_features', 'api_access']
    },
    enterprise: {
      appsPerMonth: -1,
      maxVersionsPerApp: -1,
      apiCallsPerHour: -1,
      features: ['basic_generation', 'improvements', 'templates', 'advanced_features', 'api_access', 'priority_support', 'custom_integrations']
    }
  };

  // Obtener uso actual
  const currentUsage = await query(
    `SELECT COUNT(*) as apps_this_month
     FROM apps
     WHERE user_id = $1
       AND created_at > DATE_TRUNC('month', CURRENT_DATE)`,
    [req.user.id]
  );

  res.json({
    success: true,
    plan,
    limits: limits[plan],
    usage: {
      appsThisMonth: parseInt(currentUsage.rows[0].apps_this_month)
    }
  });
}));

/**
 * DELETE /api/users/me
 * Eliminar cuenta de usuario
 */
router.delete('/me', authenticate, asyncHandler(async (req, res) => {
  const { confirmation } = req.body;

  if (confirmation !== 'DELETE') {
    throw new AppError('Please confirm account deletion by sending "DELETE"', 400);
  }

  // Eliminar usuario (cascade eliminará apps, versiones, etc.)
  await query(
    'DELETE FROM users WHERE id = $1',
    [req.user.id]
  );

  // TODO: También eliminar de Supabase Auth si es necesario

  res.json({
    success: true,
    message: 'Account deleted successfully'
  });
}));

export default router;
