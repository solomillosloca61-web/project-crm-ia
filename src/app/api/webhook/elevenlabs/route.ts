// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\webhook\elevenlabs\route.ts
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

function classifyStatus(transcriptText: string, duration: number): string {
  if (!transcriptText || transcriptText === '(Sin transcripción)' || duration < 8) {
    return 'NO CONTESTÓ';
  }
  
  const lower = transcriptText.toLowerCase();
  
  if (
    lower.includes('no me interesa') || 
    lower.includes('no quiero') || 
    lower.includes('no llamen') || 
    lower.includes('borrame') || 
    lower.includes('estafa') || 
    lower.includes('no estoy interesado') ||
    lower.includes('sacame de la lista')
  ) {
    return 'RECHAZO CLARO';
  }
  
  if (
    lower.includes('precio') || 
    lower.includes('cuanto sale') || 
    lower.includes('cuánto sale') || 
    lower.includes('cuanto cuesta') || 
    lower.includes('cuánto cuesta') || 
    lower.includes('caro') || 
    lower.includes('plata') || 
    lower.includes('dinero') || 
    lower.includes('costo')
  ) {
    return 'OBJECIÓN PRECIO';
  }
  
  const hasObraSocial = /(osde|galeno|sancor|osecac|pami|ioma|medicus|swiss|prevencion|omint|obra social|prepaga)/i.test(lower);
  const hasCuil = /\b\d{2}[-.\s]?\d{8}[-.\s]?\d{1}\b/.test(lower) || /\b\d{11}\b/.test(lower);
  
  if (hasObraSocial || hasCuil) {
    return 'CORTÓ CON DATOS';
  }
  
  return 'POTENCIAL POSITIVO';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    logger.info({ eventType: body.type }, 'Recibido Webhook de ElevenLabs');

    // Validar tipo de evento. ElevenLabs Conversational AI post-call webhook usa type "post_call_transcription"
    if (body.type !== 'post_call_transcription') {
      logger.info({ type: body.type }, 'Ignorando evento ElevenLabs no post-call');
      return NextResponse.json({ success: true, message: 'Event ignored' });
    }

    const eventData = body.data || {};
    const conversationId = eventData.conversation_id || `el-${Date.now()}`;
    const metadata = eventData.metadata || {};
    const rawTranscript = eventData.transcript || [];

    // 1. Formatear la transcripción
    const transcriptText = rawTranscript.length > 0
      ? rawTranscript.map((t: any) => {
          const speaker = t.role === 'agent' || t.role === 'assistant' ? 'Valentina' : 'Cliente';
          return `${speaker}: ${t.message}`;
        }).join('\n')
      : '(Sin transcripción)';

    // 2. Extraer nombre y teléfono de los metadatos o variables dinámicas
    let phone = metadata.phone || metadata.tel || metadata.number || metadata.phone_number || '';
    let name = metadata.user_name || metadata.name || metadata.nombre || '';

    // Intentar buscar un número de teléfono en el transcript si no vino en metadata
    if (!phone && transcriptText !== '(Sin transcripción)') {
      const phoneRegex = /\b(\+?54)?\s?9?\s?(\d{2,4})\s?\d{6,8}\b/;
      const match = transcriptText.match(phoneRegex);
      if (match) {
        phone = match[0].replace(/\s+/g, '');
        logger.info({ phone }, 'Teléfono extraído mediante regex desde la transcripción');
      }
    }

    // Si sigue vacío, usar un identificador web único
    if (!phone) {
      phone = `web-el-${conversationId}`;
    }

    if (!name) {
      name = 'Cliente Web Voice';
    }

    // 3. Calcular duración
    let duration = eventData.call_duration_seconds || 0;
    if (!duration && rawTranscript.length > 0) {
      duration = Math.max(...rawTranscript.map((t: any) => t.time_in_call_secs || 0));
    }

    // 4. Clasificar el estado
    const status = classifyStatus(transcriptText, duration);

    // 5. Armar las notas basadas en el estado
    let notes = '';
    if (status === 'RECHAZO CLARO') {
      notes = 'El cliente indicó claramente que no está interesado en la propuesta.';
    } else if (status === 'OBJECIÓN PRECIO') {
      notes = 'El cliente tiene consultas o dudas sobre costos/precios (Objeción de Precio).';
    } else if (status === 'CORTÓ CON DATOS') {
      notes = 'El cliente proporcionó datos clave (Obra Social o CUIL) antes de finalizar.';
    } else if (status === 'NO CONTESTÓ') {
      notes = 'La llamada duró muy poco o no se registró diálogo de voz.';
    } else {
      notes = 'Conversación positiva/neutral con Valentina por voz. Potencial prospecto.';
    }

    // 6. Enviar datos al endpoint /api/contacts para guardar el lead y disparar el seguimiento
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host') || requestUrl.host;
    const protocol = request.headers.get('x-forwarded-proto') || (requestUrl.protocol.replace(':', ''));
    const baseUrl = `${protocol}://${host}`;

    logger.info({ baseUrl, phone, name, status }, 'Enviando lead a /api/contacts');

    const contactsRes = await fetch(`${baseUrl}/api/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone,
        name,
        status,
        notes,
        transcript: transcriptText,
        duration
      })
    });

    if (!contactsRes.ok) {
      const errText = await contactsRes.text();
      throw new Error(`Fallo al registrar lead en contacts API: ${contactsRes.status} - ${errText}`);
    }

    const contactsData = await contactsRes.json();
    logger.info({ contactsData }, 'Lead registrado exitosamente desde ElevenLabs');

    return NextResponse.json({ success: true, lead: contactsData });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error procesando webhook de ElevenLabs');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
