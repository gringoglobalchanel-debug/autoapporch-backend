/**
 * Servicio de Storage con Supabase Storage
 * Manejo de archivos generados y assets
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET_NAME = 'app-files';

/**
 * Inicializar bucket de storage
 */
export const initStorage = async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    
    const bucketExists = buckets?.some((b) => b.name === BUCKET_NAME);

    if (!bucketExists) {
      const { data, error } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: false,
        fileSizeLimit: 52428800, // 50MB
        allowedMimeTypes: [
          'text/plain',
          'application/json',
          'application/javascript',
          'text/html',
          'text/css',
          'image/png',
          'image/jpeg',
          'application/pdf',
        ],
      });

      if (error) throw error;
      console.log('✅ Storage bucket created:', BUCKET_NAME);
    } else {
      console.log('✅ Storage bucket exists:', BUCKET_NAME);
    }
  } catch (error) {
    console.error('❌ Error initializing storage:', error);
  }
};

/**
 * Subir archivo generado
 * @param {string} appId - ID de la app
 * @param {string} fileName - Nombre del archivo
 * @param {Buffer|string} content - Contenido del archivo
 * @param {string} contentType - Tipo de contenido
 * @returns {Promise<Object>}
 */
export const uploadAppFile = async (appId, fileName, content, contentType = 'text/plain') => {
  try {
    const filePath = `apps/${appId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, content, {
        contentType,
        upsert: true,
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    console.log('✅ File uploaded:', filePath);

    return {
      success: true,
      path: data.path,
      url: urlData.publicUrl,
    };
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Subir múltiples archivos de una app
 * @param {string} appId - ID de la app
 * @param {Array} files - Array de {name, content, type}
 * @returns {Promise<Object>}
 */
export const uploadAppFiles = async (appId, files) => {
  try {
    const results = [];

    for (const file of files) {
      const result = await uploadAppFile(
        appId,
        file.name,
        file.content,
        file.type || 'text/plain'
      );
      results.push(result);
    }

    const allSuccess = results.every((r) => r.success);

    return {
      success: allSuccess,
      files: results,
    };
  } catch (error) {
    console.error('❌ Error uploading multiple files:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Descargar archivo
 * @param {string} appId - ID de la app
 * @param {string} fileName - Nombre del archivo
 * @returns {Promise<Object>}
 */
export const downloadAppFile = async (appId, fileName) => {
  try {
    const filePath = `apps/${appId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(filePath);

    if (error) throw error;

    const content = await data.text();

    console.log('✅ File downloaded:', filePath);

    return {
      success: true,
      content,
    };
  } catch (error) {
    console.error('❌ Error downloading file:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Listar archivos de una app
 * @param {string} appId - ID de la app
 * @returns {Promise<Object>}
 */
export const listAppFiles = async (appId) => {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(`apps/${appId}`);

    if (error) throw error;

    console.log(`✅ Listed ${data.length} files for app ${appId}`);

    return {
      success: true,
      files: data,
    };
  } catch (error) {
    console.error('❌ Error listing files:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Eliminar archivo
 * @param {string} appId - ID de la app
 * @param {string} fileName - Nombre del archivo
 * @returns {Promise<Object>}
 */
export const deleteAppFile = async (appId, fileName) => {
  try {
    const filePath = `apps/${appId}/${fileName}`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) throw error;

    console.log('✅ File deleted:', filePath);

    return {
      success: true,
    };
  } catch (error) {
    console.error('❌ Error deleting file:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Eliminar todos los archivos de una app
 * @param {string} appId - ID de la app
 * @returns {Promise<Object>}
 */
export const deleteAllAppFiles = async (appId) => {
  try {
    const { data: files } = await listAppFiles(appId);

    if (files && files.length > 0) {
      const filePaths = files.map((f) => `apps/${appId}/${f.name}`);

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(filePaths);

      if (error) throw error;

      console.log(`✅ Deleted ${filePaths.length} files for app ${appId}`);
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error('❌ Error deleting app files:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Obtener URL firmada temporal
 * @param {string} appId - ID de la app
 * @param {string} fileName - Nombre del archivo
 * @param {number} expiresIn - Segundos hasta expiración (default: 1 hora)
 * @returns {Promise<Object>}
 */
export const getSignedUrl = async (appId, fileName, expiresIn = 3600) => {
  try {
    const filePath = `apps/${appId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, expiresIn);

    if (error) throw error;

    console.log('✅ Signed URL created:', filePath);

    return {
      success: true,
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  } catch (error) {
    console.error('❌ Error creating signed URL:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Subir imagen de preview de app
 * @param {string} appId - ID de la app
 * @param {Buffer} imageBuffer - Buffer de la imagen
 * @returns {Promise<Object>}
 */
export const uploadAppPreviewImage = async (appId, imageBuffer) => {
  try {
    const fileName = 'preview.png';
    const result = await uploadAppFile(appId, fileName, imageBuffer, 'image/png');

    if (result.success) {
      // Actualizar URL en la base de datos
      const { query } = await import('../config/database.js');
      await query(
        'UPDATE apps SET preview_image_url = $1 WHERE id = $2',
        [result.url, appId]
      );
    }

    return result;
  } catch (error) {
    console.error('❌ Error uploading preview image:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Guardar código completo de app como ZIP
 * @param {string} appId - ID de la app
 * @param {Object} appCode - Código de la app
 * @returns {Promise<Object>}
 */
export const saveAppAsZip = async (appId, appCode) => {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Agregar archivos al ZIP
    if (appCode.frontend?.files) {
      appCode.frontend.files.forEach((file) => {
        zip.file(file.path, file.content);
      });
    }

    if (appCode.backend?.files) {
      appCode.backend.files.forEach((file) => {
        zip.file(file.path, file.content);
      });
    }

    // Generar ZIP
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Subir ZIP
    const result = await uploadAppFile(
      appId,
      'app-code.zip',
      zipBuffer,
      'application/zip'
    );

    return result;
  } catch (error) {
    console.error('❌ Error saving app as ZIP:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

export default {
  initStorage,
  uploadAppFile,
  uploadAppFiles,
  downloadAppFile,
  listAppFiles,
  deleteAppFile,
  deleteAllAppFiles,
  getSignedUrl,
  uploadAppPreviewImage,
  saveAppAsZip,
};
