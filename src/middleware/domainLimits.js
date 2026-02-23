/**
 * Middleware de límites de dominios
 */

import { query } from '../config/database.js';

export const checkDomainLimit = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const subResult = await query(
      `SELECT plan, domains_allowed, domains_used 
       FROM subscriptions 
       WHERE user_id = $1 AND status IN ('active', 'trialing')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (subResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'No tienes una suscripcion activa',
        upgradeRequired: true
      });
    }

    const subscription = subResult.rows[0];

    // Plan basico no incluye dominios personalizados
    if (subscription.plan === 'basico') {
      return res.status(403).json({
        success: false,
        message: 'Los dominios personalizados requieren plan Premium o Pro',
        plan: subscription.plan,
        upgradeRequired: true,
        upgrade: { url: '/billing' }
      });
    }

    const domainsAllowed = subscription.domains_allowed || 0;
    const domainsUsed = subscription.domains_used || 0;
    const remaining = domainsAllowed - domainsUsed;

    if (remaining <= 0) {
      return res.status(403).json({
        success: false,
        message: `Has alcanzado el limite de ${domainsAllowed} dominio(s) de tu plan ${subscription.plan}`,
        limits: { allowed: domainsAllowed, used: domainsUsed, remaining: 0 },
        upgradeRequired: subscription.plan === 'premium',
        upgrade: { price: 5, period: 'month', url: '/billing/domains' }
      });
    }

    req.domainLimit = { allowed: domainsAllowed, used: domainsUsed, remaining };
    next();

  } catch (error) {
    console.error('Error checking domain limit:', error);
    next(error);
  }
};

export const checkDomainOwnership = async (req, res, next) => {
  try {
    const { appId, domain } = req.params;
    const userId = req.user.id;

    const result = await query(
      `SELECT d.* FROM app_domains d
       JOIN apps a ON a.id = d.app_id
       WHERE d.app_id = $1 AND d.domain = $2 AND a.user_id = $3`,
      [appId, domain, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Dominio no encontrado o no te pertenece'
      });
    }

    req.domain = result.rows[0];
    next();
  } catch (error) {
    console.error('Error checking domain ownership:', error);
    next(error);
  }
};