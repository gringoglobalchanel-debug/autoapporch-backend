/**
 * Middleware de Permisos y Roles Avanzado
 * Control granular de acceso a recursos
 */

import { query } from '../config/database.js';
import { AppError } from './errorHandler.js';

/**
 * Definición de permisos por rol
 */
const PERMISSIONS = {
  admin: {
    apps: ['create', 'read', 'update', 'delete', 'deploy'],
    users: ['create', 'read', 'update', 'delete'],
    billing: ['read', 'update'],
    analytics: ['read'],
    settings: ['read', 'update'],
  },
  user: {
    apps: ['create', 'read', 'update', 'delete'],
    users: ['read'],
    billing: ['read', 'update'],
    analytics: [],
    settings: ['read', 'update'],
  },
  viewer: {
    apps: ['read'],
    users: [],
    billing: ['read'],
    analytics: [],
    settings: ['read'],
  },
};

/**
 * Límites por plan - CORREGIDO según checklist
 */
const PLAN_LIMITS = {
  free_trial: {
    appsPerMonth: 1,
    deploysPerMonth: 1,
    apiCallsPerHour: 10,
    storageGB: 0.5,
    teamMembers: 1,
    trialDays: 15,
    tokensPerMonth: 10000,
  },
  basico: {
    appsPerMonth: 3,
    deploysPerMonth: 30,
    apiCallsPerHour: 50,
    storageGB: 5,
    teamMembers: 1,
    tokensPerMonth: 50000,
  },
  premium: {
    appsPerMonth: 8,
    deploysPerMonth: 80,
    apiCallsPerHour: 150,
    storageGB: 20,
    teamMembers: 3,
    tokensPerMonth: 150000,
  },
  pro: {
    appsPerMonth: 25,
    deploysPerMonth: 250,
    apiCallsPerHour: 500,
    storageGB: 100,
    teamMembers: 10,
    tokensPerMonth: 500000,
  },
  enterprise: {
    appsPerMonth: Infinity,
    deploysPerMonth: Infinity,
    apiCallsPerHour: Infinity,
    storageGB: 1000,
    teamMembers: Infinity,
    tokensPerMonth: Infinity,
  },
};

/**
 * Características por plan - CORREGIDO
 */
const PLAN_FEATURES = {
  free_trial: ['basic_generation', 'deploy', 'domain_vercel', 'ssl'],
  basico: ['basic_generation', 'deploy', 'domain_vercel', 'ssl', 'email_support'],
  premium: ['basic_generation', 'deploy', 'domain_vercel', 'ssl', 'email_support', 'backups', 'priority_queue', 'custom_domains', 'maps'],
  pro: ['basic_generation', 'deploy', 'domain_vercel', 'ssl', 'email_support', 'backups', 'priority_queue', 'custom_domains', 'maps', 'api_access', 'priority_support', 'analytics', 'team_members'],
  enterprise: ['basic_generation', 'deploy', 'domain_vercel', 'ssl', 'backups', 'custom_domains', 'maps', 'api_access', 'priority_support', 'custom_integrations', 'sla'],
};

/**
 * Verificar si un usuario tiene un permiso específico
 * @param {Object} user - Usuario con rol
 * @param {string} resource - Recurso (apps, users, etc.)
 * @param {string} action - Acción (create, read, update, delete)
 */
export const hasPermission = (user, resource, action) => {
  const role = user.role || 'user';
  const rolePermissions = PERMISSIONS[role];

  if (!rolePermissions) {
    return false;
  }

  const resourcePermissions = rolePermissions[resource];

  if (!resourcePermissions) {
    return false;
  }

  return resourcePermissions.includes(action);
};

/**
 * Middleware para verificar permisos
 * @param {string} resource - Recurso
 * @param {string} action - Acción
 */
export const requirePermission = (resource, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    if (!hasPermission(req.user, resource, action)) {
      return res.status(403).json({
        success: false,
        message: `You don't have permission to ${action} ${resource}`,
        required: `${resource}:${action}`,
        role: req.user.role,
      });
    }

    next();
  };
};

/**
 * Verificar si el usuario es dueño del recurso
 * @param {string} resourceType - Tipo de recurso (app, etc.)
 * @param {string} idParam - Nombre del parámetro con el ID
 */
export const requireOwnership = (resourceType, idParam = 'id') => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const resourceId = req.params[idParam];

    if (!resourceId) {
      return next(new AppError('Resource ID not provided', 400));
    }

    try {
      let result;

      switch (resourceType) {
        case 'app':
          result = await query(
            'SELECT user_id FROM apps WHERE id = $1',
            [resourceId]
          );
          break;

        case 'improvement_request':
          result = await query(
            'SELECT user_id FROM improvement_requests WHERE id = $1',
            [resourceId]
          );
          break;

        default:
          return next(new AppError(`Unknown resource type: ${resourceType}`, 400));
      }

      if (result.rows.length === 0) {
        return next(new AppError('Resource not found', 404));
      }

      const ownerId = result.rows[0].user_id;

      // Admins pueden acceder a cualquier recurso
      if (req.user.role === 'admin') {
        return next();
      }

      if (ownerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: `You don't own this ${resourceType}`,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Verificar límites del plan
 * @param {string} limitType - Tipo de límite (appsPerMonth, etc.)
 */
export const checkPlanLimit = (limitType) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    try {
      // Obtener suscripción del usuario (NO de users.plan)
      const subResult = await query(
        `SELECT plan, apps_created, tokens_used 
         FROM subscriptions 
         WHERE user_id = $1 AND status IN ('trial', 'active')`,
        [req.user.id]
      );

      // Si no tiene suscripción activa, asignar free_trial
      let userPlan = 'free_trial';
      let appsCreated = 0;
      let tokensUsed = 0;

      if (subResult.rows.length > 0) {
        userPlan = subResult.rows[0].plan;
        appsCreated = subResult.rows[0].apps_created;
        tokensUsed = subResult.rows[0].tokens_used;
      }

      const limit = PLAN_LIMITS[userPlan]?.[limitType];

      // Si el límite es infinito, permitir
      if (limit === Infinity) {
        return next();
      }

      // Verificar uso actual según tipo de límite
      let currentUsage = 0;

      switch (limitType) {
        case 'appsPerMonth':
          currentUsage = appsCreated;
          break;

        case 'deploysPerMonth':
          const deploysResult = await query(
            `SELECT COUNT(*) as count FROM logs 
             WHERE user_id = $1 
             AND log_type = 'info'
             AND message LIKE '%deployed%'
             AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
            [req.user.id]
          );
          currentUsage = parseInt(deploysResult.rows[0].count);
          break;

        case 'apiCallsPerHour':
          const apiResult = await query(
            `SELECT COUNT(*) as count FROM api_usage 
             WHERE user_id = $1 
             AND created_at >= NOW() - INTERVAL '1 hour'`,
            [req.user.id]
          );
          currentUsage = parseInt(apiResult.rows[0].count);
          break;

        case 'tokensPerMonth':
          currentUsage = tokensUsed;
          break;

        default:
          return next();
      }

      if (currentUsage >= limit) {
        return res.status(429).json({
          success: false,
          message: `Plan limit reached: ${limitType}`,
          limit,
          currentUsage,
          plan: userPlan,
          upgradeUrl: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/pricing`,
        });
      }

      // Añadir info al request
      req.planLimit = {
        limit,
        currentUsage,
        remaining: limit - currentUsage,
        plan: userPlan,
      };

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware combinado: permisos + ownership
 * @param {string} resource - Recurso
 * @param {string} action - Acción
 * @param {string} resourceType - Tipo para ownership
 * @param {string} idParam - Parámetro del ID
 */
export const requirePermissionAndOwnership = (
  resource,
  action,
  resourceType,
  idParam = 'id'
) => {
  return [
    requirePermission(resource, action),
    requireOwnership(resourceType, idParam),
  ];
};

/**
 * Verificar si el usuario puede realizar una acción basada en feature flags
 * @param {string} feature - Feature a verificar
 */
export const requireFeature = (feature) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Obtener plan de la suscripción
    const subResult = await query(
      'SELECT plan FROM subscriptions WHERE user_id = $1 AND status IN ($2, $3)',
      [req.user.id, 'trial', 'active']
    );

    const userPlan = subResult.rows[0]?.plan || 'free_trial';
    const hasFeature = PLAN_FEATURES[userPlan]?.includes(feature);

    if (!hasFeature) {
      return res.status(403).json({
        success: false,
        message: `This feature requires a higher plan`,
        feature,
        currentPlan: userPlan,
        upgradeUrl: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/pricing`,
      });
    }

    next();
  };
};

/**
 * Obtener límites del plan del usuario
 * @param {string} userId - ID del usuario
 */
export const getUserLimits = async (userId) => {
  const subResult = await query(
    'SELECT plan FROM subscriptions WHERE user_id = $1 AND status IN ($2, $3)',
    [userId, 'trial', 'active']
  );

  const userPlan = subResult.rows[0]?.plan || 'free_trial';
  return PLAN_LIMITS[userPlan];
};

// ============================================
// EXPORTS FALTANTES - AGREGADOS PARA DOMINIOS
// ============================================

/**
 * Verificar si el usuario tiene un plan específico
 * @param {string|string[]} requiredPlans - Plan o planes requeridos
 */
export const requirePlan = (requiredPlans) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    try {
      // Obtener suscripción del usuario
      const subResult = await query(
        `SELECT plan FROM subscriptions 
         WHERE user_id = $1 AND status IN ('trial', 'active')`,
        [req.user.id]
      );

      const userPlan = subResult.rows[0]?.plan || 'free_trial';
      
      // Convertir a array si es string
      const plans = Array.isArray(requiredPlans) ? requiredPlans : [requiredPlans];
      
      if (!plans.includes(userPlan)) {
        return res.status(403).json({
          success: false,
          message: `This feature requires one of these plans: ${plans.join(', ')}`,
          currentPlan: userPlan,
          upgradeUrl: `${process.env.CORS_ORIGIN || 'http://localhost:3000'}/pricing`
        });
      }

      next();
    } catch (error) {
      console.error('Error checking plan:', error);
      next(error);
    }
  };
};

/**
 * Obtener características del plan
 */
export const getPlanFeatures = (plan) => {
  return PLAN_FEATURES[plan] || [];
};

export default {
  hasPermission,
  requirePermission,
  requireOwnership,
  checkPlanLimit,
  requirePermissionAndOwnership,
  requireFeature,
  getUserLimits,
  requirePlan,
  getPlanFeatures,
  PERMISSIONS,
  PLAN_LIMITS,
  PLAN_FEATURES,
};