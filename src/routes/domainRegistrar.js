/**
 * Rutas de registro automático de dominios
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { godaddyService } from '../services/godaddyService.js';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/domain-registrar/check
 * Verificar disponibilidad de un dominio
 */
router.get('/check', authenticate, asyncHandler(async (req, res) => {
  const { domain } = req.query;
  if (!domain) throw new AppError('Domain requerido', 400);

  const result = await godaddyService.checkAvailability(domain);
  res.json({ success: true, ...result });
}));

/**
 * GET /api/domain-registrar/suggest
 * Sugerir dominios disponibles basados en el nombre del negocio
 */
router.get('/suggest', authenticate, asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name) throw new AppError('Name requerido', 400);

  const suggestions = await godaddyService.suggestDomains(name);
  res.json({ success: true, suggestions });
}));

/**
 * POST /api/domain-registrar/register
 * Registrar dominio automáticamente para una app
 */
router.post('/register', authenticate, asyncHandler(async (req, res) => {
  const { appId, domain } = req.body;

  if (!appId || !domain) throw new AppError('appId y domain son requeridos', 400);

  // Verificar plan del usuario
  const subResult = await query(
    `SELECT plan, domains_allowed, domains_used 
     FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );

  const sub = subResult.rows[0];

  if (!sub || sub.plan === 'basico') {
    return res.status(403).json({
      success: false,
      message: 'Los dominios personalizados requieren plan Premium o Pro',
      upgradeRequired: true
    });
  }

  const remaining = (sub.domains_allowed || 0) - (sub.domains_used || 0);
  if (remaining <= 0) {
    return res.status(403).json({
      success: false,
      message: `Has usado todos tus dominios incluidos (${sub.domains_allowed})`,
      upgradeRequired: sub.plan === 'premium'
    });
  }

  // Verificar que la app pertenece al usuario
  const appResult = await query(
    'SELECT id, vercel_project_name FROM apps WHERE id = $1 AND user_id = $2',
    [appId, req.user.id]
  );

  if (appResult.rows.length === 0) throw new AppError('App no encontrada', 404);

  const app = appResult.rows[0];

  // Verificar que no tiene ya un dominio registrado
  const existingDomain = await query(
    'SELECT domain FROM registered_domains WHERE app_id = $1 AND status != $2',
    [appId, 'expired']
  );

  if (existingDomain.rows.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Esta app ya tiene el dominio ${existingDomain.rows[0].domain} asignado`
    });
  }

  console.log(`🌐 Usuario ${req.user.id} registrando dominio ${domain} para app ${appId}`);

  // 1. Registrar en GoDaddy
  const registration = await godaddyService.registerDomain(domain, req.user.id, appId);
  if (!registration.success) throw new AppError(registration.error, 500);

  // 2. Conectar a Vercel
  if (app.vercel_project_name) {
    const connection = await godaddyService.connectToVercel(domain, app.vercel_project_name);
    if (!connection.success) {
      console.error('⚠️ Dominio registrado pero no conectado a Vercel:', connection.error);
    }
  }

  // 3. Incrementar contador de dominios usados
  await query(
    `UPDATE subscriptions SET domains_used = domains_used + 1 WHERE user_id = $1`,
    [req.user.id]
  );

  res.json({
    success: true,
    domain,
    message: `Dominio ${domain} registrado y activo`,
    expiresAt: registration.expiresAt
  });
}));

/**
 * GET /api/domain-registrar/my-domains
 * Obtener dominios registrados del usuario
 */
router.get('/my-domains', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT rd.*, a.name as app_name, a.deploy_url
     FROM registered_domains rd
     JOIN apps a ON a.id = rd.app_id
     WHERE rd.user_id = $1
     ORDER BY rd.created_at DESC`,
    [req.user.id]
  );

  const subResult = await query(
    `SELECT plan, domains_allowed, domains_used FROM subscriptions 
     WHERE user_id = $1 AND status IN ('active', 'trialing')
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );

  const sub = subResult.rows[0];

  res.json({
    success: true,
    domains: result.rows,
    limits: {
      allowed: sub?.domains_allowed || 0,
      used: sub?.domains_used || 0,
      remaining: (sub?.domains_allowed || 0) - (sub?.domains_used || 0)
    }
  });
}));

export default router;