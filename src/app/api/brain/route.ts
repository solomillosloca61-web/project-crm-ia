// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\brain\route.ts
import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { syncVapiAssistant, syncElevenLabsAgent } from '@/lib/ai';
import { logger } from '@/lib/logger';

const defaultWpPrompt = 'Eres Valentina, asesora comercial de MP Salud. Estás chateando por WhatsApp con un lead. Tu tono es amigable, profesional y muy argentino (usando voseo rioplatense: "tenés", "comunicate", etc.). Tu objetivo es asesorar sobre los planes de salud, resolver dudas y agendar una llamada o video-auditoría con un asesor humano.';
const defaultKnowledge = '- MP Salud ofrece planes individuales, familiares y corporativos.\n- Cobertura nacional en clínicas de primer nivel.\n- Precios competitivos y promociones por traspaso de obra social.';

export async function GET() {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  let dbSettings: any[] | null = null;
  let dbMissing = false;

  // 1. Intentar cargar desde Supabase
  try {
    const { data, error } = await supabaseService
      .from('ai_brain')
      .select('key, value');

    if (error) {
      logger.warn({ err: error.message }, 'Error reading from ai_brain table');
      dbMissing = true;
    } else {
      dbSettings = data;
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, 'Supabase not reachable or table missing');
    dbMissing = true;
  }

  // Mapear valores o usar defaults
  const systemPromptWhatsapp = dbSettings?.find(s => s.key === 'system_prompt_whatsapp')?.value ?? defaultWpPrompt;
  const knowledgeBase = dbSettings?.find(s => s.key === 'knowledge_base')?.value ?? defaultKnowledge;
  const learnedFacts = dbSettings?.find(s => s.key === 'learned_facts')?.value ?? '';

  // 2. Intentar obtener el prompt del asistente original desde Vapi
  let systemPromptVapi = '';
  if (apiKey && assistantId) {
    try {
      const getRes = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      });

      if (getRes.ok) {
        const assistant = await getRes.json();
        const systemMsg = assistant?.model?.messages?.find((m: any) => m.role === 'system');
        const fullPrompt = systemMsg?.content || '';

        // Separar y quedarnos sólo con el original (limpiando el bloque dinámico)
        const splitRegex = /\r?\n\r?\n### REGLAS Y DATOS ADICIONALES \(CEREBRO DINÁMICO\)\r?\n/;
        const parts = fullPrompt.split(splitRegex);
        systemPromptVapi = parts[0].trim();
      } else {
        logger.warn({ status: getRes.status }, 'Could not fetch Vapi assistant');
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error fetching Vapi assistant details');
    }
  }

  return NextResponse.json({
    system_prompt_whatsapp: systemPromptWhatsapp,
    knowledge_base: knowledgeBase,
    learned_facts: learnedFacts,
    system_prompt_vapi: systemPromptVapi || 'Cargando prompt desde Vapi...',
    db_missing: dbMissing
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { system_prompt_whatsapp, knowledge_base, learned_facts } = body;

    // 1. Guardar o actualizar en Supabase
    const upsertRows = [
      { key: 'system_prompt_whatsapp', value: system_prompt_whatsapp || '' },
      { key: 'knowledge_base', value: knowledge_base || '' },
      { key: 'learned_facts', value: learned_facts || '' }
    ];

    const { error } = await supabaseService
      .from('ai_brain')
      .upsert(upsertRows, { onConflict: 'key' });

    if (error) {
      throw new Error(`Failed to upsert in Supabase: ${error.message}`);
    }

    // 2. Sincronizar Vapi y ElevenLabs inmediatamente
    const syncVapiSuccess = await syncVapiAssistant(knowledge_base || '', learned_facts || '');
    const syncElevenSuccess = await syncElevenLabsAgent(knowledge_base || '', learned_facts || '');
    const syncSuccess = syncVapiSuccess && syncElevenSuccess;

    return NextResponse.json({ success: true, syncSuccess });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error in POST /api/brain');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
