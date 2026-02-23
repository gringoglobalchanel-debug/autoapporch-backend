/**
 * ═══════════════════════════════════════════════════════════════════
 * RUTAS DE DEPLOYMENT - Sistema Completo
 * ═══════════════════════════════════════════════════════════════════
 * 
 * ENDPOINTS:
 * POST   /api/deploy/:id              - Deploy inicial
 * POST   /api/deploy/:id/update       - Actualizar app (nueva versión)
 * POST   /api/deploy/:id/rollback     - Rollback a versión anterior
 * POST   /api/deploy/:id/suspend      - Suspender app
 * POST   /api/deploy/:id/reactivate   - Reactivar app
 * GET    /api/deploy/:id/status       - Estado del deployment
 * GET    /api/deploy/:id/versions     - Historial de versiones
 * 
 * ═══════════════════════════════════════════════════════════════════
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireOwnership } from '../middleware/permissions.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as deploymentService from '../services/deploymentService.js';
import { query } from '../config/database.js';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// 1️⃣ DEPLOY INICIAL
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/deploy/:id
 * Desplegar app por primera vez
 */
router.post('/:id',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    console.log(`\n🚀 [API] Iniciando deploy de app ${id}`);

    const result = await deploymentService.deployApp(id, req.user.id);

    if (!result.success) {
      throw new AppError(result.error, 500);
    }

    res.json({
      success: true,
      data: {
        deployUrl: result.deployUrl,
        backupUrl: result.backupUrl,
        deploymentId: result.deploymentId,
        version: result.version
      },
      message: result.message
    });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 2️⃣ ACTUALIZAR APP (Nueva versión)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/deploy/:id/update
 * Actualizar app con nueva versión
 * Body: { updateDescription: string, code: object }
 */
router.post('/:id/update',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { updateDescription, code } = req.body;

    if (!code) {
      throw new AppError('Code is required for update', 400);
    }

    console.log(`\n🔄 [API] Actualizando app ${id}`);

    const result = await deploymentService.updateApp(
      id,
      req.user.id,
      code,
      updateDescription || 'Update via API'
    );

    if (!result.success) {
      throw new AppError(result.error, 500);
    }

    res.json({
      success: true,
      data: {
        version: result.version,
        deployUrl: result.deployUrl,
        deploymentId: result.deploymentId
      },
      message: result.message
    });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 3️⃣ ROLLBACK (Volver a versión anterior)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/deploy/:id/rollback
 * Hacer rollback a una versión específica
 * Body: { targetVersion: string }
 */
router.post('/:id/rollback',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { targetVersion } = req.body;

    if (!targetVersion) {
      throw new AppError('targetVersion is required', 400);
    }

    console.log(`\n↩️ [API] Rollback de app ${id} a ${targetVersion}`);

    const result = await deploymentService.rollbackApp(
      id,
      req.user.id,
      targetVersion
    );

    if (!result.success) {
      throw new AppError(result.error, 500);
    }

    res.json({
      success: true,
      data: {
        version: result.version,
        deployUrl: result.deployUrl
      },
      message: result.message
    });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 4️⃣ SUSPENDER APP (Por falta de pago)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/deploy/:id/suspend
 * Suspender app (eliminar deployment)
 * Body: { reason?: string }
 */
router.post('/:id/suspend',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    console.log(`\n🚫 [API] Suspendiendo app ${id}`);

    const result = await deploymentService.suspendApp(
      id,
      req.user.id,
      reason || 'Suspended by user'
    );

    if (!result.success) {
      throw new AppError(result.error, 500);
    }

    res.json({
      success: true,
      message: result.message
    });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 5️⃣ REACTIVAR APP (Después del pago)
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/deploy/:id/reactivate
 * Reactivar app suspendida
 */
router.post('/:id/reactivate',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    console.log(`\n✅ [API] Reactivando app ${id}`);

    const result = await deploymentService.reactivateApp(
      id,
      req.user.id
    );

    if (!result.success) {
      throw new AppError(result.error, 500);
    }

    res.json({
      success: true,
      data: {
        deployUrl: result.deployUrl
      },
      message: result.message
    });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 6️⃣ ESTADO DEL DEPLOYMENT
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/deploy/:id/status
 * Obtener estado actual del deployment
 */
router.get('/:id/status',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await deploymentService.getDeploymentStatus(id);

    if (!result.success) {
      throw new AppError(result.error, 404);
    }

    res.json({
      success: true,
      data: {
        deploymentStatus: result.deployment_status,
        deployUrl: result.deploy_url,
        deploymentId: result.vercel_deployment_id,
        currentVersion: result.current_version,
        updatedAt: result.updated_at
      }
    });
  })
);

// ═══════════════════════════════════════════════════════════════════
// 7️⃣ HISTORIAL DE VERSIONES
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/deploy/:id/versions
 * Obtener historial de versiones de la app
 */
router.get('/:id/versions',
  authenticate,
  requireOwnership('app', 'id'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        av.version,
        av.generation_prompt as description,
        av.created_at,
        av.tokens_used,
        av.generation_time_ms,
        a.current_version
      FROM app_versions av
      JOIN apps a ON av.app_id = a.id
      WHERE av.app_id = $1
      ORDER BY av.version DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        versions: result.rows,
        currentVersion: result.rows[0]?.current_version
      }
    });
  })
);

export default router;