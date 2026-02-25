/**
 * AutoAppOrchestrator Backend
 * Servidor principal Express.js
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Importar configuración
import * as sentry from './config/sentry.js';
import * as storageService from './services/storageService.js';
import * as analyticsService from './services/analyticsService.js';
import * as jobService from './services/jobService.js';

// Importar rutas
import authRoutes from './routes/auth.js';
import appsRoutes from './routes/apps.js';
import stripeRoutes from './routes/stripe.js';
import userRoutes from './routes/users.js';
import deployRoutes from './routes/deploy.js';
import domainRoutes from './routes/domains.js';
import chatRoutes from './routes/chat.js';
import googleRoutes from './routes/google.js';
import uploadRoutes from './routes/upload.js';
import stripeConnectRouter from './routes/stripeConnect.js';
import domainRegistrarRouter from './routes/domainRegistrar.js';
import improvementsRouter from './routes/improvements.js';

// Importar middleware
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ============================================
// INICIALIZACIÓN DE SERVICIOS
// ============================================

sentry.initSentry(app);
analyticsService.initPostHog();
storageService.initStorage();
jobService.startJobProcessor();

// ============================================
// MIDDLEWARE
// ============================================

app.use(sentry.sentryRequestHandler());
app.use(sentry.sentryTracingHandler());
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'https://autoapporchestrator.com',
      'https://www.autoapporchestrator.com',
      'http://localhost:3000'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// IMPORTANTE: Webhook de Stripe necesita RAW
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

app.use(rateLimiter);

// ============================================
// RUTAS
// ============================================

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    services: {
      database: 'connected',
      sentry: process.env.SENTRY_DSN ? 'enabled' : 'disabled',
      analytics: process.env.POSTHOG_API_KEY ? 'enabled' : 'disabled',
      email: process.env.RESEND_API_KEY ? 'enabled' : 'disabled',
      whatsapp: process.env.TWILIO_ACCOUNT_SID ? 'enabled' : 'disabled',
      maps: process.env.GOOGLE_MAPS_KEY ? 'enabled' : 'disabled',
      domains: 'enabled',
      deploy: process.env.VERCEL_TOKEN ? 'enabled' : 'disabled',
      google: process.env.GOOGLE_CLIENT_ID ? 'enabled' : 'disabled',
      upload: 'enabled',
      stripeConnect: process.env.STRIPE_SECRET_KEY ? 'enabled' : 'disabled',
      domainRegistrar: process.env.GODADDY_API_KEY ? 'enabled' : 'disabled',
      improvements: 'enabled'
    }
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/apps', appsRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/domains', domainRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stripe-connect', stripeConnectRouter);
app.use('/api/domain-registrar', domainRegistrarRouter);
app.use('/api/apps', improvementsRouter);

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ============================================
// MANEJO DE ERRORES
// ============================================

app.use(sentry.sentryErrorHandler());
app.use(errorHandler);

// ============================================
// INICIAR SERVIDOR
// ============================================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║   AutoAppOrchestrator Backend API     ║
╠════════════════════════════════════════╣
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(25)}║
║  Port: ${PORT.toString().padEnd(31)}║
║  API URL: http://localhost:${PORT.toString().padEnd(11)}║
╠════════════════════════════════════════╣
║  Services Status:                     ║
║  ${process.env.SENTRY_DSN ? '✅' : '⚠️'} Sentry Monitoring              ║
║  ${process.env.POSTHOG_API_KEY ? '✅' : '⚠️'} PostHog Analytics             ║
║  ${process.env.RESEND_API_KEY ? '✅' : '⚠️'} Resend Email                  ║
║  ${process.env.TWILIO_ACCOUNT_SID ? '✅' : '⚠️'} Twilio WhatsApp               ║
║  ${process.env.GOOGLE_MAPS_KEY ? '✅' : '⚠️'} Google Maps                   ║
║  ${process.env.VERCEL_TOKEN ? '✅' : '⚠️'} Vercel Auto Deploy            ║
║  ${process.env.GOOGLE_CLIENT_ID ? '✅' : '⚠️'} Google APIs                   ║
║  ${process.env.STRIPE_SECRET_KEY ? '✅' : '⚠️'} Stripe Connect                ║
║  ${process.env.GODADDY_API_KEY ? '✅' : '⚠️'} GoDaddy Domain Registrar      ║
║  ✅ File Upload                       ║
║  ✅ Custom Domains                    ║
║  ✅ Job Processor                     ║
║  ✅ Storage Service                   ║
║  ✅ App Improvements                  ║
╠════════════════════════════════════════╣
║  Endpoints:                           ║
║  ✅ /api/auth                         ║
║  ✅ /api/apps                         ║
║  ✅ /api/stripe                       ║
║  ✅ /api/users                        ║
║  ✅ /api/deploy                       ║
║  ✅ /api/domains                      ║
║  ✅ /api/chat                         ║
║  ✅ /api/google                       ║
║  ✅ /api/upload                       ║
║  ✅ /api/stripe-connect               ║
║  ✅ /api/domain-registrar             ║
║  ✅ /api/apps/:id/improvements        ║
╚════════════════════════════════════════╝
  `);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  server.close(() => { console.log('✅ HTTP server closed'); });
  jobService.stopJobProcessor();
  await analyticsService.shutdownPostHog();
  console.log('✅ Graceful shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  sentry.captureException(err);
  if (process.env.NODE_ENV === 'production') gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  sentry.captureException(err);
  gracefulShutdown('uncaughtException');
});

export default app;