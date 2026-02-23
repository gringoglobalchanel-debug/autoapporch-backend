/**
 * Middleware de manejo de errores global
 */

/**
 * Clase de error personalizada
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware principal de manejo de errores
 */
export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  // Log del error
  console.error('❌ Error:', {
    message: error.message,
    statusCode: error.statusCode,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });

  // Error de Mongoose CastError (ID inválido)
  if (err.name === 'CastError') {
    error = new AppError('Resource not found', 404);
  }

  // Error de duplicado en PostgreSQL
  if (err.code === '23505') {
    error = new AppError('Duplicate field value entered', 400);
  }

  // Error de validación
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400);
  }

  // Error de JWT
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401);
  }

  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401);
  }

  // Responder con el error
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && {
      error: error,
      stack: error.stack
    })
  });
};

/**
 * Middleware para rutas no encontradas
 */
export const notFound = (req, res, next) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

/**
 * Wrapper para funciones async
 * Captura errores automáticamente
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default {
  errorHandler,
  notFound,
  asyncHandler,
  AppError
};
