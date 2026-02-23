/**
 * Servicio de Analytics con PostHog
 * Tracking de eventos y comportamiento de usuarios
 */

import { PostHog } from 'posthog-node';
import dotenv from 'dotenv';

dotenv.config();

let posthog = null;

/**
 * Inicializar PostHog
 */
export const initPostHog = () => {
  if (!process.env.POSTHOG_API_KEY) {
    console.log('⚠️ PostHog not configured (POSTHOG_API_KEY missing)');
    return;
  }

  posthog = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
  });

  console.log('✅ PostHog initialized');
};

/**
 * Verificar si PostHog está habilitado
 */
const isEnabled = () => {
  if (!posthog) {
    console.log('⚠️ PostHog event skipped (not initialized)');
    return false;
  }
  return true;
};

/**
 * Track: App creada
 * @param {string} userId - ID del usuario
 * @param {Object} appData - Datos de la app
 */
export const trackAppCreated = (userId, appData) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'app_created',
    properties: {
      app_id: appData.id,
      app_name: appData.name,
      tech_stack: appData.techStack,
      complexity: appData.complexity,
      features_count: appData.features?.length || 0,
      timestamp: new Date().toISOString(),
    },
  });

  console.log('📊 Analytics: App created tracked');
};

/**
 * Track: App deployada
 * @param {string} userId - ID del usuario
 * @param {Object} deployData - Datos del deploy
 */
export const trackAppDeployed = (userId, deployData) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'app_deployed',
    properties: {
      app_id: deployData.appId,
      app_name: deployData.appName,
      deploy_url: deployData.deployUrl,
      provider: deployData.provider,
      duration_ms: deployData.durationMs,
      timestamp: new Date().toISOString(),
    },
  });

  console.log('📊 Analytics: App deployed tracked');
};

/**
 * Track: Error ocurrido
 * @param {string} userId - ID del usuario
 * @param {Object} errorData - Datos del error
 */
export const trackError = (userId, errorData) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'error_occurred',
    properties: {
      error_type: errorData.type,
      error_message: errorData.message,
      app_id: errorData.appId,
      endpoint: errorData.endpoint,
      severity: errorData.severity || 'medium',
      timestamp: new Date().toISOString(),
    },
  });

  console.log('📊 Analytics: Error tracked');
};

/**
 * Track: Upgrade de plan
 * @param {string} userId - ID del usuario
 * @param {Object} planData - Datos del plan
 */
export const trackPlanUpgrade = (userId, planData) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'plan_upgraded',
    properties: {
      from_plan: planData.fromPlan,
      to_plan: planData.toPlan,
      price: planData.price,
      interval: planData.interval,
      timestamp: new Date().toISOString(),
    },
  });

  console.log('📊 Analytics: Plan upgrade tracked');
};

/**
 * Track: Usuario registrado
 * @param {string} userId - ID del usuario
 * @param {Object} userData - Datos del usuario
 */
export const trackUserSignup = (userId, userData) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'user_signed_up',
    properties: {
      email: userData.email,
      signup_method: userData.method || 'email',
      timestamp: new Date().toISOString(),
    },
  });

  // Identificar usuario
  posthog.identify({
    distinctId: userId,
    properties: {
      email: userData.email,
      name: userData.fullName,
      plan: userData.plan || 'free',
    },
  });

  console.log('📊 Analytics: User signup tracked');
};

/**
 * Track: Usuario logueado
 * @param {string} userId - ID del usuario
 */
export const trackUserLogin = (userId) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'user_logged_in',
    properties: {
      timestamp: new Date().toISOString(),
    },
  });

  console.log('📊 Analytics: User login tracked');
};

/**
 * Track: Mejora de app solicitada
 * @param {string} userId - ID del usuario
 * @param {Object} improvementData - Datos de la mejora
 */
export const trackAppImprovement = (userId, improvementData) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: 'app_improvement_requested',
    properties: {
      app_id: improvementData.appId,
      app_name: improvementData.appName,
      current_version: improvementData.currentVersion,
      timestamp: new Date().toISOString(),
    },
  });

  console.log('📊 Analytics: App improvement tracked');
};

/**
 * Track: Evento personalizado
 * @param {string} userId - ID del usuario
 * @param {string} eventName - Nombre del evento
 * @param {Object} properties - Propiedades del evento
 */
export const trackCustomEvent = (userId, eventName, properties = {}) => {
  if (!isEnabled()) return;

  posthog.capture({
    distinctId: userId,
    event: eventName,
    properties: {
      ...properties,
      timestamp: new Date().toISOString(),
    },
  });

  console.log(`📊 Analytics: ${eventName} tracked`);
};

/**
 * Identificar usuario con propiedades
 * @param {string} userId - ID del usuario
 * @param {Object} properties - Propiedades del usuario
 */
export const identifyUser = (userId, properties) => {
  if (!isEnabled()) return;

  posthog.identify({
    distinctId: userId,
    properties,
  });

  console.log('📊 Analytics: User identified');
};

/**
 * Capturar feature flag
 * @param {string} userId - ID del usuario
 * @param {string} flagKey - Key del feature flag
 * @returns {Promise<boolean>}
 */
export const isFeatureEnabled = async (userId, flagKey) => {
  if (!isEnabled()) return false;

  try {
    const enabled = await posthog.isFeatureEnabled(flagKey, userId);
    return enabled;
  } catch (error) {
    console.error('❌ Error checking feature flag:', error);
    return false;
  }
};

/**
 * Cerrar conexión de PostHog (llamar al apagar servidor)
 */
export const shutdownPostHog = async () => {
  if (posthog) {
    await posthog.shutdown();
    console.log('✅ PostHog shut down');
  }
};

export default {
  initPostHog,
  trackAppCreated,
  trackAppDeployed,
  trackError,
  trackPlanUpgrade,
  trackUserSignup,
  trackUserLogin,
  trackAppImprovement,
  trackCustomEvent,
  identifyUser,
  isFeatureEnabled,
  shutdownPostHog,
};
