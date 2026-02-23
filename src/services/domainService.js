/**
 * Servicio de dominios personalizados
 * Maneja conexión de dominios con Vercel
 */

import { query } from '../config/database.js';
import fetch from 'node-fetch';

const VERCEL_API = 'https://api.vercel.com';

/**
 * Obtener el project ID real de Vercel desde el project name
 */
const getVercelProjectId = async (appId, userId) => {
  const appResult = await query(
    'SELECT vercel_project_id, vercel_project_name FROM apps WHERE id = $1 AND user_id = $2',
    [appId, userId]
  );

  if (appResult.rows.length === 0) throw new Error('App not found');

  const { vercel_project_id, vercel_project_name } = appResult.rows[0];

  // Si ya tiene project_id guardado, usarlo
  if (vercel_project_id) return vercel_project_id;

  // Si solo tiene project_name, buscar el ID en Vercel
  if (vercel_project_name) {
    const response = await fetch(
      `${VERCEL_API}/v9/projects/${vercel_project_name}`,
      { headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` } }
    );
    const data = await response.json();

    if (data.id) {
      // Guardar para no volver a buscarlo
      await query(
        'UPDATE apps SET vercel_project_id = $1 WHERE id = $2',
        [data.id, appId]
      );
      return data.id;
    }
  }

  throw new Error('No se encontró el proyecto en Vercel. Asegúrate de que la app esté desplegada.');
};

/**
 * Agregar dominio personalizado a una app
 */
export const addCustomDomain = async (appId, domain, userId) => {
  try {
    const projectId = await getVercelProjectId(appId, userId);
    const cleanDomain = domain.toLowerCase().trim();

    // Agregar dominio en Vercel
    const response = await fetch(`${VERCEL_API}/v10/projects/${projectId}/domains`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: cleanDomain }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error?.code === 'domain_already_in_use') {
        throw new Error('Este dominio ya está configurado en otro proyecto de Vercel');
      }
      throw new Error(data.error?.message || 'Error al agregar dominio en Vercel');
    }

    // Guardar en DB
    await query(
      `INSERT INTO app_domains (app_id, domain, status, verification_record)
       VALUES ($1, $2, 'configuring', $3)
       ON CONFLICT (app_id, domain) DO UPDATE SET status = 'configuring'`,
      [appId, cleanDomain, JSON.stringify(data.verification || {})]
    );

    // Incrementar contador de dominios usados
    await query(
      `UPDATE subscriptions SET domains_used = domains_used + 1, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    // Actualizar custom_domain principal si es el primero
    const domainsCount = await query(
      'SELECT COUNT(*) FROM app_domains WHERE app_id = $1',
      [appId]
    );

    if (parseInt(domainsCount.rows[0].count) === 1) {
      await query(
        `UPDATE apps SET custom_domain = $1, domain_status = 'configuring' WHERE id = $2`,
        [cleanDomain, appId]
      );
    }

    // Construir instrucciones DNS claras para el usuario
    const dnsInstructions = buildDnsInstructions(cleanDomain, data);

    return {
      success: true,
      domain: cleanDomain,
      verification: data.verification || null,
      dnsInstructions,
      message: 'Dominio agregado. Configura los registros DNS para activarlo.'
    };

  } catch (error) {
    console.error('❌ Error adding custom domain:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Construir instrucciones DNS claras
 */
function buildDnsInstructions(domain, vercelData) {
  const isSubdomain = domain.split('.').length > 2;

  if (isSubdomain) {
    return {
      type: 'CNAME',
      name: domain.split('.')[0],
      value: 'cname.vercel-dns.com',
      instructions: `En tu proveedor DNS, agrega un registro CNAME: "${domain.split('.')[0]}" → "cname.vercel-dns.com"`
    };
  } else {
    return {
      type: 'A',
      name: '@',
      value: '76.76.21.21',
      instructions: `En tu proveedor DNS, agrega un registro A: "@" → "76.76.21.21"`,
      alternative: {
        type: 'CNAME',
        name: 'www',
        value: 'cname.vercel-dns.com',
        instructions: 'Y también un CNAME: "www" → "cname.vercel-dns.com"'
      }
    };
  }
}

/**
 * Verificar estado del dominio
 */
export const verifyDomainStatus = async (appId, domain) => {
  try {
    const appResult = await query(
      'SELECT vercel_project_id, vercel_project_name, user_id FROM apps WHERE id = $1',
      [appId]
    );

    if (appResult.rows.length === 0) throw new Error('App not found');

    const projectId = await getVercelProjectId(appId, appResult.rows[0].user_id);
    const cleanDomain = domain.toLowerCase().trim();

    const response = await fetch(
      `${VERCEL_API}/v10/projects/${projectId}/domains/${cleanDomain}`,
      { headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` } }
    );

    const data = await response.json();

    if (data.verified) {
      await query(
        `UPDATE app_domains SET status = 'active', updated_at = NOW() WHERE app_id = $1 AND domain = $2`,
        [appId, cleanDomain]
      );
      await query(
        `UPDATE apps SET domain_status = 'verified', domain_verified_at = NOW() WHERE id = $1 AND custom_domain = $2`,
        [appId, cleanDomain]
      );
    }

    return {
      success: true,
      verified: data.verified || false,
      status: data.verified ? 'active' : 'pending',
      dnsInstructions: data.verified ? null : buildDnsInstructions(cleanDomain, data)
    };

  } catch (error) {
    console.error('❌ Error verifying domain:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Eliminar dominio personalizado
 */
export const removeCustomDomain = async (appId, domain, userId) => {
  try {
    const projectId = await getVercelProjectId(appId, userId);
    const cleanDomain = domain.toLowerCase().trim();

    // Eliminar de Vercel
    const response = await fetch(
      `${VERCEL_API}/v10/projects/${projectId}/domains/${cleanDomain}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` },
      }
    );

    if (!response.ok && response.status !== 404) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Error al eliminar dominio en Vercel');
    }

    // Eliminar de DB
    await query('DELETE FROM app_domains WHERE app_id = $1 AND domain = $2', [appId, cleanDomain]);

    // Decrementar contador
    await query(
      `UPDATE subscriptions SET domains_used = GREATEST(domains_used - 1, 0), updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    // Si era el dominio principal, limpiar
    await query(
      `UPDATE apps SET custom_domain = NULL, domain_status = 'none' WHERE id = $1 AND custom_domain = $2`,
      [appId, cleanDomain]
    );

    return { success: true };

  } catch (error) {
    console.error('❌ Error removing domain:', error);
    return { success: false, error: error.message };
  }
};

export default { addCustomDomain, verifyDomainStatus, removeCustomDomain };