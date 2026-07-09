// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\cron\followup\route.ts
import { NextRequest } from 'next/server';
import { supabaseService } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
import { callAI } from '@/lib/ai';
import { sendWhatsAppMessage } from '@/lib/webhook';
import { logger } from '@/lib/logger';

/**
 * Helper: fecha ISO de hace 24 horas.
 */
function twentyFourHoursAgo(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Construye el prompt que le entregaremos al modelo para el follow‑up.
 */
function buildPrompt(name: string): string {
  return `Eres Valentina, asesora comercial de MP Salud. Generá un mensaje corto de seguimiento por WhatsApp (máximo 2 frases) para enviarle a ${name} recordándole amigablemente agendar su llamada con un asesor. Usá voseo argentino profesional ("tenés", "querés", etc.), pero NUNCA uses la palabra "che" porque no suena profesional en este contexto. No agregues emojis ni texto introductorio.`;
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
    const { data: contacts, error: contactsErr } = await supabaseService
      .from('contacts')
      .select(`id, name, phone, status, call_blocked, conversations (id, last_message) `)
      .or('source.eq.whatsapp,source.is.null')
      .neq('status', 'reunion_agendada')
      .neq('status', 'cliente')
      .or('call_blocked.eq.false,call_blocked.is.null');

    if (contactsErr) throw contactsErr;

    const cutoff = twentyFourHoursAgo();
    const pending: Array<{ contactId: string; name: string; phone: string; convId: string }> = [];

    // Lista de estados excluidos del seguimiento automático
    const excludedStatuses = [
      'RECHAZO CLARO',
      'CORTÓ RÁPIDO',
      'CORTÓ A LA MITAD',
      'NO CONTESTÓ',
      'BUZÓN DE VOZ',
      'lead_frio',
      'NO APTO / SIN APORTES',
      'NÚMERO EQUIVOCADO',
      'YA TIENE MP SALUD',
      'OBRA_SOCIAL_NO_ADHERIDA',
      'NO COMPATIBLE_EDAD',
      'MONOTRIBUTO_SOCIAL',
      'MENOR_DE_EDAD',
      'NÚMERO_INEXISTENTE',
      'LLAMADA_CAIDA',
      'NO_HABLA_ESPANOL',
      'NOT_INTERESTED'
    ];

    contacts?.forEach((c: any) => {
      // Omitir contactos con estados negativos
      if (c.status && excludedStatuses.includes(c.status)) {
        return;
      }
      // Defensa en profundidad: aunque ya se filtró en la query, evitar cualquier
      // contacto marcado con fallo permanente de red/SIP.
      if (c.call_blocked) {
        return;
      }

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
        await supabaseService.from('messages').insert({
          conversation_id: p.convId,
          role: 'assistant',
          content: reply,
        });
      }

      // Opcional: registrar en followup_logs (si la tabla existe)
      try {
        await supabaseService.from('followup_logs').insert({
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
    logger.error({ err: err.message }, 'Error en /api/cron/followup');
    return new Response(JSON.stringify({ error: err.message || 'unknown' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
