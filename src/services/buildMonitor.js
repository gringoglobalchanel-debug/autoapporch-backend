/**
 * Servicio de monitoreo de builds
 * Rastrea calidad, alerta sobre problemas y genera métricas
 */

import { query } from '../config/database.js';

export class BuildMonitor {
  /**
   * Registrar un build en el log
   */
  async trackBuild(appId, status, metadata = {}) {
    try {
      await query(
        `INSERT INTO build_logs (app_id, status, metadata, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [appId, status, JSON.stringify(metadata)]
      );

      // Verificar si hay problemas recurrentes
      await this.checkRecurrentIssues(appId);
      
      // Actualizar métricas de calidad generales
      await this.updateQualityMetrics();

    } catch (error) {
      console.error('Error tracking build:', error);
    }
  }

  /**
   * Verificar si una app tiene problemas recurrentes
   */
  async checkRecurrentIssues(appId) {
    try {
      const recentFails = await query(
        `SELECT COUNT(*) as count FROM build_logs 
         WHERE app_id = $1 
         AND status IN ('failed', 'fallback')
         AND created_at > NOW() - INTERVAL '1 hour'`,
        [appId]
      );

      if (recentFails.rows[0].count >= 3) {
        await this.alertTeam({
          type: 'RECURRENT_FAILURE',
          appId,
          count: recentFails.rows[0].count,
          message: `⚠️ App ${appId} tiene ${recentFails.rows[0].count} builds fallidos en la última hora`
        });
      }
    } catch (error) {
      console.error('Error checking recurrent issues:', error);
    }
  }

  /**
   * Actualizar métricas globales de calidad
   */
  async updateQualityMetrics() {
    try {
      const metrics = await query(`
        WITH hourly_stats AS (
          SELECT 
            DATE_TRUNC('hour', created_at) as hour,
            COUNT(*) as total_builds,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_builds,
            AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_rate
          FROM build_logs
          WHERE created_at > NOW() - INTERVAL '24 hours'
          GROUP BY DATE_TRUNC('hour', created_at)
        )
        SELECT 
          AVG(success_rate) as avg_success_rate_24h,
          SUM(total_builds) as total_builds_24h,
          SUM(successful_builds) as successful_builds_24h
        FROM hourly_stats
      `);

      const data = metrics.rows[0];
      
      // Si la tasa de éxito baja del 95%, alertar
      if (data.avg_success_rate_24h < 0.95) {
        await this.alertTeam({
          type: 'QUALITY_DROP',
          message: `⚠️ Tasa de éxito baja: ${(data.avg_success_rate_24h * 100).toFixed(1)}% en 24h`,
          metrics: data
        });
      }

      // Guardar métricas en tabla de calidad
      await query(
        `INSERT INTO quality_metrics (metric_date, total_generations, successful_generations, avg_success_rate)
         VALUES (CURRENT_DATE, $1, $2, $3)
         ON CONFLICT (metric_date) DO UPDATE 
         SET total_generations = $1, successful_generations = $2, avg_success_rate = $3`,
        [
          data.total_builds_24h || 0,
          data.successful_builds_24h || 0,
          data.avg_success_rate_24h || 1
        ]
      );

    } catch (error) {
      console.error('Error updating quality metrics:', error);
    }
  }

  /**
   * Obtener calidad de una app específica
   */
  async getAppQuality(appId) {
    try {
      const result = await query(`
        SELECT 
          COUNT(*) as total_builds,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_builds,
          SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) as fallback_builds,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_builds,
          MAX(created_at) as last_build,
          MIN(created_at) as first_build
        FROM build_logs
        WHERE app_id = $1
      `, [appId]);

      const stats = result.rows[0];
      
      // Calcular tasa de éxito
      const successRate = stats.total_builds > 0 
        ? (stats.successful_builds / stats.total_builds) * 100 
        : 0;

      return {
        ...stats,
        successRate: Math.round(successRate * 100) / 100,
        health: this.getHealthStatus(successRate, stats.failed_builds)
      };

    } catch (error) {
      console.error('Error getting app quality:', error);
      return null;
    }
  }

  /**
   * Determinar estado de salud de la app
   */
  getHealthStatus(successRate, failedBuilds) {
    if (successRate >= 95) return 'excellent';
    if (successRate >= 80) return 'good';
    if (successRate >= 60) return 'fair';
    if (failedBuilds > 5) return 'poor';
    return 'unknown';
  }

  /**
   * Obtener estadísticas globales del sistema
   */
  async getSystemStats(days = 7) {
    try {
      const result = await query(`
        SELECT 
          COUNT(DISTINCT app_id) as apps_with_builds,
          COUNT(*) as total_builds,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_builds,
          SUM(CASE WHEN status = 'fallback' THEN 1 ELSE 0 END) as fallback_builds,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_builds,
          AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as global_success_rate
        FROM build_logs
        WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
      `, [days]);

      const stats = result.rows[0];

      return {
        ...stats,
        period: `${days} days`,
        global_success_rate: Math.round((stats.global_success_rate || 0) * 100) / 100
      };

    } catch (error) {
      console.error('Error getting system stats:', error);
      return null;
    }
  }

  /**
   * Alertar al equipo (Slack, Email, etc.)
   */
  async alertTeam(alert) {
    try {
      // Guardar alerta en base de datos
      await query(
        `INSERT INTO alerts (type, message, details, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [alert.type, alert.message, JSON.stringify(alert)]
      );

      // Enviar a Slack si está configurado
      if (process.env.SLACK_WEBHOOK_URL) {
        const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: alert.message,
            attachments: [{
              color: alert.type === 'RECURRENT_FAILURE' ? 'danger' : 'warning',
              fields: Object.entries(alert).map(([key, value]) => ({
                title: key,
                value: String(value),
                short: true
              }))
            }]
          })
        });

        if (!response.ok) {
          console.error('Error sending Slack alert:', await response.text());
        }
      }

      // Enviar email si está configurado
      if (process.env.ALERT_EMAIL) {
        // Aquí iría lógica de email
        console.log(`📧 Email alert would be sent to ${process.env.ALERT_EMAIL}`);
      }

      console.log('🚨 ALERTA:', alert);

    } catch (error) {
      console.error('Error sending alert:', error);
    }
  }

  /**
   * Obtener alertas recientes
   */
  async getRecentAlerts(limit = 50) {
    try {
      const result = await query(
        `SELECT * FROM alerts 
         ORDER BY created_at DESC 
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting recent alerts:', error);
      return [];
    }
  }

  /**
   * Limpiar logs antiguos (para mantenimiento)
   */
  async cleanOldLogs(daysToKeep = 30) {
    try {
      const result = await query(
        `DELETE FROM build_logs 
         WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
         RETURNING COUNT(*) as deleted`,
        [daysToKeep]
      );
      
      console.log(`🧹 Limpiados ${result.rows[0].deleted} logs antiguos`);
      return result.rows[0].deleted;

    } catch (error) {
      console.error('Error cleaning old logs:', error);
      return 0;
    }
  }
}

// Exportación nombrada
export const buildMonitor = new BuildMonitor();