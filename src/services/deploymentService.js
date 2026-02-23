/**
 * ═══════════════════════════════════════════════════════════════════
 * DEPLOYMENT SERVICE V2 - SISTEMA COMPLETO
 * ═══════════════════════════════════════════════════════════════════
 */

import { query, transaction } from '../config/database.js';
import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// ═══════════════════════════════════════════════════════════════════
// 1️⃣ GITHUB BACKUP
// ═══════════════════════════════════════════════════════════════════

export const createGitHubBackup = async (appId, appName, code, version = 1) => {
  try {
    const timestamp = Date.now().toString().slice(-6);
    const repoName = `app-${appId.substring(0, 6)}-${appName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}`;

    console.log(`📦 [BACKUP] Creando repositorio: ${repoName}`);

    const repo = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: `[PRIVADO] ${appName} - Propiedad de AutoAppOrchestrator`,
      private: true,
      auto_init: true,
    });

    console.log(`✅ [BACKUP] Repositorio creado: ${repo.data.html_url}`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    const files = prepareFilesForBackup(code, appId, appName, version);
    const { data: repoData } = await octokit.repos.get({
      owner: process.env.GITHUB_USERNAME,
      repo: repoName
    });

    const defaultBranch = repoData.default_branch;

    for (const file of files) {
      try {
        await octokit.repos.createOrUpdateFileContents({
          owner: process.env.GITHUB_USERNAME,
          repo: repoName,
          path: file.path,
          message: `${version} - Initial commit`,
          content: file.content,
          branch: defaultBranch
        });
        console.log(`  📄 [BACKUP] ${file.path} guardado`);
      } catch (fileError) {
        console.error(`❌ [BACKUP] Error en ${file.path}:`, fileError.message);
      }
    }

    return {
      success: true,
      repoName,
      repoUrl: repo.data.html_url,
      defaultBranch,
      version
    };

  } catch (error) {
    console.error('❌ [BACKUP] Error:', error);
    return { success: false, error: error.message };
  }
};

export const updateGitHubBackup = async (repoName, code, version) => {
  try {
    console.log(`📦 [UPDATE] Actualizando a ${version} en ${repoName}`);

    const { data: repoData } = await octokit.repos.get({
      owner: process.env.GITHUB_USERNAME,
      repo: repoName
    });

    const defaultBranch = repoData.default_branch;
    const files = prepareFilesForBackup(code, null, null, version);

    for (const file of files) {
      try {
        let sha = null;
        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: process.env.GITHUB_USERNAME,
            repo: repoName,
            path: file.path,
            ref: defaultBranch
          });
          sha = fileData.sha;
        } catch (e) {}

        await octokit.repos.createOrUpdateFileContents({
          owner: process.env.GITHUB_USERNAME,
          repo: repoName,
          path: file.path,
          message: `${version} - Update`,
          content: file.content,
          branch: defaultBranch,
          ...(sha && { sha })
        });
        console.log(`  📄 [UPDATE] ${file.path} actualizado`);
      } catch (fileError) {
        console.error(`❌ [UPDATE] Error en ${file.path}:`, fileError.message);
      }
    }

    try {
      const { data: commit } = await octokit.repos.getCommit({
        owner: process.env.GITHUB_USERNAME,
        repo: repoName,
        ref: defaultBranch
      });

      await octokit.git.createRef({
        owner: process.env.GITHUB_USERNAME,
        repo: repoName,
        ref: `refs/tags/${version}`,
        sha: commit.sha
      });
      console.log(`🏷️ [TAG] ${version} creado`);
    } catch (tagError) {
      console.log(`⚠️ [TAG] No se pudo crear tag: ${tagError.message}`);
    }

    return { success: true, version };

  } catch (error) {
    console.error('❌ [UPDATE] Error:', error);
    return { success: false, error: error.message };
  }
};

export const getVersionCode = async (repoName, version) => {
  try {
    console.log(`📥 [ROLLBACK] Obteniendo código de ${version}`);
    const files = await getFilesFromRepo(repoName, version);
    
    return {
      success: true,
      code: {
        frontend: { files: files.filter(f => f.path.startsWith('frontend/')) },
        backend: { files: files.filter(f => f.path.startsWith('backend/')) }
      }
    };

  } catch (error) {
    console.error('❌ [ROLLBACK] Error:', error);
    return { success: false, error: error.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
// 2️⃣ VERCEL DEPLOYMENT
// ═══════════════════════════════════════════════════════════════════

export const deployDirectToVercel = async (appId, appName, code, envVars = {}) => {
  try {
    const projectName = `app-${appId.substring(0, 8)}-${Date.now().toString().slice(-6)}`.toLowerCase();
    console.log(`🚀 [VERCEL] Deploy: ${projectName}`);

    const files = [];
    if (code.frontend?.files) {
      code.frontend.files.forEach(file => {
        // ✅ FIX: asegurar que content es siempre string
        const content = typeof file.content === 'string'
          ? file.content
          : JSON.stringify(file.content);

        files.push({
          file: file.path,
          data: content
        });
      });
    }

    const deployPayload = {
      name: projectName,
      files,
      projectSettings: {
        framework: 'vite',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        installCommand: 'npm install',
        nodeVersion: '20.x'
      },
      target: 'production',
      env: Object.entries(envVars)
        .filter(([_, value]) => value)
        .reduce((acc, [key, value]) => {
          acc[key] = value.toString();
          return acc;
        }, {})
    };

    console.log(`📤 [VERCEL] Enviando ${files.length} archivos...`);

    const deployResponse = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deployPayload)
    });

    const deployment = await deployResponse.json();

    if (!deployResponse.ok) {
      console.error('❌ [VERCEL] Error:', deployment);
      throw new Error(deployment.error?.message || 'Deployment failed');
    }

    console.log(`✅ [VERCEL] Deployment creado: ${deployment.id}`);
    const deploymentUrl = await waitForDeployment(deployment.id, deployment.url);

    return {
      success: true,
      deploymentId: deployment.id,
      projectName,
      url: deploymentUrl,
      readyState: 'READY'
    };

  } catch (error) {
    console.error('❌ [VERCEL] Error:', error);
    return { success: false, error: error.message };
  }
};

export const deleteVercelDeployment = async (deploymentId) => {
  try {
    console.log(`🗑️ [VERCEL] Eliminando deployment: ${deploymentId}`);

    const deleteResponse = await fetch(
      `https://api.vercel.com/v13/deployments/${deploymentId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` },
      }
    );

    if (!deleteResponse.ok) {
      const error = await deleteResponse.json();
      throw new Error(error.error?.message || 'Delete failed');
    }

    console.log(`✅ [VERCEL] Deployment eliminado`);
    return { success: true };

  } catch (error) {
    console.error('❌ [VERCEL] Error eliminando:', error);
    return { success: false, error: error.message };
  }
};

async function waitForDeployment(deploymentId, deploymentUrl, maxAttempts = 24) {
  console.log(`⏳ [VERCEL] Esperando deployment...`);
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const statusResponse = await fetch(
        `https://api.vercel.com/v13/deployments/${deploymentId}`,
        { headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` } }
      );

      const status = await statusResponse.json();
      console.log(`📊 [VERCEL] Estado: ${status.readyState} (${attempts + 1}/${maxAttempts})`);

      if (status.readyState === 'READY') {
        const finalUrl = `https://${deploymentUrl}`;
        console.log(`✅ [VERCEL] Completado: ${finalUrl}`);
        return finalUrl;
      }

      if (status.readyState === 'ERROR' || status.readyState === 'CANCELED') {
        throw new Error(`Deployment failed: ${status.readyState}`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

    } catch (error) {
      console.error(`⚠️ [VERCEL] Error checking:`, error.message);
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  return `https://${deploymentUrl}`;
}

// ═══════════════════════════════════════════════════════════════════
// 3️⃣ DEPLOY INICIAL
// ═══════════════════════════════════════════════════════════════════

export const deployApp = async (appId, userId) => {
  try {
    console.log(`\n🎯 ===== DEPLOY INICIAL: ${appId} =====\n`);

    const appResult = await query(
      `SELECT a.*, av.code, av.version 
       FROM apps a
       JOIN app_versions av ON a.id = av.app_id
       WHERE a.id = $1 AND a.user_id = $2
       ORDER BY av.version DESC LIMIT 1`,
      [appId, userId]
    );

    if (appResult.rows.length === 0) throw new Error('App not found');

    const app = appResult.rows[0];

    // ✅ FIX PRINCIPAL: parsear code si viene como string JSON
    let code = app.code;
    if (typeof code === 'string') {
      try {
        code = JSON.parse(code);
      } catch (e) {
        console.error('❌ Error parseando code de DB:', e.message);
        throw new Error('Invalid code format in database');
      }
    }

    if (!code) throw new Error('No code found');

    await query(
      `UPDATE apps SET deployment_status = 'deploying', updated_at = NOW() WHERE id = $1`,
      [appId]
    );

    console.log(`\n📦 PASO 1/2: Backup en GitHub...\n`);
    const backup = await createGitHubBackup(appId, app.name, code, 1);
    if (!backup.success) throw new Error(`GitHub backup failed: ${backup.error}`);

    console.log(`\n🚀 PASO 2/2: Deploy a Vercel...\n`);
    const envVars = {
      VITE_SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
      NODE_ENV: 'production',
    };

    const deploy = await deployDirectToVercel(appId, app.name, code, envVars);
    if (!deploy.success) throw new Error(`Vercel deployment failed: ${deploy.error}`);

    await query(
      `UPDATE apps 
       SET deployed = TRUE,
           deploy_url = $1,
           deployment_status = 'deployed',
           github_repo_url = $2,
           vercel_deployment_id = $3,
           vercel_project_name = $4,
           github_repo_name = $5,
           current_version = 1,
           updated_at = NOW()
       WHERE id = $6`,
      [deploy.url, backup.repoUrl, deploy.deploymentId, deploy.projectName, backup.repoName, appId]
    );

    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'success', 'App desplegada - v1.0.0', JSON.stringify({
        backupUrl: backup.repoUrl, deployUrl: deploy.url, deploymentId: deploy.deploymentId, version: 'v1.0.0'
      })]
    );

    console.log(`\n✅ ===== DEPLOY COMPLETADO =====`);
    console.log(`📦 Backup: ${backup.repoUrl}`);
    console.log(`🌐 Production: ${deploy.url}\n`);

    return {
      success: true,
      backupUrl: backup.repoUrl,
      deployUrl: deploy.url,
      deploymentId: deploy.deploymentId,
      version: 'v1.0.0',
      message: 'App desplegada exitosamente'
    };

  } catch (error) {
    console.error(`\n❌ ===== ERROR EN DEPLOY =====`);
    console.error(error);
    await query(`UPDATE apps SET deployment_status = 'failed', updated_at = NOW() WHERE id = $1`, [appId]);
    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'error', 'Error en deploy', JSON.stringify({ error: error.message })]
    );
    return { success: false, error: error.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
// 4️⃣ ACTUALIZAR APP
// ═══════════════════════════════════════════════════════════════════

export const updateApp = async (appId, userId, newCode, updateDescription = '') => {
  try {
    console.log(`\n🔄 ===== ACTUALIZANDO APP: ${appId} =====\n`);

    const appResult = await query(`SELECT * FROM apps WHERE id = $1 AND user_id = $2`, [appId, userId]);
    if (appResult.rows.length === 0) throw new Error('App not found');

    const app = appResult.rows[0];
    const currentVersion = app.current_version || 'v1.0.0';
    const versionParts = currentVersion.replace('v', '').split('.');
    versionParts[1] = parseInt(versionParts[1]) + 1;
    const newVersion = `v${versionParts.join('.')}`;

    console.log(`📊 Versión actual: ${currentVersion} → Nueva: ${newVersion}`);
    await query(`UPDATE apps SET deployment_status = 'updating', updated_at = NOW() WHERE id = $1`, [appId]);

    console.log(`\n📦 PASO 1/3: Actualizando GitHub...\n`);
    const backup = await updateGitHubBackup(app.github_repo_name, newCode, newVersion);
    if (!backup.success) throw new Error(`GitHub update failed: ${backup.error}`);

    console.log(`\n💾 PASO 2/3: Guardando versión en DB...\n`);
    await query(
      `INSERT INTO app_versions (app_id, version, code, generation_prompt, generation_time_ms, tokens_used) VALUES ($1, $2, $3, $4, $5, $6)`,
      [appId, parseInt(versionParts[1]), JSON.stringify(newCode), updateDescription, 0, 0]
    );

    console.log(`\n🚀 PASO 3/3: Nuevo deploy a Vercel...\n`);
    const envVars = {
      VITE_SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
      NODE_ENV: 'production',
    };

    const deploy = await deployDirectToVercel(appId, app.name, newCode, envVars);
    if (!deploy.success) throw new Error(`Vercel deployment failed: ${deploy.error}`);

    await query(
      `UPDATE apps SET deploy_url = $1, vercel_deployment_id = $2, current_version = $3, deployment_status = 'deployed', updated_at = NOW() WHERE id = $4`,
      [deploy.url, deploy.deploymentId, newVersion, appId]
    );

    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'success', `App actualizada a ${newVersion}`, JSON.stringify({
        version: newVersion, deployUrl: deploy.url, deploymentId: deploy.deploymentId, description: updateDescription
      })]
    );

    console.log(`\n✅ ===== ACTUALIZACIÓN COMPLETADA =====`);
    console.log(`📦 Versión: ${newVersion}`);
    console.log(`🌐 Production: ${deploy.url}\n`);

    return { success: true, version: newVersion, deployUrl: deploy.url, deploymentId: deploy.deploymentId };

  } catch (error) {
    console.error(`\n❌ ===== ERROR EN ACTUALIZACIÓN =====`);
    console.error(error);
    await query(`UPDATE apps SET deployment_status = 'failed', updated_at = NOW() WHERE id = $1`, [appId]);
    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'error', 'Error en actualización', JSON.stringify({ error: error.message })]
    );
    return { success: false, error: error.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
// 5️⃣ ROLLBACK
// ═══════════════════════════════════════════════════════════════════

export const rollbackApp = async (appId, userId, targetVersion) => {
  try {
    console.log(`\n↩️ ===== ROLLBACK: ${appId} → ${targetVersion} =====\n`);

    const appResult = await query(`SELECT * FROM apps WHERE id = $1 AND user_id = $2`, [appId, userId]);
    if (appResult.rows.length === 0) throw new Error('App not found');

    const app = appResult.rows[0];
    await query(`UPDATE apps SET deployment_status = 'rolling_back', updated_at = NOW() WHERE id = $1`, [appId]);

    console.log(`\n📥 PASO 1/2: Obteniendo código de ${targetVersion}...\n`);
    const versionCode = await getVersionCode(app.github_repo_name, targetVersion);
    if (!versionCode.success) throw new Error(`Failed to get version code: ${versionCode.error}`);

    console.log(`\n🚀 PASO 2/2: Desplegando ${targetVersion}...\n`);
    const envVars = {
      VITE_SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
      NODE_ENV: 'production',
    };

    const deploy = await deployDirectToVercel(appId, app.name, versionCode.code, envVars);
    if (!deploy.success) throw new Error(`Vercel deployment failed: ${deploy.error}`);

    await query(
      `UPDATE apps SET deploy_url = $1, vercel_deployment_id = $2, current_version = $3, deployment_status = 'deployed', updated_at = NOW() WHERE id = $4`,
      [deploy.url, deploy.deploymentId, targetVersion, appId]
    );

    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'success', `Rollback a ${targetVersion}`, JSON.stringify({ version: targetVersion, deployUrl: deploy.url })]
    );

    console.log(`\n✅ ===== ROLLBACK COMPLETADO =====\n`);
    return { success: true, version: targetVersion, deployUrl: deploy.url };

  } catch (error) {
    console.error(`\n❌ ===== ERROR EN ROLLBACK =====`);
    console.error(error);
    await query(`UPDATE apps SET deployment_status = 'failed', updated_at = NOW() WHERE id = $1`, [appId]);
    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'error', 'Error en rollback', JSON.stringify({ error: error.message })]
    );
    return { success: false, error: error.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
// 6️⃣ SUSPENSIÓN
// ═══════════════════════════════════════════════════════════════════

export const suspendApp = async (appId, userId, reason = 'Subscription inactive') => {
  try {
    console.log(`\n🚫 ===== SUSPENDIENDO APP: ${appId} =====\n`);

    const appResult = await query(`SELECT * FROM apps WHERE id = $1 AND user_id = $2`, [appId, userId]);
    if (appResult.rows.length === 0) throw new Error('App not found');

    const app = appResult.rows[0];

    if (app.vercel_deployment_id) {
      console.log(`🗑️ Eliminando deployment...`);
      await deleteVercelDeployment(app.vercel_deployment_id);
    }

    await query(
      `UPDATE apps SET deployment_status = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [appId]
    );

    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'warning', 'App suspendida', JSON.stringify({ reason })]
    );

    console.log(`\n✅ ===== APP SUSPENDIDA =====\n`);
    return { success: true, message: 'App suspendida' };

  } catch (error) {
    console.error(`\n❌ ===== ERROR EN SUSPENSIÓN =====`);
    console.error(error);
    return { success: false, error: error.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
// 7️⃣ REACTIVACIÓN
// ═══════════════════════════════════════════════════════════════════

export const reactivateApp = async (appId, userId) => {
  try {
    console.log(`\n✅ ===== REACTIVANDO APP: ${appId} =====\n`);

    const appResult = await query(
      `SELECT a.*, av.code FROM apps a
       LEFT JOIN app_versions av ON a.id = av.app_id
       WHERE a.id = $1 AND a.user_id = $2
       ORDER BY av.version DESC LIMIT 1`,
      [appId, userId]
    );

    if (appResult.rows.length === 0) throw new Error('App not found');

    const app = appResult.rows[0];
    let code = app.code;

    if (typeof code === 'string') {
      try { code = JSON.parse(code); } catch (e) { throw new Error('Invalid code format'); }
    }

    if (!code) throw new Error('No code found for reactivation');

    console.log(`\n🚀 Desplegando última versión...\n`);
    const envVars = {
      VITE_SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY,
      NODE_ENV: 'production',
    };

    const deploy = await deployDirectToVercel(appId, app.name, code, envVars);
    if (!deploy.success) throw new Error(`Vercel deployment failed: ${deploy.error}`);

    await query(
      `UPDATE apps SET deploy_url = $1, vercel_deployment_id = $2, deployment_status = 'deployed', suspended_at = NULL, updated_at = NOW() WHERE id = $3`,
      [deploy.url, deploy.deploymentId, appId]
    );

    await query(
      `INSERT INTO logs (user_id, app_id, log_type, message, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, appId, 'success', 'App reactivada', JSON.stringify({ deployUrl: deploy.url })]
    );

    console.log(`\n✅ ===== APP REACTIVADA =====\n`);
    return { success: true, deployUrl: deploy.url };

  } catch (error) {
    console.error(`\n❌ ===== ERROR EN REACTIVACIÓN =====`);
    console.error(error);
    return { success: false, error: error.message };
  }
};

// ═══════════════════════════════════════════════════════════════════
// 8️⃣ UTILIDADES
// ═══════════════════════════════════════════════════════════════════

function prepareFilesForBackup(code, appId, appName, version) {
  const files = [];

  if (code.frontend?.files) {
    code.frontend.files.forEach(file => {
      // ✅ FIX: asegurar que content es siempre string antes de Buffer
      const contentStr = typeof file.content === 'string'
        ? file.content
        : JSON.stringify(file.content);

      files.push({
        path: `frontend/${file.path}`,
        content: Buffer.from(contentStr, 'utf8').toString('base64')
      });
    });
  }

  if (code.backend?.files) {
    code.backend.files.forEach(file => {
      const contentStr = typeof file.content === 'string'
        ? file.content
        : JSON.stringify(file.content);

      files.push({
        path: `backend/${file.path}`,
        content: Buffer.from(contentStr, 'utf8').toString('base64')
      });
    });
  }

  if (appId && appName) {
    files.push({
      path: 'APP_METADATA.json',
      content: Buffer.from(JSON.stringify({
        appId, appName, version,
        createdAt: new Date().toISOString(),
        platform: 'AutoAppOrchestrator'
      }, null, 2), 'utf8').toString('base64')
    });
  }

  return files;
}

async function getFilesFromRepo(repoName, version) {
  return [];
}

export const getDeploymentStatus = async (appId) => {
  try {
    const result = await query(
      `SELECT deployment_status, deploy_url, vercel_deployment_id, current_version, updated_at FROM apps WHERE id = $1`,
      [appId]
    );
    if (result.rows.length === 0) throw new Error('App not found');
    return { success: true, ...result.rows[0] };
  } catch (error) {
    console.error('❌ Error obteniendo estado:', error);
    return { success: false, error: error.message };
  }
};

export default {
  deployApp, updateApp, rollbackApp,
  suspendApp, reactivateApp,
  getDeploymentStatus,
  createGitHubBackup, updateGitHubBackup,
  deployDirectToVercel, deleteVercelDeployment
};