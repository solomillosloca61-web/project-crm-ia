// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\messages\route.ts
import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { sendWhatsAppMessage } from '@/lib/webhook';
import { logger } from '@/lib/logger';

// GET – Obtener todos los mensajes de una conversación específica
export async function GET(request: Request) {
  let conversationId: string | null = null;
  try {
    const { searchParams } = new URL(request.url);
    conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
    }

    const { data: messages, error } = await supabaseService
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json(messages);
  } catch (error: any) {
    logger.error({ err: error.message, conversationId }, 'Error fetching messages');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST – Enviar un mensaje manual desde el CRM por WhatsApp y guardarlo
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { conversationId, toPhone, content } = body;

    if (!conversationId || !toPhone || !content) {
      return NextResponse.json({ error: 'Missing required parameters (conversationId, toPhone, content)' }, { status: 400 });
    }

    // 1. Guardar el mensaje en Supabase con rol de 'assistant' (agente manual)
    const { data: message, error: insertError } = await supabaseService
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: content.trim()
      })
      .select('*')
      .single();

    if (insertError) {
      throw insertError;
    }

    // 2. Actualizar fecha en conversación y contacto
    await supabaseService
      .from('conversations')
      .update({ last_message: new Date().toISOString() })
      .eq('id', conversationId);

    // Buscar el contacto asociado a la conversación para actualizar su updated_at
    const { data: convData } = await supabaseService
      .from('conversations')
      .select('contact_id')
      .eq('id', conversationId)
      .single();

    if (convData?.contact_id) {
      await supabaseService
        .from('contacts')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', convData.contact_id);
    }

    // 3. Enviar el mensaje real a través de WhatsApp Cloud API
    let sent = false;
    if (!toPhone.startsWith('web-')) {
      sent = await sendWhatsAppMessage(toPhone, content.trim());
      if (!sent) {
        logger.warn({ toPhone, conversationId }, 'Mensaje guardado en base de datos pero falló el envío por API de WhatsApp.');
      }
    } else {
      logger.info({ toPhone }, `Mensaje manual guardado; envío de WhatsApp omitido por ser número web de prueba`);
      sent = true;
    }

    return NextResponse.json({ success: true, message, whatsappSent: sent });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error sending manual message');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
