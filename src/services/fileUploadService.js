/**
 * Servicio de subida de archivos con naming inteligente
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { googleConfig } from '../config/google.config.js';
import { googleService } from './googleService.js';

// Configuración de Multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', req.user.id);
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = randomUUID();
    cb(null, `${uniqueId}-${file.originalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allAllowedTypes = [
    ...googleConfig.fileUpload.allowedTypes.images,
    ...googleConfig.fileUpload.allowedTypes.documents,
    ...googleConfig.fileUpload.allowedTypes.data,
    ...googleConfig.fileUpload.allowedTypes.audio,
    ...googleConfig.fileUpload.allowedTypes.video
  ];

  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido'), false);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: googleConfig.fileUpload.maxSize
  }
});

export const fileUploadService = {
  /**
   * Validar nombre de archivo según especificaciones de Claude
   */
  validateFilename(filename, expectedPattern) {
    if (!expectedPattern) return true;
    
    // Convertir patrón a regex
    const pattern = expectedPattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[!\(\)]/g, '\\$&');
    
    const regex = new RegExp(`^${pattern}$`, 'i');
    return regex.test(filename);
  },

  /**
   * Procesar archivo subido
   */
  async processFile(file, appId, userId, fileSpec) {
    const fileData = {
      id: randomUUID(),
      appId,
      userId,
      originalName: file.originalname,
      fileName: file.filename,
      path: file.path,
      size: file.size,
      mimeType: file.mimetype,
      category: this.getFileCategory(file.mimetype),
      uploadedAt: new Date(),
      spec: fileSpec
    };

    // Validar nombre según especificación
    if (fileSpec?.expectedPattern) {
      const isValid = this.validateFilename(
        file.originalname, 
        fileSpec.expectedPattern
      );
      
      if (!isValid) {
        await fs.unlink(file.path);
        throw new Error(`El nombre del archivo debe seguir el patrón: ${fileSpec.expectedPattern}`);
      }
    }

    // Guardar en base de datos
    await query(
      `INSERT INTO app_files (id, app_id, user_id, file_name, original_name, path, size, mime_type, category, file_spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        fileData.id,
        appId,
        userId,
        fileData.fileName,
        fileData.originalName,
        fileData.path,
        fileData.size,
        fileData.mimeType,
        fileData.category,
        JSON.stringify(fileSpec)
      ]
    );

    // Si es imagen y se requiere, subir a Google Drive
    if (fileSpec?.uploadToDrive) {
      await this.uploadToGoogleDrive(fileData, userId);
    }

    return fileData;
  },

  /**
   * Categorizar archivo por tipo MIME
   */
  getFileCategory(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('document')) return 'document';
    if (mimeType.includes('sheet')) return 'spreadsheet';
    if (mimeType.includes('json') || mimeType.includes('csv')) return 'data';
    return 'other';
  },

  /**
   * Subir archivo a Google Drive
   */
  async uploadToGoogleDrive(fileData, userId) {
    try {
      const drive = await googleService.getDriveService(userId);
      
      const response = await drive.files.create({
        requestBody: {
          name: fileData.originalName,
          mimeType: fileData.mimeType,
          parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
        },
        media: {
          mimeType: fileData.mimeType,
          body: fs.createReadStream(fileData.path)
        }
      });

      // Guardar referencia de Drive
      await query(
        `UPDATE app_files SET google_drive_id = $1 WHERE id = $2`,
        [response.data.id, fileData.id]
      );

      return response.data;
    } catch (error) {
      console.error('Error uploading to Drive:', error);
      throw error;
    }
  },

  /**
   * Obtener archivos de una app
   */
  async getAppFiles(appId) {
    const result = await query(
      'SELECT * FROM app_files WHERE app_id = $1 ORDER BY uploaded_at DESC',
      [appId]
    );
    return result.rows;
  },

  /**
   * Eliminar archivo
   */
  async deleteFile(fileId, userId) {
    const file = await query(
      'SELECT * FROM app_files WHERE id = $1 AND user_id = $2',
      [fileId, userId]
    );

    if (file.rows.length === 0) {
      throw new Error('Archivo no encontrado');
    }

    // Eliminar archivo físico
    await fs.unlink(file.rows[0].path);

    // Eliminar de Google Drive si existe
    if (file.rows[0].google_drive_id) {
      try {
        const drive = await googleService.getDriveService(userId);
        await drive.files.delete({ fileId: file.rows[0].google_drive_id });
      } catch (error) {
        console.error('Error deleting from Drive:', error);
      }
    }

    // Eliminar de base de datos
    await query('DELETE FROM app_files WHERE id = $1', [fileId]);

    return { success: true };
  }
};