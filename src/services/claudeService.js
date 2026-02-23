/**
 * Servicio de integración con Claude API
 * Usa streaming para evitar truncamiento en apps grandes
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

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

  async generateApp(description, options = {}) {
    try {
      const { style, colors, googleApis, requiresPayments, stripePriceIds } = options;

      const colorBlock = colors ? `
PRIMARY COLOR (buttons, headers, key elements): ${colors.primary}
SECONDARY COLOR (hover states, borders): ${colors.secondary}
ACCENT COLOR (badges, highlights, CTAs): ${colors.accent}
BACKGROUND (page background): ${colors.background}
SURFACE (cards, panels, sidebars): ${colors.surface}
TEXT COLOR (main text): ${colors.text}
Apply these colors using style={{}} inline throughout the entire app.` : '';

      const systemPrompt = `You are a world-class React developer and UI/UX designer. Generate a stunning, modern, professional web application — NOT a basic HTML page.

DESIGN REQUIREMENTS (mandatory - this is the most important part):
- Must look like a premium SaaS product or professional web app
- Beautiful navigation: logo + menu items + action button, with shadow
- Hero section with gradient background using the primary color
- Cards with depth: use boxShadow, borderRadius 12-16px, hover effects
- Rich typography hierarchy: large bold titles (2-3rem), clear subtitles, body text
- Gradient backgrounds on hero and key sections
- Color-coded badges and status chips (rounded-full, small padding)
- Smooth transitions on all interactive elements (transition: 'all 0.2s ease')
- Grid/flex layouts for data — never plain vertical lists
- At least 5-8 realistic mock data items per section
- Beautiful empty states and action buttons
- Sidebar layout OR top nav depending on app type
- Icons using emoji where appropriate (🏠 📊 ✅ 🚀 etc)
- Section dividers, proper spacing, visual hierarchy

STYLE THEME: ${style || 'modern'}
${colorBlock}

TECHNICAL RULES:
- Single file React component
- Start with: import React, { useState, useEffect } from 'react'
- End with closing } of App function — NEVER leave it open
- Use style={{}} for the custom colors listed above
- Use Tailwind for layout, spacing, typography (flex, grid, p-4, text-xl, etc)
- CRITICAL: NEVER put accented chars (á,é,í,ó,ú,ñ) inside JS template literals or backtick strings
- Accented chars ONLY inside JSX text nodes: <span>Información</span> is OK
- Accented chars inside backticks: FORBIDDEN. Convert to plain text in JSX instead
- All JSX tags must be properly closed
- All template literals must be properly closed
${googleApis?.length ? `- Integrate Google APIs: ${googleApis.join(', ')}${googleApis.includes('Maps') || googleApis.includes('maps') ? `\n- For Google Maps: the API is already loaded via script tag in index.html. Use window.google.maps directly. Do NOT add another script tag. Example: new window.google.maps.Map(ref.current, { center: { lat: 40.7128, lng: -74.0060 }, zoom: 12 })` : ''}` : ''}
${requiresPayments ? `- PAYMENTS: Stripe is already loaded via script tag in index.html (Stripe.js v3). Use it like this: const stripe = window.Stripe(\'${process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY'}\'); - Create checkout buttons that call your backend /api/stripe/create-checkout - Show plan prices and a checkout button per plan - Handle success/cancel redirects` : ''}

Respond with ONLY the code. No markdown fences, no explanations. Start directly with: import React`;

      console.log('🌊 Generando con streaming...');
      const startTime = Date.now();

      const result = await this.generateWithStreaming(systemPrompt, description);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Streaming completado en ${elapsed}s - ${result.text.length} chars, ${result.tokens} tokens`);

      const code = this.extractCode(result.text);

      if (!code.includes('export default') || code.length < 200) {
        console.error('❌ Código inválido o muy corto');
        return { success: false, error: 'Codigo generado invalido' };
      }

      console.log(`✅ Código listo: ${code.split('\n').length} líneas`);

      return {
        success: true,
        code,
        tokensUsed: result.tokens
      };

    } catch (error) {
      console.error('Error en ClaudeService.generateApp:', error);
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