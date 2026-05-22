// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\webhook\route.ts
import type { NextRequest } from 'next/server';
import { verifyMetaSignature, sendWhatsAppMessage } from '@/lib/webhook';
import { saveMessage, supabase } from '@/lib/supabase';
import { callAI } from '@/lib/ai';
import { updateLeadScore } from '@/lib/lead';

// GET – Verificación de webhook con Meta Developers
export async function GET(request: NextRequest) {
  const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  
  console.log('Validación de Webhook - Token recibido:', token, 'Token esperado:', verifyToken);
  
  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('Verification failed', { status: 403 });
}

// POST – Recepción de mensajes de WhatsApp en tiempo real
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Verificar la firma de Meta (opcional)
    const isValid = verifyMetaSignature(request);
    if (!isValid) {
      return new Response('Invalid signature', { status: 403 });
    }

    // 1. Guardar el mensaje recibido en Supabase
    const saved = await saveMessage(body);
    if (!saved) {
      return new Response('Event processed but no database entries created', { status: 200 });
    }

    const { contact, conversation, message } = saved;

    // 2. Ejecutar Lead Scoring para calificar el interés del usuario
    await updateLeadScore(contact.id, message.content);

    // 3. Verificar si la IA está habilitada (estado "en_conversacion" o pausa) antes de consultar a la IA
if (contact.pause_ai || contact.status === 'en_conversacion') {
  // No enviamos respuesta automática; simplemente retornamos éxito.
  return new Response(
    JSON.stringify({ success: true, reply: null, note: 'IA pausada o conversación humana en curso' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// IA habilitada → generar respuesta
const reply = await callAI({ conversationId: conversation.id });

    if (reply) {
      // 4. Guardar la respuesta de la IA en Supabase
      const { error: insertError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'assistant',
          content: reply
        });

      if (insertError) {
        console.error('Error guardando la respuesta de la IA en Supabase:', insertError);
      }

      // 5. Enviar la respuesta por WhatsApp usando la API de Meta
      if (!contact.phone.startsWith('web-')) {
        await sendWhatsAppMessage(contact.phone, reply);
      } else {
        console.log(`Mensaje omitido para número web de prueba en webhook: ${contact.phone}`);
      }
    }

    return new Response(JSON.stringify({ success: true, reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Fallo crítico en el procesamiento del Webhook:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
