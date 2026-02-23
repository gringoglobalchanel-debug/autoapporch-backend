/**
 * GoDaddy Domain Service
 * Registro automático y gestión de dominios para usuarios
 */

import fetch from 'node-fetch';
import { query } from '../config/database.js';

const GODADDY_API = 'https://api.godaddy.com/v1';
const HEADERS = () => ({
  'Authorization': `sso-key ${process.env.GODADDY_API_KEY}:${process.env.GODADDY_API_SECRET}`,
  'Content-Type': 'application/json'
});

class GoDaddyService {

  /**
   * Verificar disponibilidad de un dominio
   */
  async checkAvailability(domain) {
    try {
      const response = await fetch(
        `${GODADDY_API}/domains/available?domain=${domain}&checkType=FAST`,
        { headers: HEADERS() }
      );
      const data = await response.json();
      return {
        available: data.available || false,
        price: data.price ? data.price / 1000000 : null, // GoDaddy usa millonésimas
        currency: data.currency || 'USD',
        domain: data.domain
      };
    } catch (error) {
      console.error('❌ Error checking domain availability:', error);
      return { available: false, error: error.message };
    }
  }

  /**
   * Buscar variaciones disponibles de un nombre
   */
  async suggestDomains(name) {
    try {
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const suggestions = [
        `${cleanName}.com`,
        `${cleanName}.net`,
        `${cleanName}app.com`,
        `get${cleanName}.com`,
        `${cleanName}online.com`
      ];

      const results = await Promise.all(
        suggestions.map(domain => this.checkAvailability(domain))
      );

      return suggestions.map((domain, i) => ({
        domain,
        ...results[i]
      })).filter(d => d.available);

    } catch (error) {
      console.error('❌ Error suggesting domains:', error);
      return [];
    }
  }

  /**
   * Registrar dominio automáticamente
   */
  async registerDomain(domain, userId, appId) {
    try {
      console.log(`🌐 Registrando dominio: ${domain} para usuario ${userId}`);

      // Verificar disponibilidad primero
      const available = await this.checkAvailability(domain);
      if (!available.available) {
        return { success: false, error: 'El dominio no está disponible' };
      }

      // Registrar en GoDaddy
      const response = await fetch(`${GODADDY_API}/domains/purchase`, {
        method: 'POST',
        headers: HEADERS(),
        body: JSON.stringify({
          domain,
          period: 1, // 1 año
          renewAuto: false, // NO renovar automático — controlamos nosotros
          privacy: true, // WHOIS privacy gratis
          consent: {
            agreedAt: new Date().toISOString(),
            agreedBy: process.env.GODADDY_API_USER || 'platform',
            agreementKeys: ['DNRA']
          },
          contactAdmin: this.getPlatformContact(),
          contactBilling: this.getPlatformContact(),
          contactRegistrant: this.getPlatformContact(),
          contactTech: this.getPlatformContact()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('❌ GoDaddy error:', data);
        throw new Error(data.message || data.error || 'Error registrando dominio');
      }

      console.log(`✅ Dominio registrado: ${domain} - Order: ${data.orderId}`);

      // Guardar en DB
      await query(
        `INSERT INTO registered_domains 
         (user_id, app_id, domain, registrar, order_id, status, expires_at, auto_renew)
         VALUES ($1, $2, $3, 'godaddy', $4, 'registered', NOW() + INTERVAL '1 year', false)`,
        [userId, appId, domain, data.orderId?.toString() || 'pending']
      );

      // Configurar DNS hacia Vercel
      await this.configureDnsForVercel(domain);

      return {
        success: true,
        domain,
        orderId: data.orderId,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      };

    } catch (error) {
      console.error('❌ Error registrando dominio:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Configurar DNS del dominio hacia Vercel automáticamente
   */
  async configureDnsForVercel(domain) {
    try {
      console.log(`🔧 Configurando DNS para ${domain} → Vercel`);

      const records = [
        { type: 'A', name: '@', data: '76.76.21.21', ttl: 600 },
        { type: 'CNAME', name: 'www', data: 'cname.vercel-dns.com', ttl: 600 }
      ];

      // Eliminar registros A y CNAME existentes primero
      await fetch(`${GODADDY_API}/domains/${domain}/records/A/@`, {
        method: 'DELETE',
        headers: HEADERS()
      });

      // Agregar nuevos registros
      const response = await fetch(`${GODADDY_API}/domains/${domain}/records`, {
        method: 'PATCH',
        headers: HEADERS(),
        body: JSON.stringify(records)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Error configurando DNS');
      }

      console.log(`✅ DNS configurado: ${domain} → Vercel`);
      return { success: true };

    } catch (error) {
      console.error('❌ Error configurando DNS:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Conectar dominio al proyecto Vercel del usuario
   */
  async connectToVercel(domain, vercelProjectName) {
    try {
      console.log(`🔗 Conectando ${domain} al proyecto Vercel ${vercelProjectName}`);

      // Obtener project ID de Vercel
      const projectResponse = await fetch(
        `https://api.vercel.com/v9/projects/${vercelProjectName}`,
        { headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` } }
      );
      const project = await projectResponse.json();

      if (!project.id) throw new Error('Proyecto Vercel no encontrado');

      // Agregar dominio al proyecto
      const response = await fetch(
        `https://api.vercel.com/v10/projects/${project.id}/domains`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.VERCEL_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: domain })
        }
      );

      const data = await response.json();

      if (!response.ok && data.error?.code !== 'domain_already_in_use') {
        throw new Error(data.error?.message || 'Error conectando dominio a Vercel');
      }

      // Actualizar DB
      await query(
        `UPDATE registered_domains SET vercel_connected = true, status = 'active' WHERE domain = $1`,
        [domain]
      );

      await query(
        `UPDATE apps SET custom_domain = $1, domain_status = 'active' WHERE vercel_project_name = $2`,
        [domain, vercelProjectName]
      );

      console.log(`✅ Dominio ${domain} conectado a Vercel`);
      return { success: true };

    } catch (error) {
      console.error('❌ Error conectando a Vercel:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Suspender dominio (desconectar de Vercel cuando no paga)
   */
  async suspendDomain(domain) {
    try {
      console.log(`🚫 Suspendiendo dominio: ${domain}`);

      // Buscar el proyecto Vercel del dominio
      const domainResult = await query(
        `SELECT rd.*, a.vercel_project_name 
         FROM registered_domains rd
         JOIN apps a ON a.id = rd.app_id
         WHERE rd.domain = $1`,
        [domain]
      );

      if (domainResult.rows.length === 0) return { success: false, error: 'Dominio no encontrado' };

      const { vercel_project_name } = domainResult.rows[0];

      if (vercel_project_name) {
        // Obtener project ID
        const projectResponse = await fetch(
          `https://api.vercel.com/v9/projects/${vercel_project_name}`,
          { headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` } }
        );
        const project = await projectResponse.json();

        if (project.id) {
          // Desconectar de Vercel
          await fetch(
            `https://api.vercel.com/v10/projects/${project.id}/domains/${domain}`,
            {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${process.env.VERCEL_TOKEN}` }
            }
          );
        }
      }

      // Actualizar estado en DB
      await query(
        `UPDATE registered_domains SET status = 'suspended', vercel_connected = false WHERE domain = $1`,
        [domain]
      );

      console.log(`✅ Dominio ${domain} suspendido`);
      return { success: true };

    } catch (error) {
      console.error('❌ Error suspendiendo dominio:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reactivar dominio (cuando el usuario paga de nuevo)
   */
  async reactivateDomain(domain) {
    try {
      console.log(`✅ Reactivando dominio: ${domain}`);

      const domainResult = await query(
        `SELECT rd.*, a.vercel_project_name 
         FROM registered_domains rd
         JOIN apps a ON a.id = rd.app_id
         WHERE rd.domain = $1`,
        [domain]
      );

      if (domainResult.rows.length === 0) return { success: false, error: 'Dominio no encontrado' };

      const { vercel_project_name } = domainResult.rows[0];

      // Reconectar DNS a Vercel
      await this.configureDnsForVercel(domain);

      // Reconectar al proyecto Vercel
      if (vercel_project_name) {
        await this.connectToVercel(domain, vercel_project_name);
      }

      await query(
        `UPDATE registered_domains SET status = 'active', vercel_connected = true WHERE domain = $1`,
        [domain]
      );

      console.log(`✅ Dominio ${domain} reactivado`);
      return { success: true };

    } catch (error) {
      console.error('❌ Error reactivando dominio:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cancelar renovación de dominio (cuando usuario no paga por 60 días)
   */
  async cancelRenewal(domain) {
    try {
      // GoDaddy no tiene endpoint directo para cancelar renovación
      // Se hace asegurando que renewAuto = false (ya lo ponemos así al registrar)
      await query(
        `UPDATE registered_domains SET auto_renew = false, status = 'expired' WHERE domain = $1`,
        [domain]
      );
      console.log(`✅ Renovación cancelada para: ${domain}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Contacto de la plataforma para registro de dominios
   */
  getPlatformContact() {
    return {
      addressMailing: {
        address1: process.env.PLATFORM_ADDRESS || '123 Platform St',
        city: process.env.PLATFORM_CITY || 'Miami',
        state: process.env.PLATFORM_STATE || 'FL',
        zip: process.env.PLATFORM_ZIP || '33101',
        country: 'US'
      },
      email: process.env.PLATFORM_EMAIL || 'domains@yourdomain.com',
      phone: process.env.PLATFORM_PHONE || '+1.3051234567',
      nameFirst: process.env.PLATFORM_NAME_FIRST || 'Platform',
      nameLast: process.env.PLATFORM_NAME_LAST || 'Admin'
    };
  }
}

export const godaddyService = new GoDaddyService();
export default godaddyService;