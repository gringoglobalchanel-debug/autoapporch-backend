/**
 * Configuración y pool de conexión a PostgreSQL
 * Con reconexión automática y sin process.exit en errores de DB
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Crear pool de conexiones
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? {
    rejectUnauthorized: false
  } : false,
  max: 10,                          // Reducido de 20 — más estable en Railway
  min: 2,                           // Mantener mínimo 2 conexiones vivas
  idleTimeoutMillis: 60000,         // 60s antes de cerrar conexión idle
  connectionTimeoutMillis: 10000,   // 10s timeout (era 2s — muy poco)
  acquireTimeoutMillis: 30000,      // 30s para obtener conexión del pool
  allowExitOnIdle: false,           // No cerrar el proceso cuando el pool esté idle
});

// ✅ CRÍTICO: NO hacer process.exit() — solo loguear el error
pool.on('error', (err, client) => {
  console.error('⚠️ DB pool error (conexión idle):', err.message);
  // El pool se recupera automáticamente — no necesitamos hacer nada
});

pool.on('connect', (client) => {
  console.log('✅ Nueva conexión DB establecida');
});

pool.on('remove', (client) => {
  console.log('🔌 Conexión DB removida del pool');
});

/**
 * Ejecutar query SQL con reintentos automáticos
 */
export const query = async (text, params, retries = 3) => {
  const start = Date.now();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;

      if (process.env.NODE_ENV !== 'production') {
        console.log('📊 Query executed', { duration: `${duration}ms`, rows: res.rowCount });
      }

      return res;
    } catch (error) {
      const isRetryable = 
        error.message?.includes('Connection terminated') ||
        error.message?.includes('timeout') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('connection refused') ||
        error.code === 'ECONNRESET' ||
        error.code === '57P01'; // admin shutdown

      if (isRetryable && attempt < retries) {
        const waitMs = attempt * 1000; // 1s, 2s, 3s
        console.warn(`⚠️ DB query failed (intento ${attempt}/${retries}), reintentando en ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      console.error('❌ Database query error:', error.message);
      throw error;
    }
  }
};

/**
 * Obtener un cliente del pool para transacciones
 */
export const getClient = async () => {
  const client = await pool.connect();

  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);

  // Timeout para liberar el cliente si se olvida
  const timeout = setTimeout(() => {
    console.error('❌ Client checkout timeout — liberando forzosamente');
    try { originalRelease(); } catch (e) {}
  }, 30000); // 30s (era 5s — muy poco para queries lentas)

  client.query = (...args) => originalQuery(...args);

  client.release = () => {
    clearTimeout(timeout);
    client.query = originalQuery;
    client.release = originalRelease;
    return originalRelease();
  };

  return client;
};

/**
 * Ejecutar múltiples queries en una transacción
 */
export const transaction = async (callback) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Verificar conexión a la base de datos
 */
export const checkConnection = async () => {
  try {
    await pool.query('SELECT NOW()');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

export default {
  query,
  getClient,
  transaction,
  checkConnection,
  pool
};