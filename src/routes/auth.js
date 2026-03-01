/**
 * Rutas de autenticación
 * Maneja registro, login y gestión de usuarios con Supabase
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { query } from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/auth/register
 * Registrar nuevo usuario — trial de 7 días, requiere elegir plan
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, fullName } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email y contraseña son requeridos'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'La contraseña debe tener al menos 6 caracteres'
    });
  }

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName || '',
      role: 'user'
    }
  });

  if (authError) {
    console.error('❌ Supabase registration error:', authError);
    return res.status(400).json({
      success: false,
      message: authError.message
    });
  }

  try {
    // 1. Insertar usuario
    await query(
      `INSERT INTO users (id, email, full_name, role, plan)
       VALUES ($1, $2, $3, $4, $5)`,
      [authData.user.id, email, fullName || '', 'user', 'free_trial']
    );

    // 2. ✅ FIX: Trial de 7 días con 1 app permitida
    await query(
      `INSERT INTO subscriptions (
        user_id, plan, status, trial_ends_at,
        token_limit, tokens_used,
        apps_allowed, apps_created,
        domains_allowed, domains_used,
        created_at, updated_at
      ) VALUES ($1, $2, $3, NOW() + INTERVAL '7 days', $4, 0, $5, 0, 0, 0, NOW(), NOW())`,
      [
        authData.user.id,
        'free_trial',
        'trial',
        10000,  // token_limit
        1       // apps_allowed — solo 1 app en trial
      ]
    );

    // 3. Log
    await query(
      `INSERT INTO logs (user_id, log_type, message, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        authData.user.id,
        'info',
        'Usuario registrado con trial de 7 días',
        JSON.stringify({ 
          trial_days: 7,
          trial_ends: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          requires_plan_selection: true
        })
      ]
    );

  } catch (dbError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    console.error('❌ Database user creation error:', dbError);
    return res.status(500).json({
      success: false,
      message: 'Error al crear el perfil de usuario'
    });
  }

  res.status(201).json({
    success: true,
    message: '¡Cuenta creada! Tienes 7 días de prueba gratuita.',
    user: {
      id: authData.user.id,
      email: authData.user.email,
      fullName: fullName || ''
    },
    trial: {
      days: 7,
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    },
    // ✅ Indicar al frontend que debe ir a /billing
    requiresPlanSelection: true,
    redirectTo: '/billing?new_user=true'
  });
}));

/**
 * POST /api/auth/login
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email y contraseña son requeridos'
    });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return res.status(401).json({
      success: false,
      message: 'Credenciales inválidas'
    });
  }

  const userResult = await query(
    'SELECT * FROM users WHERE id = $1',
    [data.user.id]
  );

  const subResult = await query(
    `SELECT plan, status, trial_ends_at, apps_allowed, apps_created, 
            token_limit, tokens_used, domains_allowed, domains_used
     FROM subscriptions 
     WHERE user_id = $1 AND status IN ('trial', 'active', 'past_due')
     ORDER BY created_at DESC LIMIT 1`,
    [data.user.id]
  );

  const subscription = subResult.rows[0] || null;
  let trialDaysRemaining = 0;

  if (subscription?.status === 'trial' && subscription.trial_ends_at) {
    const now = new Date();
    const trialEnds = new Date(subscription.trial_ends_at);
    trialDaysRemaining = Math.max(0, Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24)));
  }

  // ✅ Si el trial venció y no tiene plan activo, indicar que debe elegir plan
  const trialExpired = subscription?.status === 'trial' && trialDaysRemaining === 0;
  const needsPlanSelection = !subscription || trialExpired;

  res.json({
    success: true,
    message: 'Login exitoso',
    user: {
      id: data.user.id,
      email: data.user.email,
      fullName: userResult.rows[0]?.full_name || '',
      plan: subscription?.plan || 'free_trial',
      role: userResult.rows[0]?.role || 'user'
    },
    subscription: {
      plan: subscription?.plan || 'free_trial',
      status: subscription?.status || 'trial',
      trialEndsAt: subscription?.trial_ends_at || null,
      trialDaysRemaining,
      appsUsed: subscription?.apps_created || 0,
      appsAllowed: subscription?.apps_allowed || 1,
      tokensUsed: subscription?.tokens_used || 0,
      tokensLimit: subscription?.token_limit || 10000,
      domainsAllowed: subscription?.domains_allowed || 0,
      domainsUsed: subscription?.domains_used || 0
    },
    needsPlanSelection,
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at
    }
  });
}));

/**
 * POST /api/auth/logout
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    await supabase.auth.admin.signOut(token);
  }

  res.json({ success: true, message: 'Sesión cerrada correctamente' });
}));

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token requerido' });
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

  if (error) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }

  res.json({
    success: true,
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at
    }
  });
}));

/**
 * POST /api/auth/forgot-password
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email requerido' });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.CORS_ORIGIN}/reset-password`
  });

  if (error) console.error('❌ Password reset error:', error);

  res.json({
    success: true,
    message: 'Si ese email existe, recibirás un enlace para restablecer tu contraseña'
  });
}));

/**
 * POST /api/auth/reset-password
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, message: 'Token y nueva contraseña son requeridos' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const { data: { user }, error: getUserError } = await supabase.auth.getUser(token);
  
  if (getUserError || !user) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  );

  if (updateError) {
    return res.status(500).json({ success: false, message: 'Error al actualizar la contraseña' });
  }

  res.json({ success: true, message: 'Contraseña actualizada correctamente' });
}));

export default router;