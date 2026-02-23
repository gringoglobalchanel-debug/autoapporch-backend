/**
 * Configuración y pool de conexión a PostgreSQL
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
  max: 20, // Máximo de conexiones
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Evento de error
pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Evento de conexión
pool.on('connect', () => {
  console.log('✅ Database connected successfully');
});

/**
 * Ejecutar query SQL
 * @param {string} text - Query SQL
 * @param {Array} params - Parámetros de la query
 * @returns {Promise} - Resultado de la query
 */
export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('📊 Query executed', { text, duration, rows: res.rowCount });
    }
    
    return res;
  } catch (error) {
    console.error('❌ Database query error:', error);
    throw error;
  }
};

/**
 * Obtener un cliente del pool para transacciones
 * @returns {Promise} - Cliente de PostgreSQL
 */
export const getClient = async () => {
  const client = await pool.connect();
  
  // Wrapper para queries
  const originalQuery = client.query;
  const originalRelease = client.release;
  
  // Timeout para liberar el cliente
  const timeout = setTimeout(() => {
    console.error('❌ Client checkout timeout');
    client.release();
  }, 5000);
  
  // Override del método query para logging
  client.query = (...args) => {
    return originalQuery.apply(client, args);
  };
  
  // Override del método release
  client.release = () => {
    clearTimeout(timeout);
    client.query = originalQuery;
    client.release = originalRelease;
    return originalRelease.apply(client);
  };
  
  return client;
};

/**
 * Ejecutar múltiples queries en una transacción
 * @param {Function} callback - Función con las queries
 * @returns {Promise} - Resultado de la transacción
 */
export const transaction = async (callback) => {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Verificar conexión a la base de datos
 * @returns {Promise<boolean>}
 */
export const checkConnection = async () => {
  try {
    await pool.query('SELECT NOW()');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
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
