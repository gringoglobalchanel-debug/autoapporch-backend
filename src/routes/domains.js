/**
 * Rutas de dominios personalizados
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { requirePlan } from '../middleware/permissions.js';
import { checkDomainLimit } from '../middleware/domainLimits.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as domainService from '../services/domainService.js';

const router = express.Router();

/**
 * GET /api/domains/:appId
 * Obtener dominios de una app
 */
router.get('/:appId', authenticate, asyncHandler(async (req, res) => {
  const { appId } = req.params;

  const domains = await query(
    `SELECT d.*, a.custom_domain as primary_domain
     FROM app_domains d
     JOIN apps a ON a.id = d.app_id
     WHERE d.app_id = $1 AND a.user_id = $2
     ORDER BY d.created_at DESC`,
    [appId, req.user.id]
  );

  // Obtener límites del plan
  const subResult = await query(
    'SELECT plan, domains_allowed, domains_used FROM subscriptions WHERE user_id = $1',
    [req.user.id]
  );

  res.json({
    success: true,
    domains: domains.rows,
    limits: {
      allowed: subResult.rows[0]?.domains_allowed || 0,
      used: subResult.rows[0]?.domains_used || 0,
      remaining: (subResult.rows[0]?.domains_allowed || 0) - (subResult.rows[0]?.domains_used || 0)
    }
  });
}));

/**
 * POST /api/domains/:appId
 * Agregar dominio personalizado
 */
router.post('/:appId',
  authenticate,
  requirePlan(['premium', 'pro']),
  checkDomainLimit,
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const { domain } = req.body;

    if (!domain) {
      throw new AppError('Domain is required', 400);
    }

    // Validar formato básico
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain)) {
      throw new AppError('Invalid domain format', 400);
    }

    // Verificar que la app existe y pertenece al usuario
    const appResult = await query(
      'SELECT id FROM apps WHERE id = $1 AND user_id = $2',
      [appId, req.user.id]
    );

    if (appResult.rows.length === 0) {
      throw new AppError('App not found', 404);
    }

    // Verificar que no esté duplicado
    const existing = await query(
      'SELECT id FROM app_domains WHERE domain = $1',
      [domain.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      throw new AppError('Este dominio ya está configurado en otra app', 400);
    }

    const result = await domainService.addCustomDomain(appId, domain, req.user.id);

    if (!result.success) {
      throw new AppError(result.error, 500);
    }

    res.json({
      success: true,
      domain: result.domain,
      verification: result.verification,
      message: 'Dominio agregado. Sigue las instrucciones de configuración DNS.'
    });
  })
);

/**
 * GET /api/domains/:appId/:domain/verify
 * Verificar estado del dominio
 */
router.get('/:appId/:domain/verify', authenticate, asyncHandler(async (req, res) => {
  const { appId, domain } = req.params;

  const result = await domainService.verifyDomainStatus(appId, domain);

  res.json({
    success: true,
    verified: result.verified,
    status: result.status
  });
}));

/**
 * DELETE /api/domains/:appId/:domain
 * Eliminar dominio
 */
router.delete('/:appId/:domain', authenticate, asyncHandler(async (req, res) => {
  const { appId, domain } = req.params;

  const result = await domainService.removeCustomDomain(appId, domain, req.user.id);

  if (!result.success) {
    throw new AppError(result.error, 500);
  }

  res.json({
    success: true,
    message: 'Dominio eliminado correctamente'
  });
}));

/**
 * GET /api/domains/limits/check
 * Verificar si puede agregar más dominios
 */
router.get('/limits/check', authenticate, asyncHandler(async (req, res) => {
  const subResult = await query(
    'SELECT plan, domains_allowed, domains_used FROM subscriptions WHERE user_id = $1',
    [req.user.id]
  );

  const sub = subResult.rows[0];
  const remaining = (sub?.domains_allowed || 0) - (sub?.domains_used || 0);

  res.json({
    success: true,
    plan: sub?.plan || 'basico',
    allowed: sub?.domains_allowed || 0,
    used: sub?.domains_used || 0,
    remaining,
    canAdd: remaining > 0
  });
}));

export default router;