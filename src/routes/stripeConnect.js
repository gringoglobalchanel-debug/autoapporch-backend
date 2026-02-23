/**
 * Rutas de Stripe Connect
 * Permite a usuarios conectar su cuenta Stripe y recibir pagos directos
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { stripeConnectService } from '../services/stripeConnectService.js';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * POST /api/stripe-connect/create
 * Crear cuenta Connect para el usuario
 */
router.post('/create', authenticate, asyncHandler(async (req, res) => {
  const result = await stripeConnectService.createConnectAccount(
    req.user.id,
    req.user.email
  );

  if (!result.success) {
    throw new AppError(result.error, 500);
  }

  // Si la cuenta ya existía, solo retornar estado
  if (result.alreadyExists) {
    const status = await stripeConnectService.getAccountStatus(req.user.id);
    return res.json({ success: true, ...status });
  }

  // Generar link de onboarding inmediatamente
  const onboarding = await stripeConnectService.createOnboardingLink(req.user.id);

  res.json({
    success: true,
    accountId: result.accountId,
    onboardingUrl: onboarding.url,
    message: 'Cuenta creada. Completa el registro en Stripe.'
  });
}));

/**
 * GET /api/stripe-connect/status
 * Verificar estado de la cuenta Connect del usuario
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await stripeConnectService.getAccountStatus(req.user.id);
  res.json({ success: true, ...status });
}));

/**
 * GET /api/stripe-connect/onboarding
 * Generar nuevo link de onboarding (si el anterior expiró)
 */
router.get('/onboarding', authenticate, asyncHandler(async (req, res) => {
  // Si no tiene cuenta, crearla primero
  const userResult = await query(
    'SELECT stripe_account_id FROM users WHERE id = $1',
    [req.user.id]
  );

  if (!userResult.rows[0]?.stripe_account_id) {
    const created = await stripeConnectService.createConnectAccount(
      req.user.id,
      req.user.email
    );
    if (!created.success) throw new AppError(created.error, 500);
  }

  const result = await stripeConnectService.createOnboardingLink(req.user.id);

  if (!result.success) throw new AppError(result.error, 500);

  res.json({ success: true, url: result.url });
}));

/**
 * POST /api/stripe-connect/create-products
 * Crear productos en la cuenta Stripe del usuario automáticamente
 * Lo llama el appGenerator después de generar la app
 */
router.post('/create-products', authenticate, asyncHandler(async (req, res) => {
  const { appId, products } = req.body;

  if (!products?.length) {
    return res.status(400).json({ success: false, message: 'No hay productos para crear' });
  }

  // Obtener stripe_account_id del usuario
  const userResult = await query(
    'SELECT stripe_account_id, stripe_charges_enabled FROM users WHERE id = $1',
    [req.user.id]
  );

  const stripeAccountId = userResult.rows[0]?.stripe_account_id;

  if (!stripeAccountId) {
    return res.status(400).json({
      success: false,
      message: 'Debes conectar tu cuenta Stripe primero',
      needsConnect: true
    });
  }

  if (!userResult.rows[0]?.stripe_charges_enabled) {
    return res.status(400).json({
      success: false,
      message: 'Tu cuenta Stripe aun no esta activa. Completa el registro.',
      needsOnboarding: true
    });
  }

  // Crear productos en Stripe
  const created = await stripeConnectService.createProductsForUser(
    stripeAccountId,
    products
  );

  // Guardar en la app
  if (appId && created.length > 0) {
    await query(
      `UPDATE apps SET 
       stripe_account_id = $1,
       stripe_products = $2,
       stripe_price_ids = $3
       WHERE id = $4 AND user_id = $5`,
      [
        stripeAccountId,
        JSON.stringify(created),
        JSON.stringify(created.map(p => p.price_id)),
        appId,
        req.user.id
      ]
    );
  }

  res.json({
    success: true,
    products: created,
    message: `${created.length} productos creados en tu cuenta Stripe`
  });
}));

/**
 * GET /api/stripe-connect/dashboard
 * Generar link al dashboard de Stripe del usuario
 */
router.get('/dashboard', authenticate, asyncHandler(async (req, res) => {
  const userResult = await query(
    'SELECT stripe_account_id FROM users WHERE id = $1',
    [req.user.id]
  );

  const stripeAccountId = userResult.rows[0]?.stripe_account_id;
  if (!stripeAccountId) {
    return res.status(404).json({ success: false, message: 'No tienes cuenta Stripe conectada' });
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);

  res.json({ success: true, url: loginLink.url });
}));

export default router;