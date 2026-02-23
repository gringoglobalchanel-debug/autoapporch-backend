/**
 * Sistema de Jobs y Tareas Programadas
 * Maneja trabajos en background y reintentos automáticos
 */

import { query } from '../config/database.js';
import * as emailService from './emailService.js';
import * as whatsappService from './whatsappService.js';
import * as analyticsService from './analyticsService.js';

// Cola de jobs en memoria (en producción usar Redis + Bull)
const jobQueue = [];
const processingJobs = new Set();
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 segundos

/**
 * Tipos de jobs disponibles
 */
export const JOB_TYPES = {
  SEND_EMAIL: 'send_email',
  SEND_WHATSAPP: 'send_whatsapp',
  TRACK_EVENT: 'track_event',
  CLEANUP_OLD_DATA: 'cleanup_old_data',
  GENERATE_REPORT: 'generate_report',
  BACKUP_DATABASE: 'backup_database',
};

/**
 * Añadir job a la cola
 * @param {string} type - Tipo de job
 * @param {Object} data - Datos del job
 * @param {Object} options - Opciones (delay, priority, maxRetries)
 */
export const addJob = async (type, data, options = {}) => {
  const job = {
    id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    data,
    status: 'pending',
    attempts: 0,
    maxRetries: options.maxRetries || MAX_RETRIES,
    priority: options.priority || 0,
    delay: options.delay || 0,
    createdAt: new Date(),
    scheduledFor: options.delay ? new Date(Date.now() + options.delay) : new Date(),
  };

  // Guardar en base de datos para persistencia
  await query(
    `INSERT INTO jobs (id, type, data, status, max_retries, priority, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      job.id,
      job.type,
      JSON.stringify(job.data),
      job.status,
      job.maxRetries,
      job.priority,
      job.scheduledFor,
    ]
  );

  jobQueue.push(job);
  jobQueue.sort((a, b) => b.priority - a.priority);

  console.log(`📋 Job added to queue: ${job.id} (${type})`);

  return job;
};

/**
 * Procesar job
 * @param {Object} job - Job a procesar
 */
const processJob = async (job) => {
  if (processingJobs.has(job.id)) {
    return;
  }

  processingJobs.add(job.id);

  try {
    console.log(`⚙️ Processing job: ${job.id} (${job.type})`);

    // Actualizar estado
    await query(
      `UPDATE jobs SET status = $1, started_at = NOW() WHERE id = $2`,
      ['processing', job.id]
    );

    // Ejecutar según tipo
    let result;
    switch (job.type) {
      case JOB_TYPES.SEND_EMAIL:
        result = await handleEmailJob(job.data);
        break;

      case JOB_TYPES.SEND_WHATSAPP:
        result = await handleWhatsAppJob(job.data);
        break;

      case JOB_TYPES.TRACK_EVENT:
        result = await handleTrackEventJob(job.data);
        break;

      case JOB_TYPES.CLEANUP_OLD_DATA:
        result = await handleCleanupJob(job.data);
        break;

      case JOB_TYPES.GENERATE_REPORT:
        result = await handleReportJob(job.data);
        break;

      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    if (result.success) {
      // Marcar como completado
      await query(
        `UPDATE jobs 
         SET status = $1, completed_at = NOW(), result = $2
         WHERE id = $3`,
        ['completed', JSON.stringify(result), job.id]
      );

      console.log(`✅ Job completed: ${job.id}`);
    } else {
      throw new Error(result.error || 'Job failed');
    }
  } catch (error) {
    console.error(`❌ Job failed: ${job.id}`, error);

    job.attempts++;

    if (job.attempts >= job.maxRetries) {
      // Marcar como fallido permanentemente
      await query(
        `UPDATE jobs 
         SET status = $1, failed_at = NOW(), error = $2
         WHERE id = $3`,
        ['failed', error.message, job.id]
      );

      console.error(`❌ Job permanently failed after ${job.attempts} attempts: ${job.id}`);
    } else {
      // Reintentar
      await query(
        `UPDATE jobs 
         SET status = $1, attempts = $2, scheduled_for = NOW() + INTERVAL '${RETRY_DELAY} milliseconds'
         WHERE id = $3`,
        ['pending', job.attempts, job.id]
      );

      console.log(`🔄 Job will be retried (attempt ${job.attempts}/${job.maxRetries}): ${job.id}`);

      // Re-añadir a la cola con delay
      setTimeout(() => {
        jobQueue.push(job);
      }, RETRY_DELAY);
    }
  } finally {
    processingJobs.delete(job.id);
  }
};

/**
 * Handlers para cada tipo de job
 */
async function handleEmailJob(data) {
  const { type, ...emailData } = data;

  switch (type) {
    case 'welcome':
      return await emailService.sendWelcomeEmail(
        emailData.email,
        emailData.fullName,
        emailData.userId
      );

    case 'app_ready':
      return await emailService.sendAppReadyEmail(
        emailData.email,
        emailData.appName,
        emailData.appId
      );

    case 'error':
      return await emailService.sendErrorEmail(
        emailData.email,
        emailData.appName,
        emailData.errorMessage,
        emailData.appId
      );

    case 'billing':
      return await emailService.sendBillingEmail(
        emailData.email,
        emailData.billingType,
        emailData.details
      );

    default:
      throw new Error(`Unknown email type: ${type}`);
  }
}

async function handleWhatsAppJob(data) {
  const { type, phone, ...whatsappData } = data;

  switch (type) {
    case 'app_ready':
      return await whatsappService.notifyAppReady(
        phone,
        whatsappData.appName,
        whatsappData.appId
      );

    case 'payment_failed':
      return await whatsappService.notifyPaymentFailed(
        phone,
        whatsappData.amount,
        whatsappData.reason
      );

    case 'critical_error':
      return await whatsappService.notifyCriticalError(
        phone,
        whatsappData.appName,
        whatsappData.errorMessage
      );

    default:
      throw new Error(`Unknown WhatsApp type: ${type}`);
  }
}

async function handleTrackEventJob(data) {
  const { eventType, userId, ...eventData } = data;

  switch (eventType) {
    case 'app_created':
      analyticsService.trackAppCreated(userId, eventData);
      break;

    case 'app_deployed':
      analyticsService.trackAppDeployed(userId, eventData);
      break;

    case 'error':
      analyticsService.trackError(userId, eventData);
      break;

    case 'plan_upgrade':
      analyticsService.trackPlanUpgrade(userId, eventData);
      break;

    default:
      analyticsService.trackCustomEvent(userId, eventType, eventData);
  }

  return { success: true };
}

async function handleCleanupJob(data) {
  const { daysOld = 90 } = data;

  // Limpiar logs antiguos
  const result = await query(
    `DELETE FROM logs 
     WHERE created_at < NOW() - INTERVAL '${daysOld} days'
     RETURNING id`
  );

  console.log(`🧹 Cleaned up ${result.rowCount} old logs`);

  return { success: true, deletedCount: result.rowCount };
}

async function handleReportJob(data) {
  const { reportType, userId } = data;

  // Generar reporte según tipo
  console.log(`📊 Generating ${reportType} report for user ${userId}`);

  return { success: true, reportUrl: 'https://example.com/report.pdf' };
}

/**
 * Procesar cola de jobs
 */
const processQueue = async () => {
  const now = new Date();

  // Obtener jobs pendientes de la base de datos
  const result = await query(
    `SELECT * FROM jobs 
     WHERE status = 'pending' 
     AND scheduled_for <= $1
     ORDER BY priority DESC, created_at ASC
     LIMIT 10`,
    [now]
  );

  for (const dbJob of result.rows) {
    const job = {
      id: dbJob.id,
      type: dbJob.type,
      data: dbJob.data,
      status: dbJob.status,
      attempts: dbJob.attempts || 0,
      maxRetries: dbJob.max_retries,
      priority: dbJob.priority,
      scheduledFor: dbJob.scheduled_for,
    };

    await processJob(job);
  }

  // Procesar jobs en memoria
  while (jobQueue.length > 0) {
    const job = jobQueue.shift();

    if (new Date(job.scheduledFor) > now) {
      jobQueue.unshift(job);
      break;
    }

    await processJob(job);
  }
};

/**
 * Iniciar procesamiento de jobs
 */
let jobInterval;
export const startJobProcessor = () => {
  if (jobInterval) {
    console.log('⚠️ Job processor already running');
    return;
  }

  console.log('✅ Starting job processor...');

  // Procesar cada 5 segundos
  jobInterval = setInterval(processQueue, 5000);

  // Procesar inmediatamente
  processQueue();
};

/**
 * Detener procesamiento de jobs
 */
export const stopJobProcessor = () => {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    console.log('✅ Job processor stopped');
  }
};

/**
 * Obtener estadísticas de jobs
 */
export const getJobStats = async () => {
  const stats = await query(
    `SELECT 
       status,
       COUNT(*) as count
     FROM jobs
     GROUP BY status`
  );

  return {
    queueLength: jobQueue.length,
    processing: processingJobs.size,
    stats: stats.rows.reduce((acc, row) => {
      acc[row.status] = parseInt(row.count);
      return acc;
    }, {}),
  };
};

/**
 * Limpiar jobs completados antiguos
 */
export const cleanupCompletedJobs = async (daysOld = 7) => {
  const result = await query(
    `DELETE FROM jobs 
     WHERE status = 'completed' 
     AND completed_at < NOW() - INTERVAL '${daysOld} days'
     RETURNING id`
  );

  console.log(`🧹 Cleaned up ${result.rowCount} completed jobs`);

  return result.rowCount;
};

export default {
  addJob,
  startJobProcessor,
  stopJobProcessor,
  getJobStats,
  cleanupCompletedJobs,
  JOB_TYPES,
};
