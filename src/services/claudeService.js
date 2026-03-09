/**
 * Servicio de integración con Claude API
 * Genera apps fullstack (frontend + backend) según complejidad
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const BACKEND_KEYWORDS = [
  'marketplace', 'tienda', 'ecommerce', 'e-commerce', 'shop', 'store',
  'pagos', 'payment', 'stripe', 'checkout',
  'base de datos', 'database', 'usuarios', 'users', 'registro', 'login', 'auth',
  'admin', 'panel', 'dashboard', 'reportes', 'reports',
  'inventario', 'inventory', 'ordenes', 'orders', 'pedidos',
  'api', 'backend', 'servidor', 'server',
  'qr', 'codigo qr', 'verificacion',
  'notificaciones', 'email', 'sms',
  'logistica', 'envio', 'shipping',
  'comision', 'vendedor', 'seller', 'comprador', 'buyer',
  'chat', 'mensajes', 'messages', 'tiempo real', 'real time',
  'roles', 'permisos', 'permissions',
  'upload', 'archivos', 'files', 'imagenes', 'images'
];

class ClaudeService {

  sanitizeCode(code) {
    return code
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u0060\uFF40]/g, '`')
      .replace(/^\uFEFF/, '');
  }

  extractCode(text) {
    const match = text.match(/```(?:jsx?|tsx?|javascript)?\n?([\s\S]*?)```/);
    const code = match ? match[1].trim() : text.trim();
    return this.sanitizeCode(code);
  }

  needsBackend(description) {
    const desc = description.toLowerCase();
    return BACKEND_KEYWORDS.some(keyword => desc.includes(keyword));
  }

  async generateWithStreaming(systemPrompt, userMessage) {
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text;
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens || 0;
      }
      if (event.type === 'message_start' && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens || 0;
      }
    }

    return { text: fullText, tokens: inputTokens + outputTokens };
  }

  async generateFrontend(description, options = {}) {
    const { style, colors, googleApis, requiresPayments, isFullstack, apiBaseUrl } = options;

    const colorBlock = colors ? `
PRIMARY COLOR: ${colors.primary}
SECONDARY COLOR: ${colors.secondary}
ACCENT COLOR: ${colors.accent}
BACKGROUND: ${colors.background}
SURFACE: ${colors.surface}
TEXT COLOR: ${colors.text}
Apply these colors using style={{}} inline throughout the entire app.` : '';

    const systemPrompt = `You are a world-class React developer and UI/UX designer. Generate a stunning, modern, professional web application.

DESIGN REQUIREMENTS (mandatory):
- Must look like a premium SaaS product or professional web app
- Beautiful navigation: logo + menu items + action button, with shadow
- Hero section with gradient background using the primary color
- Cards with depth: boxShadow, borderRadius 12-16px, hover effects
- Rich typography hierarchy: large bold titles (2-3rem), clear subtitles
- Gradient backgrounds on hero and key sections
- Color-coded badges and status chips
- Smooth transitions on all interactive elements
- Grid/flex layouts for data — never plain vertical lists
- At least 5-8 realistic mock data items per section
- Sidebar layout OR top nav depending on app type
- Icons using emoji where appropriate

STYLE THEME: ${style || 'modern'}
${colorBlock}

TECHNICAL RULES:
- Single file React component
- Start with: import React, { useState, useEffect } from 'react'
- End with closing } of App function — NEVER leave it open
- Use style={{}} for custom colors
- Use Tailwind for layout, spacing, typography
- CRITICAL: NEVER put accented chars inside JS template literals or backtick strings
- Accented chars ONLY inside JSX text nodes
- All JSX tags must be properly closed
${isFullstack ? `- This app connects to a REST API at ${apiBaseUrl || 'http://localhost:4000/api'}
- Use fetch() for all data operations
- Show loading states while fetching
- Handle API errors gracefully
- Use useEffect to load data on mount
- Include JWT token in headers: Authorization: Bearer token
- Show login/register forms that call the API
- After login, store token in localStorage` : ''}
${googleApis?.length ? `- Integrate Google APIs: ${googleApis.join(', ')}` : ''}
${requiresPayments ? `- PAYMENTS: Stripe loaded via script tag. Use window.Stripe('${process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY'}')` : ''}

Respond with ONLY the React code. No markdown, no explanations. Start with: import React`;

    const result = await this.generateWithStreaming(systemPrompt, description);
    return { text: result.text, tokens: result.tokens };
  }

  async generateBackend(description, options = {}) {
    const { requiresPayments, googleApis } = options;

    const systemPrompt = `You are an expert Node.js/Express backend developer. Generate a complete Express.js backend API.

REQUIREMENTS:
- Use Express.js with ES modules (import/export)
- Include all necessary routes for the described app
- Use JWT for authentication (jsonwebtoken package)
- Include middleware: cors, express.json, authentication
- Use in-memory storage (Map/Array) — no database setup needed
- Include proper error handling
- RESTful routes
- CORS for frontend at http://localhost:3000
${requiresPayments ? `- Include Stripe integration\n- Use process.env.STRIPE_SECRET_KEY` : ''}

STRUCTURE — single server.js file:
1. All imports at top
2. Express app setup with CORS and JSON middleware
3. In-memory data stores
4. Auth routes: POST /api/auth/register, POST /api/auth/login
5. All business logic routes
6. JWT auth middleware
7. Protected routes
8. app.listen(4000)

CRITICAL:
- Single file: server.js
- ES modules (import/export)
- Start with: import express from 'express'
- End with: app.listen(4000, ...)
- Include sample seed data

Respond with ONLY the server.js code. No markdown. Start with: import express`;

    const result = await this.generateWithStreaming(systemPrompt, `Generate backend API for:\n\n${description}`);
    return { text: result.text, tokens: result.tokens };
  }

  async generateApp(description, options = {}) {
    try {
      const { style, colors, googleApis, requiresPayments } = options;
      const startTime = Date.now();

      // ✅ FIX CRÍTICO: let en lugar de const para poder reasignar
      let isFullstack = this.needsBackend(description);

      console.log(`🔍 Tipo: ${isFullstack ? 'FULLSTACK' : 'FRONTEND'}`);

      let frontendCode, backendCode, totalTokens = 0;

      if (isFullstack) {
        console.log('⚙️ Generando frontend + backend en paralelo...');
        const [frontendResult, backendResult] = await Promise.all([
          this.generateFrontend(description, { style, colors, googleApis, requiresPayments, isFullstack: true }),
          this.generateBackend(description, { requiresPayments, googleApis })
        ]);

        frontendCode = this.extractCode(frontendResult.text);
        backendCode = this.extractCode(backendResult.text);
        totalTokens = frontendResult.tokens + backendResult.tokens;

        console.log(`✅ Frontend: ${frontendCode.split('\n').length} líneas`);
        console.log(`✅ Backend: ${backendCode.split('\n').length} líneas`);

        // ✅ Ahora funciona porque isFullstack es let
        if (!backendCode || backendCode.length < 100) {
          console.warn('⚠️ Backend inválido, solo frontend');
          isFullstack = false;
          backendCode = null;
        }

      } else {
        const frontendResult = await this.generateFrontend(description, { style, colors, googleApis, requiresPayments, isFullstack: false });
        frontendCode = this.extractCode(frontendResult.text);
        totalTokens = frontendResult.tokens;
        console.log(`✅ Frontend: ${frontendCode.split('\n').length} líneas`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Listo en ${elapsed}s — ${totalTokens} tokens`);

      // Validar frontend
      if (!frontendCode || !frontendCode.includes('export default') || frontendCode.length < 200) {
        console.error('❌ Frontend inválido, longitud:', frontendCode?.length);
        console.error('❌ Preview:', frontendCode?.substring(0, 300));
        return { success: false, error: 'Codigo frontend invalido' };
      }

      return {
        success: true,
        code: frontendCode,
        backendCode: isFullstack ? backendCode : null,
        isFullstack,
        tokensUsed: totalTokens,
        duration: Date.now() - startTime
      };

    } catch (error) {
      console.error('❌ Error en ClaudeService.generateApp:', error);
      return { success: false, error: error.message };
    }
  }

  async conversationRefinement(message, history = []) {
    try {
      const messages = history.map(m => ({ role: m.role, content: m.content }));
      messages.push({ role: 'user', content: message });

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        temperature: 0.5,
        system: `Eres Claude, un asistente experto en desarrollo de aplicaciones.

Cuando el usuario CONFIRME (diga "ok", "listo", "genera", "dale", "si", "esta bien", "perfecto", "adelante"), responde EXACTAMENTE asi:

[CONFIRMADO]
Breve resumen aqui...
{"name":"Nombre","description":"Descripcion completa y detallada de todo lo que se debe crear","modules":[{"name":"Modulo","description":"Descripcion detallada","priority":"alta"}],"complexity":"media","googleApis":[],"fileSpecs":[]}

REGLAS:
1. Primera linea: SOLO [CONFIRMADO]
2. Segunda linea: resumen breve
3. Tercera linea: JSON COMPLETO EN UNA SOLA LINEA
4. NO agregues texto despues del JSON
5. La description debe ser muy detallada

Mientras el usuario NO confirme, haz preguntas para entender que necesita.`,
        messages
      });

      const content = response.content[0].text;
      const isConfirmed = content.includes('[CONFIRMADO]');

      let analysis = null;
      let cleanMessage = content;

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1) {
        const jsonString = content.substring(firstBrace, lastBrace + 1);
        cleanMessage = content.substring(0, firstBrace).replace('[CONFIRMADO]', '').trim();
        try {
          analysis = JSON.parse(jsonString);
          console.log('✅ JSON OK:', JSON.stringify(analysis).substring(0, 200));
        } catch (e) {
          console.error('❌ JSON invalido');
        }
      }

      if (isConfirmed && !analysis) {
        const userMessages = history
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .concat(message)
          .join('. ');

        analysis = {
          name: null,
          description: userMessages,
          fullConversation: [...history, { role: 'user', content: message }]
            .map(m => `${m.role}: ${m.content}`)
            .join('\n'),
          googleApis: [],
          fileSpecs: []
        };
      }

      return {
        success: true,
        message: cleanMessage || (isConfirmed ? 'Confirmado' : ''),
        confirmed: isConfirmed,
        analysis,
        ready: isConfirmed || analysis !== null,
        summary: isConfirmed ? cleanMessage : null,
        googleApis: analysis?.googleApis || [],
        fileSpecs: analysis?.fileSpecs || [],
        tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

const claudeService = new ClaudeService();
export default claudeService;