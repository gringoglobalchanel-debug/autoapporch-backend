// backend/src/middleware/checkTrialExpiration.js
import { query } from '../config/database.js';

export const checkTrialExpiration = async (req, res, next) => {
  if (!req.user) {
    return next();
  }

  try {
    const result = await query(
      `SELECT plan, trial_ends_at, status 
       FROM subscriptions 
       WHERE user_id = $1 
       AND status = 'trial'`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return next();
    }

    const subscription = result.rows[0];
    const now = new Date();
    const trialEnds = new Date(subscription.trial_ends_at);

    // Si el trial expiró
    if (now > trialEnds) {
      // Actualizar status a 'expired'
      await query(
        `UPDATE subscriptions 
         SET status = 'expired', 
             apps_allowed = 0,
             token_limit = 0,
             updated_at = NOW()
         WHERE user_id = $1`,
        [req.user.id]
      );

      // Si es una petición a /api/generate o /api/deploy, bloquear
      if (req.path.includes('/generate') || req.path.includes('/deploy')) {
        return res.status(403).json({
          success: false,
          message: 'Your free trial has ended. Please choose a plan to continue.',
          upgradeUrl: '/pricing',
          trialEnded: true
        });
      }
    }

    // Añadir información del trial al request
    req.trial = {
      isActive: now <= trialEnds,
      endsAt: trialEnds,
      daysRemaining: Math.ceil((trialEnds - now) / (1000 * 60 * 60 * 24))
    };

    next();
  } catch (error) {
    console.error('Error checking trial expiration:', error);
    next();
  }
};