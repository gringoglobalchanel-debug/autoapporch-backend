// backend/src/services/planService.js

export const PLANS = {
  free_trial: { apps_allowed: 1, token_limit: 10000, price: 0, trial_days: 15 },
  basico: { apps_allowed: 3, token_limit: 50000, price: 29.99 },
  premium: { apps_allowed: 8, token_limit: 150000, price: 49.99 },
  pro: { apps_allowed: 25, token_limit: 500000, price: 99.99 }
};

/**
 * Obtener suscripción del usuario
 */
export async function getUserSubscription(userId) {
  const { query } = await import('../config/database.js');
  
  const result = await query(
    `SELECT * FROM subscriptions WHERE user_id = $1`,
    [userId]
  );
  
  if (result.rows.length === 0) {
    // Crear suscripción free_trial por defecto
    const insert = await query(
      `INSERT INTO subscriptions (user_id, plan, status, apps_allowed, token_limit, trial_ends_at)
       VALUES ($1, 'free_trial', 'trial', $2, $3, NOW() + INTERVAL '15 days')
       RETURNING *`,
      [userId, PLANS.free_trial.apps_allowed, PLANS.free_trial.token_limit]
    );
    return insert.rows[0];
  }
  
  return result.rows[0];
}

/**
 * Verificar si puede crear otra app
 */
export async function canCreateApp(userId) {
  const { query } = await import('../config/database.js');
  
  const sub = await getUserSubscription(userId);
  return sub.apps_created < sub.apps_allowed;
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
  getUserSubscription,
  canCreateApp,
  incrementAppCount,
  updateTokenUsage,
  isTrialValid
};