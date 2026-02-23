/**
 * Servicio de Deploy Automático
 * Despliega apps generadas a Vercel/Netlify
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { query } from '../config/database.js';

dotenv.config();

/**
 * Deploy a Vercel
 * @param {Object} appCode - Código de la app
 * @param {string} appName - Nombre de la app
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>}
 */
export const deployToVercel = async (appCode, appName, userId) => {
  if (!process.env.VERCEL_TOKEN) {
    console.log('⚠️ Vercel token not configured');
    return { success: false, error: 'Vercel not configured' };
  }

  try {
    const startTime = Date.now();

    // Preparar archivos para Vercel
    const files = prepareFilesForVercel(appCode);

    // Crear deployment
    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: appName.toLowerCase().replace(/\s+/g, '-'),
        files,
        projectSettings: {
          framework: 'nextjs',
          buildCommand: 'npm run build',
          devCommand: 'npm run dev',
          installCommand: 'npm install',
          outputDirectory: '.next',
        },
        target: 'production',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Vercel deployment failed');
    }

    // Esperar a que el deploy esté listo
    const deploymentUrl = await waitForDeployment(data.id);

    const duration = Date.now() - startTime;

    console.log(`✅ Deployed to Vercel in ${duration}ms:`, deploymentUrl);

    return {
      success: true,
      url: deploymentUrl,
      deploymentId: data.id,
      provider: 'vercel',
      duration,
    };
  } catch (error) {
    console.error('❌ Error deploying to Vercel:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Deploy a Netlify
 * @param {Object} appCode - Código de la app
 * @param {string} appName - Nombre de la app
 * @param {string} userId - ID del usuario
 * @returns {Promise<Object>}
 */
export const deployToNetlify = async (appCode, appName, userId) => {
  if (!process.env.NETLIFY_TOKEN) {
    console.log('⚠️ Netlify token not configured');
    return { success: false, error: 'Netlify not configured' };
  }

  try {
    const startTime = Date.now();

    // Crear site
    const siteResponse = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NETLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: appName.toLowerCase().replace(/\s+/g, '-'),
      }),
    });

    const siteData = await siteResponse.json();

    if (!siteResponse.ok) {
      throw new Error(siteData.message || 'Failed to create Netlify site');
    }

    // Preparar archivos
    const files = prepareFilesForNetlify(appCode);

    // Deploy archivos
    const deployResponse = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteData.id}/deploys`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.NETLIFY_TOKEN}`,
          'Content-Type': 'application/zip',
        },
        body: await createZipFromFiles(files),
      }
    );

    const deployData = await deployResponse.json();

    if (!deployResponse.ok) {
      throw new Error(deployData.message || 'Netlify deployment failed');
    }

    const duration = Date.now() - startTime;
    const deploymentUrl = `https://${siteData.name}.netlify.app`;

    console.log(`✅ Deployed to Netlify in ${duration}ms:`, deploymentUrl);

    return {
      success: true,
      url: deploymentUrl,
      deploymentId: deployData.id,
      provider: 'netlify',
      duration,
    };
  } catch (error) {
    console.error('❌ Error deploying to Netlify:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Deploy app automáticamente al provider preferido
 * @param {string} appId - ID de la app
 * @param {Object} appCode - Código de la app
 * @param {string} appName - Nombre de la app
 * @param {string} userId - ID del usuario
 * @param {string} provider - Provider: 'vercel' | 'netlify' | 'auto'
 */
export const deployApp = async (appId, appCode, appName, userId, provider = 'auto') => {
  try {
    // Determinar provider
    let selectedProvider = provider;
    if (provider === 'auto') {
      selectedProvider = process.env.VERCEL_TOKEN ? 'vercel' : 'netlify';
    }

    // Deploy según provider
    let result;
    if (selectedProvider === 'vercel') {
      result = await deployToVercel(appCode, appName, userId);
    } else if (selectedProvider === 'netlify') {
      result = await deployToNetlify(appCode, appName, userId);
    } else {
      throw new Error(`Unknown provider: ${selectedProvider}`);
    }

    if (!result.success) {
      throw new Error(result.error);
    }

    // Guardar URL de deployment en la base de datos
    await query(
      `UPDATE apps 
       SET deployment_url = $1, updated_at = NOW()
       WHERE id = $2`,
      [result.url, appId]
    );

    // Registrar log
    await query(
      `INSERT INTO logs (app_id, user_id, log_type, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        appId,
        userId,
        'info',
        'App deployed successfully',
        JSON.stringify({
          url: result.url,
          provider: result.provider,
          duration: result.duration,
        }),
      ]
    );

    return result;
  } catch (error) {
    console.error('❌ Error deploying app:', error);

    // Registrar error
    await query(
      `INSERT INTO logs (app_id, user_id, log_type, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [appId, userId, 'error', 'Deploy failed', JSON.stringify({ error: error.message })]
    );

    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Preparar archivos para Vercel
 * @private
 */
function prepareFilesForVercel(appCode) {
  const files = [];

  // Frontend files
  if (appCode.frontend?.files) {
    appCode.frontend.files.forEach((file) => {
      files.push({
        file: file.path,
        data: file.content,
      });
    });
  }

  // Backend files
  if (appCode.backend?.files) {
    appCode.backend.files.forEach((file) => {
      files.push({
        file: `api/${file.path}`,
        data: file.content,
      });
    });
  }

  // Package.json
  if (appCode.config?.['package.json']) {
    files.push({
      file: 'package.json',
      data: JSON.stringify(appCode.config['package.json'], null, 2),
    });
  }

  // Vercel.json
  files.push({
    file: 'vercel.json',
    data: JSON.stringify(
      {
        version: 2,
        builds: [{ src: 'package.json', use: '@vercel/next' }],
      },
      null,
      2
    ),
  });

  return files;
}

/**
 * Preparar archivos para Netlify
 * @private
 */
function prepareFilesForNetlify(appCode) {
  const files = {};

  // Frontend files
  if (appCode.frontend?.files) {
    appCode.frontend.files.forEach((file) => {
      files[file.path] = file.content;
    });
  }

  // Netlify.toml
  files['netlify.toml'] = `
[build]
  command = "npm run build"
  publish = ".next"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  `;

  return files;
}

/**
 * Esperar a que el deployment esté listo
 * @private
 */
async function waitForDeployment(deploymentId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Esperar 5 segundos

    const response = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        },
      }
    );

    const data = await response.json();

    if (data.readyState === 'READY') {
      return `https://${data.url}`;
    }

    if (data.readyState === 'ERROR') {
      throw new Error('Deployment failed');
    }
  }

  throw new Error('Deployment timeout');
}

/**
 * Crear ZIP de archivos
 * @private
 */
async function createZipFromFiles(files) {
  // Implementación simplificada - en producción usar librería como archiver
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  Object.entries(files).forEach(([path, content]) => {
    zip.file(path, content);
  });

  return await zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Obtener estado del deployment
 * @param {string} deploymentId - ID del deployment
 * @param {string} provider - Provider
 */
export const getDeploymentStatus = async (deploymentId, provider) => {
  try {
    if (provider === 'vercel') {
      const response = await fetch(
        `https://api.vercel.com/v13/deployments/${deploymentId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
          },
        }
      );
      return await response.json();
    } else if (provider === 'netlify') {
      const response = await fetch(
        `https://api.netlify.com/api/v1/deploys/${deploymentId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.NETLIFY_TOKEN}`,
          },
        }
      );
      return await response.json();
    }
  } catch (error) {
    console.error('❌ Error getting deployment status:', error);
    return { error: error.message };
  }
};

export default {
  deployApp,
  deployToVercel,
  deployToNetlify,
  getDeploymentStatus,
};
