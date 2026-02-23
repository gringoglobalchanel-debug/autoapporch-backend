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

// Cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/auth/register
 * Registrar nuevo usuario con prueba gratuita de 15 días
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, fullName } = req.body;

  // Validación
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters'
    });
  }

  // Registrar en Supabase Auth
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

  // Crear usuario en nuestra base de datos + suscripción trial
  try {
    // 1. Insertar usuario
    await query(
      `INSERT INTO users (id, email, full_name, role, plan)
       VALUES ($1, $2, $3, $4, $5)`,
      [authData.user.id, email, fullName || '', 'user', 'free_trial']
    );

    // 2. Crear suscripción trial de 15 días
    await query(
      `INSERT INTO subscriptions (
        user_id, 
        plan, 
        status, 
        trial_ends_at,
        token_limit,
        tokens_used,
        apps_allowed,
        apps_created,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, NOW() + INTERVAL '15 days', $4, 0, $5, 0, NOW(), NOW())`,
      [
        authData.user.id, 
        'free_trial', 
        'trial', 
        10000,  // token_limit
        1       // apps_allowed
      ]
    );

    // 3. Registrar log de trial
    await query(
      `INSERT INTO logs (user_id, log_type, message, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        authData.user.id,
        'info',
        'Usuario registrado con trial de 15 días',
        JSON.stringify({ 
          trial_days: 15, 
          trial_ends: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) 
        })
      ]
    );

  } catch (dbError) {
    // Si falla la creación en DB, eliminar de Supabase Auth
    await supabase.auth.admin.deleteUser(authData.user.id);
    
    console.error('❌ Database user creation error:', dbError);
    return res.status(500).json({
      success: false,
      message: 'Failed to create user profile'
    });
  }

  res.status(201).json({
    success: true,
    message: 'User registered successfully. 15-day free trial started!',
    user: {
      id: authData.user.id,
      email: authData.user.email,
      fullName: fullName || ''
    },
    trial: {
      days: 15,
      endsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
    }
  });
}));

/**
 * POST /api/auth/login
 * Iniciar sesión
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  // Login con Supabase
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid credentials'
    });
  }

  // Obtener datos del usuario y suscripción
  const userResult = await query(
    'SELECT * FROM users WHERE id = $1',
    [data.user.id]
  );

  // Obtener suscripción activa
  const subResult = await query(
    `SELECT plan, status, trial_ends_at, apps_allowed, apps_created, token_limit, tokens_used
     FROM subscriptions 
     WHERE user_id = $1 AND status IN ('trial', 'active')
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

  res.json({
    success: true,
    message: 'Login successful',
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
      tokensLimit: subscription?.token_limit || 10000
    },
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at
    }
  });
}));

/**
 * POST /api/auth/logout
 * Cerrar sesión
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    // Cerrar sesión en Supabase
    await supabase.auth.admin.signOut(token);
  }

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

/**
 * POST /api/auth/refresh
 * Refrescar token de acceso
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required'
    });
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid refresh token'
    });
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
 * Solicitar reset de contraseña
 */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.CORS_ORIGIN}/reset-password`
  });

  if (error) {
    console.error('❌ Password reset error:', error);
  }

  res.json({
    success: true,
    message: 'If that email exists, a password reset link has been sent'
  });
}));

/**
 * POST /api/auth/reset-password
 * Resetear contraseña
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Token and new password are required'
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters'
    });
  }

  const { data: { user }, error: getUserError } = await supabase.auth.getUser(token);
  
  if (getUserError || !user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired reset token'
    });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  );

  if (updateError) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update password'
    });
  }

  res.json({
    success: true,
    message: 'Password updated successfully'
  });
}));

export default router;