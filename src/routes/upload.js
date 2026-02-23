/**
 * Rutas de subida de archivos
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { upload, fileUploadService } from '../services/fileUploadService.js';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * POST /api/upload/:appId
 * Subir archivo para una app específica
 */
router.post('/:appId', 
  authenticate,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { appId } = req.params;
    const { fileSpec } = req.body;

    if (!req.file) {
      throw new AppError('No se subió ningún archivo', 400);
    }

    // Verificar límites del plan
    const planResult = await query(
      'SELECT plan FROM users WHERE id = $1',
      [req.user.id]
    );
    const plan = planResult.rows[0]?.plan || 'free';

    const filesResult = await query(
      'SELECT COUNT(*) as count FROM app_files WHERE app_id = $1',
      [appId]
    );
    const fileCount = parseInt(filesResult.rows[0].count);

    // Verificar límite según plan (esto lo implementaremos después)

    // Procesar archivo
    const fileData = await fileUploadService.processFile(
      req.file,
      appId,
      req.user.id,
      fileSpec ? JSON.parse(fileSpec) : null
    );

    res.json({
      success: true,
      message: 'Archivo subido correctamente',
      file: fileData
    });
  })
);

/**
 * GET /api/upload/:appId
 * Obtener todos los archivos de una app
 */
router.get('/:appId', authenticate, asyncHandler(async (req, res) => {
  const { appId } = req.params;
  
  const files = await fileUploadService.getAppFiles(appId);
  
  res.json({
    success: true,
    files
  });
}));

/**
 * DELETE /api/upload/:fileId
 * Eliminar un archivo
 */
router.delete('/:fileId', authenticate, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  await fileUploadService.deleteFile(fileId, req.user.id);
  
  res.json({
    success: true,
    message: 'Archivo eliminado'
  });
}));

/**
 * GET /api/upload/spec/:appId
 * Obtener especificaciones de archivos para una app (lo que Claude definió)
 */
router.get('/spec/:appId', authenticate, asyncHandler(async (req, res) => {
  const { appId } = req.params;
  
  const result = await query(
    'SELECT file_specs FROM apps WHERE id = $1 AND user_id = $2',
    [appId, req.user.id]
  );

  res.json({
    success: true,
    specs: result.rows[0]?.file_specs || []
  });
}));

export default router;