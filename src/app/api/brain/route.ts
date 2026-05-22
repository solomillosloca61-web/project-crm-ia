// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\brain\route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { syncVapiAssistant } from '@/lib/ai';

const defaultWpPrompt = 'Eres Valentina, asesora comercial de MP Salud. Estás chateando por WhatsApp con un lead. Tu tono es amigable, profesional y muy argentino (usando voseo rioplatense: "che", "tenés", "comunicate", etc.). Tu objetivo es asesorar sobre los planes de salud, resolver dudas y agendar una llamada o video-auditoría con un asesor humano.';
const defaultKnowledge = '- MP Salud ofrece planes individuales, familiares y corporativos.\n- Cobertura nacional en clínicas de primer nivel.\n- Precios competitivos y promociones por traspaso de obra social.';

export async function GET() {
  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  let dbSettings: any[] | null = null;
  let dbMissing = false;

  // 1. Intentar cargar desde Supabase
  try {
    const { data, error } = await supabase
      .from('ai_brain')
      .select('key, value');

    if (error) {
      console.warn('Error reading from ai_brain table:', error);
      dbMissing = true;
    } else {
      dbSettings = data;
    }
  } catch (e) {
    console.warn('Supabase not reachable or table missing:', e);
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
        const parts = fullPrompt.split('\n\n### REGLAS Y DATOS ADICIONALES (CEREBRO DINÁMICO)\n');
        systemPromptVapi = parts[0].trim();
      } else {
        console.warn(`Could not fetch Vapi assistant. Status: ${getRes.status}`);
      }
    } catch (err) {
      console.error('Error fetching Vapi assistant details:', err);
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

    const { error } = await supabase
      .from('ai_brain')
      .upsert(upsertRows, { onConflict: 'key' });

    if (error) {
      throw new Error(`Failed to upsert in Supabase: ${error.message}`);
    }

    // 2. Sincronizar el asistente de Vapi inmediatamente
    const syncSuccess = await syncVapiAssistant(knowledge_base || '', learned_facts || '');

    return NextResponse.json({ success: true, syncSuccess });
  } catch (error: any) {
    console.error('Error in POST /api/brain:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
