// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\webhook\route.ts
import type { NextRequest } from 'next/server';
import { verifyMetaSignature, sendWhatsAppMessage } from '@/lib/webhook';
import { saveMessage, supabaseService } from '@/lib/supabase';
import { callAI } from '@/lib/ai';
import { updateLeadScore } from '@/lib/lead';
import { logger } from '@/lib/logger';
import { WebhookPayloadSchema } from '@/lib/validation';

// GET – Verificación de webhook con Meta Developers
export async function GET(request: NextRequest) {
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  
  logger.info({ token, expectedToken: verifyToken }, 'Validación de Webhook - Petición recibida');
  
  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('Verification failed', { status: 403 });
}

// POST – Recepción de mensajes de WhatsApp en tiempo real
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validar el esquema de entrada
    const parsed = WebhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.format() }, 'Payload de webhook inválido');
      return new Response('Invalid payload structure', { status: 400 });
    }

    // Verificar la firma de Meta (opcional)
    const isValid = verifyMetaSignature(request);
    if (!isValid) {
      logger.warn('Firma de Meta inválida para el webhook');
      return new Response('Invalid signature', { status: 403 });
    }

    // 1. Guardar el mensaje recibido en Supabase (saveMessage internamente ya usa supabaseService)
    const saved = await saveMessage(parsed.data);
    if (!saved) {
      return new Response('Event processed but no database entries created', { status: 200 });
    }

    const { contact, conversation, message } = saved;

    // 2. Ejecutar Lead Scoring para calificar el interés del usuario
    await updateLeadScore(contact.id, message.content, contact.phone);

    // 3. Verificar si la IA está habilitada (pausa explícita) antes de consultar a la IA
    if (contact.pause_ai) {
      logger.info({ contactId: contact.id }, 'IA pausada de forma manual, no se enviará respuesta automática');
      return new Response(
        JSON.stringify({ success: true, reply: null, note: 'IA pausada de forma manual' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // IA habilitada → generar respuesta
    const reply = await callAI({ conversationId: conversation.id });

    if (reply) {
      // 4. Guardar la respuesta de la IA en Supabase
      const { error: insertError } = await supabaseService
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'assistant',
          content: reply
        });

      if (insertError) {
        logger.error({ err: insertError.message }, 'Error guardando la respuesta de la IA en Supabase');
      }

      // 5. Enviar la respuesta por WhatsApp usando la API de Meta
      if (!contact.phone.startsWith('web-')) {
        // Simular retraso humano de escritura (entre 2 y 4 segundos según longitud de respuesta)
        const typingDelay = Math.max(2000, Math.min(4000, reply.length * 30));
        logger.info({ typingDelay, phone: contact.phone }, 'Simulando retraso humano de escritura...');
        await new Promise((resolve) => setTimeout(resolve, typingDelay));

        await sendWhatsAppMessage(contact.phone, reply);
      } else {
        logger.info({ phone: contact.phone }, 'Mensaje omitido para número web de prueba en webhook');
      }
    }

    return new Response(JSON.stringify({ success: true, reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Fallo crítico en el procesamiento del Webhook');
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
