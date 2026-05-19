// C:\Users\lucia\PROJECT_CRM_IA\src\lib\lead.ts
import { supabase } from './supabase';
import { notifyAdmin } from '@/lib/notify';

/**
 * Analiza el contenido de un mensaje de usuario y actualiza el score y estado del contacto en Supabase.
 */
export async function updateLeadScore(contactId: string, messageContent: string) {
  try {
    // Importar notificación al admin

    // 1. Traer datos actuales del contacto
    const { data: contact, error: fetchError } = await supabase
      .from('contacts')
      .select('score, status')
      .eq('id', contactId)
      .single();

    if (fetchError || !contact) {
      console.error('Error obteniendo contacto para Scoring:', fetchError);
      return;
    }

    let scoreDiff = 0;
    let newStatus = contact.status || 'nuevo';
    const text = messageContent.toLowerCase();

    // 2. Reglas de Scoring basadas en palabras clave
    if (/(turno|agendar|calendly|reunión|cita|entrevista|reservar|reserva)/i.test(text)) {
      scoreDiff = 40;
      newStatus = 'reunion_agendada';
    } else if (/(comprar|afiliarme|contratar|precio|cuanto sale|cuánto sale|costo|planes|plan|adherirme|adherir)/i.test(text)) {
      scoreDiff = 20;
      newStatus = 'lead_calificado';
    } else if (/(informacion|información|saber mas|saber más|como es|cómo es|de que se trata|de qué se trata|consulta|duda)/i.test(text)) {
      scoreDiff = 10;
      newStatus = 'en_conversacion';
    } else if (/(no me interesa|no quiero|baja|spam|no llamen|estafa|borrame|borrar)/i.test(text)) {
      scoreDiff = -20;
      newStatus = 'lead_frio';
    } else {
      // Mensaje genérico o de cortesía
      scoreDiff = 2;
    }

    const currentScore = contact.score || 0;
    const newScore = Math.max(0, currentScore + scoreDiff); // Evitar scores negativos menores a 0

    // Si cambió el estado o el score, actualizar en la base de datos
    if (newScore !== currentScore || newStatus !== contact.status) {
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          score: newScore,
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId);

      if (updateError) {
        console.error('Error actualizando score/status del lead:', updateError);
      } else {
        console.log(`Lead ${contactId} actualizado: Score ${currentScore} -> ${newScore}, Estado: ${contact.status} -> ${newStatus}`);
        // Notificar al administrador si el lead está calificado
        if (newScore >= 100 || newStatus === 'reunion_agendada') {
          const { data: adminContact } = await supabase
            .from('contacts')
            .select('name, phone')
            .eq('id', contactId)
            .single();
          if (adminContact) {
            await notifyAdmin(
              adminContact.name ?? 'Sin nombre',
              adminContact.phone,
              newScore,
              newStatus
            );
          }
        }
      }
    }
  } catch (error) {
    console.error('Fallo en la lógica de updateLeadScore:', error);
  }
}
