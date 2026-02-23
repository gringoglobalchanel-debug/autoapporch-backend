/**
 * Servicio principal de generación de apps
 */

import claudeService from './claudeService.js';
import { query, transaction } from '../config/database.js';

export class AppGenerator {
  constructor() {
    this.maxAttempts = 1;
  }

  async generateApp(userId, appData) {
    try {
      console.log(`🚀 Generando app para usuario ${userId}: ${appData.name}`);

      const claudeResult = await claudeService.generateApp(appData.description, {
        style: appData.style,
        colors: appData.colors,
        googleApis: appData.googleApis,
        requiresPayments: appData.requiresPayments,
        stripePriceIds: appData.stripePriceIds
      });

      if (!claudeResult.success) {
        throw new Error(`Claude falló: ${claudeResult.error}`);
      }

      const app = await this.saveApp(userId, appData, claudeResult.code, claudeResult);

      // Si la app necesita pagos y el usuario tiene Stripe Connect, crear productos automáticamente
      if (appData.requiresPayments && appData.stripeProducts?.length > 0) {
        console.log("💳 Creando productos en Stripe para app:", app.id);
        try {
          const { stripeConnectService } = await import('./stripeConnectService.js');
          const userResult = await query(
            'SELECT stripe_account_id, stripe_charges_enabled FROM users WHERE id = $1',
            [userId]
          );
          const stripeAccountId = userResult.rows[0]?.stripe_account_id;
          if (stripeAccountId && userResult.rows[0]?.stripe_charges_enabled) {
            const created = await stripeConnectService.createProductsForUser(
              stripeAccountId,
              appData.stripeProducts
            );
            await query(
              `UPDATE apps SET stripe_account_id = $1, stripe_products = $2, stripe_price_ids = $3 WHERE id = $4`,
              [stripeAccountId, JSON.stringify(created), JSON.stringify(created.map(p => p.price_id)), app.id]
            );
            console.log(`✅ ${created.length} productos Stripe creados para app ${app.id}`);
            app.stripeProducts = created;
          } else {
            console.log('⚠️ Usuario sin Stripe Connect activo, productos no creados');
            app.needsStripeConnect = true;
          }
        } catch (stripeError) {
          console.error('⚠️ Error creando productos Stripe (no bloqueante):', stripeError.message);
        }
      }

      return { success: true, app };

    } catch (error) {
      console.error(`❌ Error en generación:`, error);
      return await this.useFallbackTemplate(userId, appData, error.message);
    }
  }

  async saveApp(userId, appData, code, claudeResult) {
    return await transaction(async (client) => {
      const appResult = await client.query(
        `INSERT INTO apps (
          user_id, name, description, prompt, tech_stack, status,
          google_apis, requires_payments, stripe_price_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          userId,
          appData.name,
          appData.description,
          appData.description,
          JSON.stringify({ style: appData.style, colors: appData.colors }),
          'ready',
          appData.googleApis || [],
          appData.requiresPayments || false,
          appData.stripePriceIds || null
        ]
      );

      const app = appResult.rows[0];
      const fullProject = this.createProjectStructure(appData.name, code, appData.googleApis || [], appData.requiresPayments || false);

      await client.query(
        `INSERT INTO app_versions (app_id, version, code, generation_prompt, generation_time_ms, tokens_used)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          app.id, 1, JSON.stringify(fullProject),
          appData.description,
          claudeResult.duration || 0,
          claudeResult.tokensUsed || 0
        ]
      );

      return app;
    });
  }

  createProjectStructure(appName, appCode, googleApis = [], requiresPayments = false) {
    return {
      frontend: {
        files: [
          {
            path: 'package.json',
            content: JSON.stringify({
              name: appName.toLowerCase().replace(/\s+/g, '-'),
              version: '1.0.0',
              type: 'module',
              scripts: {
                dev: 'vite',
                build: 'vite build',
                preview: 'vite preview'
              },
              dependencies: {
                react: '^18.2.0',
                'react-dom': '^18.2.0'
              },
              devDependencies: {
                vite: '^5.0.0',
                '@vitejs/plugin-react': '^4.2.0',
                tailwindcss: '^3.4.0',
                autoprefixer: '^10.4.0',
                postcss: '^8.4.0'
              }
            }, null, 2)
          },
          {
            path: 'vite.config.js',
            content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000, open: true }
})`
          },
          {
            path: 'tailwind.config.js',
            content: `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`
          },
          {
            path: 'postcss.config.js',
            content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`
          },
          {
            path: 'index.html',
            content: `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
    ${requiresPayments ? '<script src="https://js.stripe.com/v3/"></script>' : ''}
    ${googleApis.includes('Maps') || googleApis.includes('maps') ? `<script src="https://maps.googleapis.com/maps/api/js?key=${process.env.GOOGLE_API_KEY}&libraries=places"></script>` : ''}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`
          },
          {
            path: 'src/main.jsx',
            content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`
          },
          {
            path: 'src/index.css',
            content: `@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Smooth scrolling */
html {
  scroll-behavior: smooth;
}

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: #f1f5f9;
}
::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}`
          },
          {
            path: 'src/App.jsx',
            content: appCode
          }
        ]
      }
    };
  }

  async useFallbackTemplate(userId, appData, errorMessage) {
    console.log(`📦 Usando fallback para usuario ${userId}: ${errorMessage}`);

    const fallbackCode = `import React from 'react';

export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, sans-serif'
    }}>
      <div style={{
        textAlign: 'center',
        padding: '3rem',
        background: 'white',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        maxWidth: '500px',
        margin: '20px'
      }}>
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🚀</div>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.5rem' }}>
          ${appData.name}
        </h1>
        <p style={{ fontSize: '1.1rem', color: '#64748b', marginBottom: '2rem' }}>
          ${appData.description || 'Tu aplicacion esta siendo preparada'}
        </p>
        <div style={{
          padding: '1rem 2rem',
          background: 'linear-gradient(135deg, #667eea, #764ba2)',
          color: 'white',
          borderRadius: '8px',
          fontWeight: '600'
        }}>
          Generando tu app...
        </div>
      </div>
    </div>
  );
}`;

    const fallbackProject = this.createProjectStructure(appData.name, fallbackCode);
    const app = await this.saveApp(userId, appData, fallbackProject, { duration: 0, tokensUsed: 0 });

    return { success: true, app, fallbackUsed: true };
  }
}

export const appGenerator = new AppGenerator();