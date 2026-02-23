/**
 * Middleware de Rate Limiting
 * Previene abuso de la API
 */

const rateLimitStore = new Map();

/**
 * Rate limiter simple basado en memoria
 * En producción, usar Redis para almacenamiento distribuido
 */
export const rateLimiter = (req, res, next) => {
  // Identificador único (IP o user ID)
  const identifier = req.user?.id || req.ip;
  
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutos
  const maxRequests = 100; // Máximo de requests por ventana

  // Obtener o crear registro de rate limit
  if (!rateLimitStore.has(identifier)) {
    rateLimitStore.set(identifier, {
      count: 0,
      resetTime: now + windowMs
    });
  }

  const record = rateLimitStore.get(identifier);

  // Reset si la ventana expiró
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }

  // Incrementar contador
  record.count++;

  // Headers de rate limit
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
  res.setHeader('X-RateLimit-Reset', new Date(record.resetTime).toISOString());

  // Verificar si excedió el límite
  if (record.count > maxRequests) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }

  next();
};

/**
 * Rate limiter específico para generación de apps
 * Más restrictivo para operaciones costosas
 */
export const generationRateLimiter = (req, res, next) => {
  const identifier = req.user?.id || req.ip;
  const key = `generation:${identifier}`;
  
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hora
  const maxRequests = 10; // Máximo 10 generaciones por hora

  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, {
      count: 0,
      resetTime: now + windowMs
    });
  }

  const record = rateLimitStore.get(key);

  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + windowMs;
  }

  record.count++;

  res.setHeader('X-Generation-RateLimit-Limit', maxRequests);
  res.setHeader('X-Generation-RateLimit-Remaining', Math.max(0, maxRequests - record.count));

  if (record.count > maxRequests) {
    return res.status(429).json({
      success: false,
      message: 'Generation limit exceeded. Please upgrade your plan or wait.',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }

  next();
};

/**
 * Limpiar registros antiguos periódicamente
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime + 60000) { // 1 minuto después del reset
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000); // Cada 5 minutos

export default {
  rateLimiter,
  generationRateLimiter
};
