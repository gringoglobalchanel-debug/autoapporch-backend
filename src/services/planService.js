// backend/src/services/planService.js

export const PLANS = {
  free_trial: {
    apps_allowed: 1,
    token_limit: 10000,
    price: 0,
    trial_days: 7,
    domains_allowed: 0,
    label: 'Prueba Gratuita'
  },
  basico: {
    apps_allowed: 3,
    token_limit: 50000,
    price: 29.99,
    domains_allowed: 0,
    label: 'Básico'
  },
  premium: {
    apps_allowed: 8,
    token_limit: 150000,
    price: 49.99,
    domains_allowed: 1,
    label: 'Premium'
  },
  pro: {
    apps_allowed: 25,
    token_limit: 500000,
    price: 99.99,
    domains_allowed: 5,
    label: 'Pro'
  }
};

// Mensaje claro según el plan actual
export function getUpgradeMessage(currentPlan, appsAllowed) {
  const messages = {
    free_trial: `Has alcanzado el límite de ${appsAllowed} apps en tu prueba gratuita. Actualiza al plan Básico ($29.99/mes) para continuar.`,
    basico: `Has alcanzado el límite de ${appsAllowed} apps del plan Básico. Actualiza al plan Premium ($49.99/mes) para crear hasta 8 apps.`,
    premium: `Has alcanzado el límite de ${appsAllowed} apps del plan Premium. Actualiza al plan Pro ($99.99/mes) para crear hasta 25 apps.`,
    pro: `Has alcanzado el límite de ${appsAllowed} apps del plan Pro. Contacta soporte para un plan empresarial.`
  };
  return messages[currentPlan] || `Has alcanzado el límite de ${appsAllowed} apps. Actualiza tu plan para continuar.`;
}

/**
 * Obtener suscripción del usuario
 */
export async function getUserSubscription(userId) {
  const { query } = await import('../config/database.js');
  
  const result = await query(
    `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    // Crear suscripción free_trial por defecto
    const insert = await query(
      `INSERT INTO subscriptions (user_id, plan, status, apps_allowed, token_limit, domains_allowed, trial_ends_at)
       VALUES ($1, 'free_trial', 'trial', $2, $3, $4, NOW() + INTERVAL '7 days')
       RETURNING *`,
      [userId, PLANS.free_trial.apps_allowed, PLANS.free_trial.token_limit, PLANS.free_trial.domains_allowed]
    );
    return insert.rows[0];
  }
  
  return result.rows[0];
}

/**
 * Verificar si puede crear otra app
 */
export async function canCreateApp(userId) {
  const sub = await getUserSubscription(userId);

  // Si el trial expiró, no puede crear
  if (sub.status === 'expired') return false;

  // Si tiene suscripción activa o en trial, verificar límite
  const appsCreated = sub.apps_created || 0;
  const appsAllowed = sub.apps_allowed || PLANS[sub.plan]?.apps_allowed || 1;

  return appsCreated < appsAllowed;
}

/**
 * Incrementar contador de apps creadas
 */
export async function incrementAppCount(userId) {
  const { query } = await import('../config/database.js');
  
  await query(
    `UPDATE subscriptions 
     SET apps_created = apps_created + 1, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Actualizar uso de tokens
 */
export async function updateTokenUsage(userId, tokens) {
  const { query } = await import('../config/database.js');
  
  await query(
    `UPDATE subscriptions 
     SET tokens_used = tokens_used + $1, updated_at = NOW()
     WHERE user_id = $2`,
    [tokens, userId]
  );
}

/**
 * Verificar si el trial es válido
 */
export async function isTrialValid(userId) {
  const { query } = await import('../config/database.js');
  
  const result = await query(
    `SELECT * FROM subscriptions 
     WHERE user_id = $1 AND status = 'trial' AND trial_ends_at > NOW()`,
    [userId]
  );
  
  return result.rows.length > 0;
}

export default {
  PLANS,
  getUpgradeMessage,
  getUserSubscription,
  canCreateApp,
  incrementAppCount,
  updateTokenUsage,
  isTrialValid
};