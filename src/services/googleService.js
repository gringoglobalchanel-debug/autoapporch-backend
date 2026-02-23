/**
 * Servicio de integración con Google APIs
 */

import { google } from 'googleapis';
import { query } from '../config/database.js';
import { googleConfig } from '../config/google.config.js';

// Clientes OAuth por API
const oauth2Clients = new Map();

class GoogleService {
  /**
   * Inicializar cliente OAuth para un usuario
   */
  async initializeClient(userId, apiName) {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.API_URL}/api/google/callback`
    );

    oauth2Clients.set(`${userId}:${apiName}`, client);
    return client;
  }

  /**
   * Generar URL de autorización
   */
  getAuthUrl(userId, apiName) {
    const client = oauth2Clients.get(`${userId}:${apiName}`);
    const scopes = googleConfig.scopes[apiName] || [];
    
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: JSON.stringify({ userId, apiName })
    });
  }

  /**
   * Procesar callback OAuth
   */
  async handleCallback(code, state) {
    const { userId, apiName } = JSON.parse(state);
    const client = oauth2Clients.get(`${userId}:${apiName}`);
    
    const { tokens } = await client.getToken(code);
    
    // Guardar tokens en base de datos
    await query(
      `INSERT INTO google_tokens (user_id, api_name, access_token, refresh_token, expiry_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, api_name) 
       DO UPDATE SET access_token = $3, refresh_token = $4, expiry_date = $5`,
      [userId, apiName, tokens.access_token, tokens.refresh_token, tokens.expiry_date]
    );

    client.setCredentials(tokens);
    return { success: true, apiName };
  }

  /**
   * Obtener cliente autenticado para una API
   */
  async getAuthenticatedClient(userId, apiName) {
    const tokenData = await query(
      'SELECT * FROM google_tokens WHERE user_id = $1 AND api_name = $2',
      [userId, apiName]
    );

    if (tokenData.rows.length === 0) {
      throw new Error(`No autorizado para ${apiName}`);
    }

    const tokens = tokenData.rows[0];
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );

    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    });

    // Refrescar token si es necesario
    if (tokens.expiry_date < Date.now()) {
      const { credentials } = await client.refreshAccessToken();
      await query(
        `UPDATE google_tokens 
         SET access_token = $1, expiry_date = $2 
         WHERE user_id = $3 AND api_name = $4`,
        [credentials.access_token, credentials.expiry_date, userId, apiName]
      );
      client.setCredentials(credentials);
    }

    return client;
  }

  /**
   * Crear servicio de Google Maps
   */
  async getMapsService(userId) {
    const client = await this.getAuthenticatedClient(userId, 'maps');
    return google.maps({ version: 'v3', auth: client });
  }

  /**
   * Crear servicio de Google Drive
   */
  async getDriveService(userId) {
    const client = await this.getAuthenticatedClient(userId, 'drive');
    return google.drive({ version: 'v3', auth: client });
  }

  /**
   * Crear servicio de Google Calendar
   */
  async getCalendarService(userId) {
    const client = await this.getAuthenticatedClient(userId, 'calendar');
    return google.calendar({ version: 'v3', auth: client });
  }

  /**
   * Crear servicio de Gmail
   */
  async getGmailService(userId) {
    const client = await this.getAuthenticatedClient(userId, 'gmail');
    return google.gmail({ version: 'v1', auth: client });
  }

  /**
   * Crear servicio de Google Sheets
   */
  async getSheetsService(userId) {
    const client = await this.getAuthenticatedClient(userId, 'sheets');
    return google.sheets({ version: 'v4', auth: client });
  }

  /**
   * Verificar qué APIs tiene autorizadas el usuario
   */
  async getUserAuthorizedApis(userId) {
    const result = await query(
      'SELECT api_name FROM google_tokens WHERE user_id = $1',
      [userId]
    );
    return result.rows.map(row => row.api_name);
  }

  /**
   * Revocar autorización de una API
   */
  async revokeApi(userId, apiName) {
    await query(
      'DELETE FROM google_tokens WHERE user_id = $1 AND api_name = $2',
      [userId, apiName]
    );
    return { success: true };
  }
}

// Exportar una instancia única
export const googleService = new GoogleService();