import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { callAI } from '@/lib/ai';
import { sendWhatsAppMessage } from '@/lib/webhook';

/**
 * Helper: fecha ISO de hace 24 horas.
 */
function twentyFourHoursAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Construye el prompt que le entregaremos a OpenRouter para el follow‑up.
 */
function buildPrompt(name: string): string {
  return `Eres un asistente de salud profesional y amable. Genera un mensaje corto (<2 frases) para reenviar a ${name} recordándole que revise el link de Calendly para agendar una consulta. Usa tono formal y no incluyas emojis.`;
}

/**
 * GET /api/cron/followup
 * Endpoint pensado para ser llamado por un scheduler (Vercel Cron, Cloudflare Workers, etc.).
 * Busca contactos cuya conversación activa no haya recibido mensajes en las últimas 24 h y que
 * no estén en estado "reunion_agendada" ni "cliente". Para cada uno genera un mensaje con IA
 * y lo envía por WhatsApp.
 */
export async function GET(request: NextRequest) {
  try {
    // 1️⃣ Obtener contactos con sus conversaciones
    const { data: contacts, error: contactsErr } = await supabase
      .from('contacts')
      .select(`id, name, phone, status, conversations (id, last_message) `)
      .neq('status', 'reunion_agendada')
      .neq('status', 'cliente');

    if (contactsErr) throw contactsErr;

    const cutoff = twentyFourHoursAgo();
    const pending: Array<{ contactId: string; name: string; phone: string; convId: string }> = [];

    contacts?.forEach((c: any) => {
      const activeConv = (c.conversations || []).find((conv: any) => new Date(conv.last_message).toISOString() < cutoff);
      if (activeConv) {
        pending.push({
          contactId: c.id,
          name: c.name ?? 'Cliente',
          phone: c.phone,
          convId: activeConv.id,
        });
      }
    });

    const results: any[] = [];
    for (const p of pending) {
      const prompt = buildPrompt(p.name);
      const reply = await callAI({ customPrompt: prompt }); // usamos la sobrecarga libre del agente openrouter/free

      const sent = await sendWhatsAppMessage(p.phone, reply);

      // Guardar el mensaje en la tabla messages para que quede en el historial
      if (sent) {
        await supabase.from('messages').insert({
          conversation_id: p.convId,
          role: 'assistant',
          content: reply,
        });
      }

      // Opcional: registrar en followup_logs (si la tabla existe)
      try {
        await supabase.from('followup_logs').insert({
          contact_id: p.contactId,
          conversation_id: p.convId,
          message_text: reply,
          success: sent,
        });
      } catch (_) {
        // Si la tabla no existe, simplemente ignoramos el error
      }

      results.push({ contactId: p.contactId, conversationId: p.convId, sent, reply });
    }

    return new Response(JSON.stringify({ processed: pending.length, details: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error en /api/cron/followup', err);
    return new Response(JSON.stringify({ error: err.message || 'unknown' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
