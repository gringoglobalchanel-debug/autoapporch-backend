/**
 * Rutas de integración con Google APIs
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { googleService } from '../services/googleService.js';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/google/apis
 * Listar APIs disponibles y su estado
 */
router.get('/apis', authenticate, asyncHandler(async (req, res) => {
  const userApis = await googleService.getUserAuthorizedApis(req.user.id);
  
  const apis = [
    { id: 'maps', name: 'Google Maps', icon: '🗺️', description: 'Mapas, geolocalización, rutas' },
    { id: 'drive', name: 'Google Drive', icon: '📁', description: 'Almacenamiento y gestión de archivos' },
    { id: 'calendar', name: 'Google Calendar', icon: '📅', description: 'Eventos, recordatorios, agendas' },
    { id: 'gmail', name: 'Gmail', icon: '📧', description: 'Envío y gestión de correos' },
    { id: 'sheets', name: 'Google Sheets', icon: '📊', description: 'Hojas de cálculo' },
    { id: 'docs', name: 'Google Docs', icon: '📝', description: 'Documentos de texto' },
    { id: 'youtube', name: 'YouTube', icon: '🎥', description: 'Videos, canales, playlists' },
    { id: 'analytics', name: 'Google Analytics', icon: '📈', description: 'Estadísticas y métricas' },
    { id: 'translate', name: 'Google Translate', icon: '🌐', description: 'Traducción automática' },
    { id: 'vision', name: 'Google Vision', icon: '👁️', description: 'Reconocimiento de imágenes' }
  ];

  const apisWithStatus = apis.map(api => ({
    ...api,
    authorized: userApis.includes(api.id)
  }));

  res.json({
    success: true,
    apis: apisWithStatus
  });
}));

/**
 * GET /api/google/auth/:apiName
 * Iniciar autenticación con Google API
 */
router.get('/auth/:apiName', authenticate, asyncHandler(async (req, res) => {
  const { apiName } = req.params;
  
  await googleService.initializeClient(req.user.id, apiName);
  const authUrl = googleService.getAuthUrl(req.user.id, apiName);
  
  res.json({
    success: true,
    authUrl
  });
}));

/**
 * GET /api/google/callback
 * Callback OAuth de Google
 */
router.get('/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  
  await googleService.handleCallback(code, state);
  
  // Redirigir al frontend
  res.redirect(`${process.env.FRONTEND_URL}/dashboard?google=success`);
}));

/**
 * POST /api/google/revoke/:apiName
 * Revocar autorización de una API
 */
router.post('/revoke/:apiName', authenticate, asyncHandler(async (req, res) => {
  const { apiName } = req.params;
  
  await googleService.revokeApi(req.user.id, apiName);
  
  res.json({
    success: true,
    message: `API ${apiName} revocada`
  });
}));

/**
 * GET /api/google/files/:appId
 * Obtener archivos de Google Drive para una app
 */
router.get('/files/:appId', authenticate, asyncHandler(async (req, res) => {
  const { appId } = req.params;
  
  const drive = await googleService.getDriveService(req.user.id);
  
  const response = await drive.files.list({
    q: `'${appId}' in parents`,
    fields: 'files(id, name, mimeType, size, createdTime)'
  });
  
  res.json({
    success: true,
    files: response.data.files
  });
}));

export default router;