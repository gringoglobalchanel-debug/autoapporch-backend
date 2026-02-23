/**
 * Configuración de Sentry para Backend
 * Monitoreo y tracking de errores
 */

import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Inicializar Sentry
 * @param {Express} app - Aplicación Express
 */
export const initSentry = (app) => {
  if (!process.env.SENTRY_DSN) {
    console.log('⚠️ Sentry not configured (SENTRY_DSN missing)');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
      new ProfilingIntegration(),
    ],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    beforeSend(event, hint) {
      // No enviar errores 404
      if (event.exception?.values?.[0]?.value?.includes('404')) {
        return null;
      }
      
      // Sanitizar datos sensibles
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      
      return event;
    },
  });

  console.log('✅ Sentry initialized');
};

/**
 * Middleware de request de Sentry
 */
export const sentryRequestHandler = () => {
  return Sentry.Handlers.requestHandler();
};

/**
 * Middleware de tracing de Sentry
 */
export const sentryTracingHandler = () => {
  return Sentry.Handlers.tracingHandler();
};

/**
 * Middleware de error de Sentry
 */
export const sentryErrorHandler = () => {
  return Sentry.Handlers.errorHandler();
};

/**
 * Capturar excepción manualmente
 * @param {Error} error - Error a capturar
 * @param {Object} context - Contexto adicional
 */
export const captureException = (error, context = {}) => {
  Sentry.captureException(error, {
    extra: context,
  });
};

/**
 * Capturar mensaje
 * @param {string} message - Mensaje a capturar
 * @param {string} level - Nivel: 'info', 'warning', 'error'
 * @param {Object} context - Contexto adicional
 */
export const captureMessage = (message, level = 'info', context = {}) => {
  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
};

/**
 * Configurar usuario en Sentry
 * @param {Object} user - Usuario
 */
export const setUser = (user) => {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.fullName,
  });
};

/**
 * Limpiar usuario
 */
export const clearUser = () => {
  Sentry.setUser(null);
};

/**
 * Añadir breadcrumb
 * @param {string} message - Mensaje
 * @param {string} category - Categoría
 * @param {Object} data - Datos adicionales
 */
export const addBreadcrumb = (message, category, data = {}) => {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
};

/**
 * Iniciar transacción
 * @param {string} name - Nombre de la transacción
 * @param {string} op - Operación
 * @returns {Transaction}
 */
export const startTransaction = (name, op = 'http.server') => {
  return Sentry.startTransaction({
    name,
    op,
  });
};

export default {
  initSentry,
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler,
  captureException,
  captureMessage,
  setUser,
  clearUser,
  addBreadcrumb,
  startTransaction,
};
