// C:\Users\lucia\PROJECT_CRM_IA\src\lib\ai.ts
import { supabaseService } from './supabase';
import { logger } from './logger';

function cleanAiReply(reply: string): string {
  if (!reply) return '';
  return reply
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // Elimina el proceso de pensamiento de DeepSeek R1/otros
    .replace(/<\/?[a-zA-Z_0-9-]+>/gi, '') // Elimina etiquetas XML/HTML como </assistant>, <model>, etc.
    .trim();
}


const defaultWpPrompt = 'Eres Valentina, asesora comercial de MP Salud. Estás chateando por WhatsApp con un lead. Tu tono es amigable, profesional y muy argentino (usando voseo rioplatense: "tenés", "comunicate", etc., pero NUNCA uses la palabra "che" porque no suena profesional). Tu objetivo es asesorar sobre los planes de salud, resolver dudas y agendar una llamada o video-auditoría con un asesor humano.';
const defaultKnowledge = '- MP Salud ofrece planes individuales, familiares y corporativos.\n- Cobertura nacional en clínicas de primer nivel.\n- Precios competitivos y promociones por traspaso de obra social.';
const brainHeader = '\n\n### REGLAS Y DATOS ADICIONALES (CEREBRO DINÁMICO)\n';

/**
 * Configura la llamada a OpenRouter con el modelo y la clave del .env.
 */
/**
 * Helper to call Google Gemini API directly when GEMINI_API_KEY is available.
 */
async function callGeminiDirect(systemPrompt: string, messages: { role: string; content: string }[], apiKey: string): Promise<string> {
  const contents: any[] = [];
  let lastRole = '';

  for (const msg of messages) {
    let role = msg.role;
    if (role === 'system') continue;
    if (role === 'assistant') role = 'model';

    // Ensure alternating roles
    if (contents.length > 0 && role === lastRole) {
      contents[contents.length - 1].parts[0].text += `\n${msg.content}`;
    } else {
      contents.push({
        role,
        parts: [{ text: msg.content }]
      });
      lastRole = role;
    }
  }

  // Gemini requires starting with user message
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({
      role: 'user',
      parts: [{ text: 'Hola' }]
    });
  }

  if (contents.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hola' }]
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents,
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 1.0
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return cleanAiReply(text);
}

/**
 * Configura la llamada a OpenRouter con el modelo y la clave del .env o directamente a Gemini si hay clave de Gemini.
 */
export async function callAI(payload: any): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';

  // 1. Cargar la configuración del cerebro desde Supabase para armar el prompt del sistema
  let wpPrompt = defaultWpPrompt;
  let knowledge = defaultKnowledge;
  let facts = '';

  try {
    const { data: dbSettings, error: dbError } = await supabaseService
      .from('ai_brain')
      .select('key, value');

    if (!dbError && dbSettings) {
      const wpVal = dbSettings.find(s => s.key === 'system_prompt_whatsapp')?.value;
      const knVal = dbSettings.find(s => s.key === 'knowledge_base')?.value;
      const fcVal = dbSettings.find(s => s.key === 'learned_facts')?.value;

      if (wpVal) wpPrompt = wpVal;
      if (knVal) knowledge = knVal;
      if (fcVal) facts = fcVal;
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Fallo leyendo tabla ai_brain, usando configuraciones por defecto');
  }

  let systemPrompt = `${wpPrompt}\n\n### BASE DE CONOCIMIENTO:\n${knowledge}`;
  if (facts.trim()) {
    systemPrompt += `\n\n### HECHOS APRENDIDOS ADICIONALES Y CORRECCIONES:\n${facts}`;
  }

  // 2. Cargar contexto del cliente actual si tenemos un conversationId
  if (payload?.conversationId) {
    try {
      const { data: conv } = await supabaseService
        .from('conversations')
        .select('contact_id')
        .eq('id', payload.conversationId)
        .single();

      if (conv?.contact_id) {
        const { data: contact } = await supabaseService
          .from('contacts')
          .select('*')
          .eq('id', conv.contact_id)
          .single();

        if (contact) {
          systemPrompt += `\n\n### CONTEXTO DEL CLIENTE ACTUAL:\n- Nombre: ${contact.name || 'Desconocido'}\n- Teléfono: ${contact.phone}\n- Score de interés: ${contact.score || 0} pts\n- Estado de venta: ${contact.status || 'nuevo'}\n- Notas previas: ${contact.notes || 'Ninguna'}`;
        }
      }
    } catch (e: any) {
      logger.error({ err: e.message }, 'Error fetching client context for AI');
    }
  }

  let messages: { role: string; content: string }[] = [];

  if (payload?.conversationId) {
    // Cargar el historial desde Supabase para tener contexto real de la conversación
    const { data: dbMessages, error } = await supabaseService
      .from('messages')
      .select('role, content')
      .eq('conversation_id', payload.conversationId)
      .order('created_at', { ascending: true })
      .limit(15);

    if (!error && dbMessages) {
      messages = dbMessages.map((m: any) => ({
        role: m.role,
        content: m.content
      }));
    }
  } else if (payload?.customPrompt) {
    // Sobrecarga libre para tareas programadas (followups)
    messages = [
      { role: 'user', content: payload.customPrompt }
    ];
  } else {
    // Fallbacks de parsing del webhook payload
    const entryMessages = payload?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (entryMessages && Array.isArray(entryMessages) && entryMessages.length > 0) {
      messages = entryMessages.map((msg: any) => ({
        role: 'user',
        content: msg.text?.body ?? ''
      }));
    } else {
      messages = (payload?.messages ?? []).map((msg: any) => ({
        role: msg.from?.type === 'business' ? 'assistant' : 'user',
        content: msg.text?.body ?? ''
      }));
    }
  }

  // Si hay GEMINI_API_KEY, usar directamente la API de Google Gemini para evitar cargos de OpenRouter
  if (geminiApiKey) {
    try {
      logger.info('Calling Google Gemini API directly...');
      const reply = await callGeminiDirect(systemPrompt, messages, geminiApiKey);
      return reply || 'Hola. Gracias por escribirnos, un asesor se comunicará contigo pronto.';
    } catch (geminiErr: any) {
      logger.error({ err: geminiErr.message }, 'Error calling Google Gemini directly, falling back to OpenRouter...');
    }
  }

  if (!openRouterApiKey) {
    throw new Error('Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is set');
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ],
    max_tokens: 1000 // Limitar tokens máximos estimados para no fallar con error 402 en cuentas de bajo balance
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openRouterApiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ status: response.status, err }, 'OpenRouter error');
    return 'Hola. Gracias por contactarte con MP Salud. Estamos procesando tu consulta y un asesor te responderá a la brevedad.';
  }

  try {
    const data = await response.json();
    if (data.error) {
      logger.error({ err: data.error }, 'OpenRouter API returned error JSON');
    }
    const reply = data?.choices?.[0]?.message?.content ?? '';
    if (!reply) {
      logger.warn({ data }, 'OpenRouter choices or content is empty');
    }
    return cleanAiReply(reply) || 'Hola. Gracias por escribirnos, un asesor se comunicará contigo pronto.';
  } catch (parseError: any) {
    logger.error({ err: parseError.message }, 'Error parseando respuesta de OpenRouter');
    return 'Hola. Gracias por contactarte con MP Salud. Estamos procesando tu consulta y te responderemos pronto.';
  }
}

/**
 * Sincroniza el prompt del asistente de Vapi acoplando la base de conocimiento y los hechos aprendidos.
 * Preserva el prompt original solicitado por el jefe al principio del texto.
 */
export async function syncVapiAssistant(knowledgeBase: string, learnedFacts: string): Promise<boolean> {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (!apiKey || !assistantId) {
    logger.error('Vapi API credentials missing in environment.');
    return false;
  }

  try {
    // 1. Obtener la configuración actual del asistente
    const getRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (!getRes.ok) {
      throw new Error(`Failed to GET assistant from Vapi: ${getRes.status} ${await getRes.text()}`);
    }

    const assistant = await getRes.json();
    if (!assistant.model || !assistant.model.messages) {
      throw new Error('Vapi assistant object is missing model or model.messages.');
    }

    // 2. Extraer el prompt original y limpiar el bloque dinámico previo
    let updatedMessages = [...assistant.model.messages];
    const systemMsgIdx = updatedMessages.findIndex((m: any) => m.role === 'system');

    let currentPrompt = '';
    if (systemMsgIdx !== -1) {
      currentPrompt = updatedMessages[systemMsgIdx].content || '';
    }

    const splitRegex = /\r?\n\r?\n### REGLAS Y DATOS ADICIONALES \(CEREBRO DINÁMICO\)\r?\n/;
    const parts = currentPrompt.split(splitRegex);
    const originalPrompt = parts[0].trim();

    // 3. Crear el nuevo prompt añadiendo las reglas dinámicas
    const newRules = `${knowledgeBase}\n\n${learnedFacts}`.trim();
    const newPrompt = newRules ? `${originalPrompt}${brainHeader}${newRules}` : originalPrompt;

    if (systemMsgIdx !== -1) {
      updatedMessages[systemMsgIdx] = {
        ...updatedMessages[systemMsgIdx],
        content: newPrompt
      };
    } else {
      updatedMessages.unshift({
        role: 'system',
        content: newPrompt
      });
    }

    // 4. Realizar el PATCH a Vapi
    const patchBody = {
      model: {
        ...assistant.model,
        messages: updatedMessages
      }
    };

    const patchRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patchBody)
    });

    if (!patchRes.ok) {
      throw new Error(`Failed to PATCH assistant on Vapi: ${patchRes.status} ${await patchRes.text()}`);
    }

    logger.info('Successfully synchronized Vapi assistant with new brain settings!');
    return true;
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error synchronizing Vapi assistant');
    return false;
  }
}

/**
 * Sincroniza el prompt del asistente conversacional de ElevenLabs en su API oficial.
 */
export async function syncElevenLabsAgent(knowledgeBase: string, learnedFacts: string): Promise<boolean> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    logger.info('ElevenLabs API credentials missing in environment, skipping ElevenLabs agent sync.');
    return false;
  }

  try {
    let wpPrompt = defaultWpPrompt;
    try {
      const { data: dbSettings } = await supabaseService
        .from('ai_brain')
        .select('key, value');

      if (dbSettings) {
        const wpVal = dbSettings.find(s => s.key === 'system_prompt_whatsapp')?.value;
        if (wpVal) wpPrompt = wpVal;
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Failed reading system_prompt_whatsapp for ElevenLabs sync');
    }

    const fullPrompt = `${wpPrompt}\n\n### BASE DE CONOCIMIENTO:\n${knowledgeBase}\n\n### HECHOS Y REGLAS ADICIONALES:\n${learnedFacts}`.trim();

    const url = `https://api.elevenlabs.io/v1/convai/agents/${agentId}`;
    
    const patchBody = {
      conversation_config: {
        agent: {
          prompt: {
            prompt: fullPrompt
          }
        }
      }
    };

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patchBody)
    });

    if (!response.ok) {
      throw new Error(`Failed to PATCH ElevenLabs agent: ${response.status} ${await response.text()}`);
    }

    logger.info('Successfully synchronized ElevenLabs voice agent with new brain settings!');
    return true;
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error synchronizing ElevenLabs agent');
    return false;
  }
}

/**
 * Analiza una transcripción de llamada usando OpenRouter para extraer hechos comerciales generales de MP Salud
 * y lecciones aprendidas (correcciones de errores) a fin de que Valentina aprenda de forma continua.
 * Si encuentra nueva información, la añade a learned_facts y sincroniza Vapi.
 */
export async function autoLearnFromCall(transcript: string): Promise<void> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';

  if (!transcript.trim()) {
    return;
  }

  try {
    const systemPrompt = `Eres el cerebro analítico y de control de calidad del CRM de MP Salud. Tu tarea es analizar la transcripción de una llamada de venta reciente para:
1. Extraer HECHOS comerciales generales sobre MP Salud (ej. coberturas, clínicas, promociones, reglas comerciales).
2. Extraer LECCIONES APRENDIDAS o CORRECCIONES basadas en los errores que haya cometido Valentina en la llamada (ej. si interrumpió al cliente, si no manejó bien una objeción, si dio un precio erróneo o si usó un tono inadecuado). Traduce esto en una regla de conducta para el futuro.

Reglas:
- Si no hay hechos nuevos ni errores cometidos que corregir, devuelve exactamente la palabra "NINGUNO".
- No extraigas hechos personales del cliente (ej. que Juan Pérez se afilió). Extrae solo hechos generales del producto de MP Salud o reglas de comportamiento para el asistente.
- Devuelve la información como viñetas claras y cortas (ej. "- Corrección: Cuando el cliente dice que no tiene dinero, recalcar de inmediato que el traspaso de aportes es sin costo extra y no intentar vender otro plan directamente").
- Responde de forma muy concisa. Si no hay nada comercial o de comportamiento de valor, responde exactamente "NINGUNO".`;

    const userPrompt = `Analizá esta transcripción de llamada:\n\n${transcript}\n\nExtraé nuevos hechos o reglas de corrección de conducta para Valentina:`;

    let extracted = '';

    if (geminiApiKey) {
      try {
        logger.info('Calling Google Gemini API directly for autoLearnFromCall...');
        extracted = await callGeminiDirect(systemPrompt, [{ role: 'user', content: userPrompt }], geminiApiKey);
      } catch (geminiErr: any) {
        logger.error({ err: geminiErr.message }, 'Gemini API call failed in autoLearnFromCall, falling back to OpenRouter...');
      }
    }

    if (!extracted && openRouterApiKey) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterApiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          max_tokens: 800 // Limitar tokens máximos estimados
        })
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API failed: ${response.status}`);
      }

      const data = await response.json();
      extracted = (data?.choices?.[0]?.message?.content ?? '').trim();
    }

    const cleanExtracted = extracted.replace(/[.\s]/g, '').toUpperCase();

    if (extracted && cleanExtracted !== 'NINGUNO') {
      logger.info({ extracted }, 'Nuevos hechos comerciales y correcciones aprendidas de la llamada');

      // Cargar hechos actuales
      let currentFacts = '';
      let knowledgeBase = defaultKnowledge;

      const { data: dbSettings } = await supabaseService
        .from('ai_brain')
        .select('key, value');

      if (dbSettings) {
        const factsVal = dbSettings.find(s => s.key === 'learned_facts')?.value;
        const knVal = dbSettings.find(s => s.key === 'knowledge_base')?.value;
        if (factsVal) currentFacts = factsVal;
        if (knVal) knowledgeBase = knVal;
      }

      // Combinar hechos y lecciones
      const updatedFacts = currentFacts
        ? `${currentFacts}\n${extracted}`.trim()
        : extracted;

      // Guardar en la DB
      await supabaseService
        .from('ai_brain')
        .upsert(
          { key: 'learned_facts', value: updatedFacts },
          { onConflict: 'key' }
        );

      // Sincronizar Vapi y ElevenLabs
      await syncVapiAssistant(knowledgeBase, updatedFacts);
      await syncElevenLabsAgent(knowledgeBase, updatedFacts);
    } else {
      logger.info('No se detectaron nuevos hechos comerciales ni errores a corregir en esta llamada.');
    }
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error in autoLearnFromCall');
  }
}
