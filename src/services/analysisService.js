/**
 * Servicio de análisis con Claude
 * Maneja la conversación y detección de confirmación
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const CHAT_SYSTEM_PROMPT = `Eres Claude, un asistente experto en desarrollo de aplicaciones.

INSTRUCCIÓN CRÍTICA - FORMATO OBLIGATORIO:

Cuando el usuario CONFIRME (diga "ok", "listo", "genera", "dale", "sí", "está bien", "perfecto", "adelante"), DEBES responder EXACTAMENTE así:

[CONFIRMADO]
Breve resumen aquí...
{"name":"Nombre","description":"Descripción completa de todo lo que se debe crear","modules":[{"name":"Módulo","description":"Descripción detallada","priority":"alta"}],"complexity":"media","googleApis":[],"fileSpecs":[]}

REGLAS:
1. La primera línea debe ser SOLO [CONFIRMADO]
2. Segunda línea: resumen breve
3. Tercera línea: EL JSON COMPLETO EN UNA SOLA LÍNEA
4. NO agregues texto después del JSON
5. EL JSON ES OBLIGATORIO
6. La "description" del JSON debe ser DETALLADA - incluye todo lo que el usuario pidió

Mientras el usuario NO confirme, haz preguntas para entender bien qué necesita.`;

export async function conversationRefinement(message, history = []) {
  try {
    const messages = history.map(m => ({
      role: m.role,
      content: m.content
    }));

    messages.push({ role: 'user', content: message });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: CHAT_SYSTEM_PROMPT,
      messages: messages
    });

    const content = response.content[0].text;
    
    const isConfirmed = content.includes('[CONFIRMADO]');
    
    let analysis = null;
    let cleanMessage = content;
    
    // Buscar JSON
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonString = content.substring(firstBrace, lastBrace + 1);
      cleanMessage = content.substring(0, firstBrace).replace('[CONFIRMADO]', '').trim();
      
      try {
        analysis = JSON.parse(jsonString);
        console.log('✅ JSON OK:', JSON.stringify(analysis, null, 2));
      } catch (e) {
        console.error('❌ JSON inválido:', jsonString.substring(0, 200));
      }
    }

    // Si confirmó pero no hay JSON válido, construir desde la conversación
    if (isConfirmed && !analysis) {
      console.log('⚠️ Confirmado sin JSON - construyendo desde conversación');
      
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
      
      console.log('✅ Análisis construido desde conversación:', userMessages.substring(0, 200));
    }

    return {
      success: true,
      message: cleanMessage || (isConfirmed ? "Confirmado" : ""),
      confirmed: isConfirmed,
      analysis: analysis,
      ready: isConfirmed || analysis !== null,
      summary: isConfirmed ? cleanMessage : null,
      googleApis: analysis?.googleApis || [],
      fileSpecs: analysis?.fileSpecs || [],
      tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens
    };

  } catch (error) {
    console.error('❌ Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}