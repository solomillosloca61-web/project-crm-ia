import { supabase } from './supabase';

const defaultWpPrompt = 'Eres Valentina, asesora comercial de MP Salud. Estás chateando por WhatsApp con un lead. Tu tono es amigable, profesional y muy argentino (usando voseo rioplatense: "che", "tenés", "comunicate", etc.). Tu objetivo es asesorar sobre los planes de salud, resolver dudas y agendar una llamada o video-auditoría con un asesor humano.';
const defaultKnowledge = '- MP Salud ofrece planes individuales, familiares y corporativos.\n- Cobertura nacional en clínicas de primer nivel.\n- Precios competitivos y promociones por traspaso de obra social.';
const brainHeader = '\n\n### REGLAS Y DATOS ADICIONALES (CEREBRO DINÁMICO)\n';

/**
 * Configura la llamada a OpenRouter con el modelo y la clave del .env.
 */
export async function callAI(payload: any): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  // 1. Cargar la configuración del cerebro desde Supabase para armar el prompt del sistema
  let wpPrompt = defaultWpPrompt;
  let knowledge = defaultKnowledge;
  let facts = '';

  try {
    const { data: dbSettings, error: dbError } = await supabase
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
  } catch (e) {
    console.warn('Fallo leyendo tabla ai_brain, usando configuraciones por defecto:', e);
  }

  let systemPrompt = `${wpPrompt}\n\n### BASE DE CONOCIMIENTO:\n${knowledge}`;
  if (facts.trim()) {
    systemPrompt += `\n\n### HECHOS APRENDIDOS ADICIONALES:\n${facts}`;
  }

  // 2. Cargar contexto del cliente actual si tenemos un conversationId
  if (payload?.conversationId) {
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('contact_id')
        .eq('id', payload.conversationId)
        .single();

      if (conv?.contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', conv.contact_id)
          .single();

        if (contact) {
          systemPrompt += `\n\n### CONTEXTO DEL CLIENTE ACTUAL:\n- Nombre: ${contact.name || 'Desconocido'}\n- Teléfono: ${contact.phone}\n- Score de interés: ${contact.score || 0} pts\n- Estado de venta: ${contact.status || 'nuevo'}\n- Notas previas: ${contact.notes || 'Ninguna'}`;
        }
      }
    } catch (e) {
      console.error('Error fetching client context for AI:', e);
    }
  }

  let messages: { role: string; content: string }[] = [];

  if (payload?.conversationId) {
    // Cargar el historial desde Supabase para tener contexto real de la conversación
    const { data: dbMessages, error } = await supabase
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

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages
    ]
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('OpenRouter error', response.status, err);
    return 'Hola. Gracias por contactarte con MP Salud. Estamos procesando tu consulta y un asesor te responderá a la brevedad.';
  }

  try {
    const data = await response.json();
    if (data.error) {
      console.error('OpenRouter API returned error JSON:', data.error);
    }
    const reply = data?.choices?.[0]?.message?.content ?? '';
    if (!reply) {
      console.warn('OpenRouter choices or content is empty. Full response:', JSON.stringify(data));
    }
    return reply || 'Hola. Gracias por escribirnos, un asesor se comunicará contigo pronto.';
  } catch (parseError) {
    console.error('Error parseando respuesta de OpenRouter:', parseError);
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
    console.error('Vapi API credentials missing in environment.');
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

    const parts = currentPrompt.split(brainHeader);
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

    console.log('Successfully synchronized Vapi assistant with new brain settings!');
    return true;
  } catch (error) {
    console.error('Error synchronizing Vapi assistant:', error);
    return false;
  }
}

/**
 * Analiza una transcripción de llamada usando OpenRouter para extraer hechos comerciales generales de MP Salud.
 * Si encuentra nueva información, la añade a learned_facts y sincroniza Vapi.
 */
export async function autoLearnFromCall(transcript: string): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';

  if (!apiKey || !transcript.trim()) {
    return;
  }

  try {
    const systemPrompt = `Eres el cerebro analítico del CRM de MP Salud. Tu tarea es analizar la transcripción de una llamada de venta reciente y extraer HECHOS comerciales generales sobre MP Salud que hayan sido mencionados en la llamada por el cliente o el asesor, y que resulten útiles como información general del negocio (ej. coberturas, clínicas, promociones, reglas comerciales).
    
Reglas:
1. Si no hay hechos nuevos o importantes que no estén ya en la base de conocimiento general, devuelve la palabra "NINGUNO".
2. No extraigas hechos personales del cliente (ej. que Juan Pérez se afilió). Extrae solo hechos organizacionales o del producto de MP Salud.
3. Devuelve los hechos en forma de lista corta con viñetas.
4. Responde de forma muy concisa. Si no hay nada comercial de valor, di exactamente "NINGUNO".`;

    const userPrompt = `Analizá esta transcripción de llamada:\n\n${transcript}\n\nExtraé nuevos hechos o reglas comerciales generales sobre MP Salud:`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API failed: ${response.status}`);
    }

    const data = await response.json();
    const extracted = (data?.choices?.[0]?.message?.content ?? '').trim();

    if (extracted && extracted !== 'NINGUNO') {
      console.log('Nuevos hechos comerciales aprendidos:', extracted);

      // Cargar hechos actuales
      let currentFacts = '';
      let knowledgeBase = defaultKnowledge;

      const { data: dbSettings } = await supabase
        .from('ai_brain')
        .select('key, value');

      if (dbSettings) {
        const factsVal = dbSettings.find(s => s.key === 'learned_facts')?.value;
        const knVal = dbSettings.find(s => s.key === 'knowledge_base')?.value;
        if (factsVal) currentFacts = factsVal;
        if (knVal) knowledgeBase = knVal;
      }

      // Combinar hechos
      const updatedFacts = currentFacts
        ? `${currentFacts}\n${extracted}`.trim()
        : extracted;

      // Guardar en la DB
      await supabase
        .from('ai_brain')
        .upsert(
          { key: 'learned_facts', value: updatedFacts },
          { onConflict: 'key' }
        );

      // Sincronizar Vapi
      await syncVapiAssistant(knowledgeBase, updatedFacts);
    } else {
      console.log('No se detectaron nuevos hechos comerciales generales en esta llamada.');
    }
  } catch (error) {
    console.error('Error in autoLearnFromCall:', error);
  }
}
