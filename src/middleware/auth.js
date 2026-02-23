/**
 * Middleware de autenticación
 * Valida tokens de Supabase y protege rutas
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Inicializar cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Middleware para verificar autenticación
 * Extrae el token del header Authorization y valida con Supabase
 */
export const authenticate = async (req, res, next) => {
  try {
    // Extraer token del header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No authorization token provided'
      });
    }

    const token = authHeader.substring(7); // Remover "Bearer "

    // Verificar token con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Adjuntar usuario al request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.user_metadata?.role || 'user'
    };

    next();

  } catch (error) {
    console.error('❌ Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

/**
 * Middleware para verificar rol de administrador
 */
export const requireAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  next();
};

/**
 * Middleware para verificar plan de suscripción
 * @param {Array<string>} allowedPlans - Planes permitidos
 */
export const requirePlan = (allowedPlans) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    try {
      // Obtener plan del usuario desde la base de datos
      const { query } = await import('../config/database.js');
      
      const result = await query(
        'SELECT plan FROM users WHERE id = $1',
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const userPlan = result.rows[0].plan;

      if (!allowedPlans.includes(userPlan)) {
        return res.status(403).json({
          success: false,
          message: `This feature requires one of these plans: ${allowedPlans.join(', ')}`,
          currentPlan: userPlan
        });
      }

      req.user.plan = userPlan;
      next();

    } catch (error) {
      console.error('❌ Plan verification error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify subscription plan'
      });
    }
  };
};

/**
 * Middleware opcional de autenticación
 * No falla si no hay token, pero adjunta el usuario si existe
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (!error && user) {
      req.user = {
        id: user.id,
        email: user.email,
        role: user.user_metadata?.role || 'user'
      };
    }

    next();

  } catch (error) {
    // En caso de error, continuar sin usuario
    next();
  }
};

export default {
  authenticate,
  requireAdmin,
  requirePlan,
  optionalAuth
};
