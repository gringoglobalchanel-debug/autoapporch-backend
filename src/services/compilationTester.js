/**
 * Servicio de prueba de compilación
 * Compila el código en un entorno aislado antes de desplegar
 */

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CompilationTester {
  async testCompilation(code, options = {}) {
    const testDir = path.join('/tmp', `test-${Date.now()}`);

    try {
      // Crear estructura de proyecto
      await this.createProjectStructure(testDir, code);

      // Ejecutar pruebas de compilación
      const result = await this.runCompilationTests(testDir);

      return {
        success: result.success,
        errors: result.errors,
        warnings: result.warnings,
        duration: result.duration,
        score: result.success ? 100 : Math.max(0, 50 - (result.errors.length * 10))
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        errors: [error.message],
        warnings: [],
        duration: 0,
        score: 0
      };
    } finally {
      // Limpiar archivos temporales
      if (!options.keepFiles) {
        await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async createProjectStructure(testDir, code) {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'src'), { recursive: true });

    // Escribir App.jsx
    await fs.writeFile(path.join(testDir, 'src', 'App.jsx'), code);

    // Escribir package.json
    await fs.writeFile(path.join(testDir, 'package.json'), JSON.stringify({
      name: 'test-app',
      version: '1.0.0',
      type: 'module',
      scripts: {
        build: 'vite build'
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        vite: '^5.0.0',
        '@vitejs/plugin-react': '^4.2.0'
      }
    }, null, 2));

    // Escribir vite.config.js
    await fs.writeFile(path.join(testDir, 'vite.config.js'), `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    minify: true,
    sourcemap: false
  }
})
    `);

    // Escribir index.html
    await fs.writeFile(path.join(testDir, 'index.html'), `
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
    `);

    // Escribir main.jsx
    await fs.writeFile(path.join(testDir, 'src', 'main.jsx'), `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
    `);
  }

  async runCompilationTests(testDir) {
    const startTime = Date.now();

    try {
      // Instalar dependencias
      await execAsync('npm install', { cwd: testDir });

      // Ejecutar build
      const { stderr } = await execAsync('npm run build', { cwd: testDir });

      const errors = this.parseErrors(stderr);
      const warnings = this.parseWarnings(stderr);

      return {
        success: errors.length === 0,
        errors,
        warnings,
        duration: Date.now() - startTime
      };

    } catch (error) {
      const errors = this.parseErrors(error.stderr || error.message);
      const warnings = this.parseWarnings(error.stderr || '');

      return {
        success: false,
        errors,
        warnings,
        duration: Date.now() - startTime
      };
    }
  }

  parseErrors(stderr) {
    const errors = [];
    const errorPatterns = [
      /ERROR:?\s*(.+)/gi,
      /Failed to compile/g,
      /Unexpected token/g,
      /unexpected end of file/g
    ];

    const lines = stderr.split('\n');
    for (const line of lines) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          errors.push(line.trim());
          break;
        }
      }
    }

    return errors;
  }

  parseWarnings(stderr) {
    const warnings = [];
    const warningPatterns = [
      /Warning:?\s*(.+)/gi,
      /deprecated/g,
      /performance overhead/g
    ];

    const lines = stderr.split('\n');
    for (const line of lines) {
      for (const pattern of warningPatterns) {
        if (pattern.test(line)) {
          warnings.push(line.trim());
          break;
        }
      }
    }

    return warnings;
  }
}

// Exportación nombrada
export const compilationTester = new CompilationTester();