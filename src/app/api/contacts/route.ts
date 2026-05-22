// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\contacts\route.ts
import { NextResponse } from 'next/server';
import { supabase, getOrCreateContact, getOrCreateConversation } from '@/lib/supabase';
import { callAI, autoLearnFromCall } from '@/lib/ai';
import { sendWhatsAppMessage } from '@/lib/webhook';
import { extractAppointmentDateWithLLM } from '@/lib/lead';

// GET – Obtener todos los contactos con sus conversaciones
export async function GET() {
  try {
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('*, conversations(*)')
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json(contacts);
  } catch (error: any) {
    console.error('Error fetching contacts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH – Actualizar detalles de un contacto
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, name, status, score, notes, calendly_link, pause_ai, appointment_date } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing contact ID' }, { status: 400 });
    }

    // Preparar objeto de campos a actualizar
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;
    if (score !== undefined) updateData.score = parseInt(score, 10);
    if (notes !== undefined) updateData.notes = notes;
    if (calendly_link !== undefined) updateData.calendly_link = calendly_link;
    if (pause_ai !== undefined) updateData.pause_ai = !!pause_ai;
    if (appointment_date !== undefined) updateData.appointment_date = appointment_date;
    
    updateData.updated_at = new Date().toISOString();

    let { data, error } = await supabase
      .from('contacts')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      // Fallback si la columna appointment_date no existe en la base de datos (antes de la migración SQL)
      if ((error.message.includes('appointment_date') || error.code === '42703') && appointment_date !== undefined) {
        console.warn('La columna appointment_date no existe en Supabase. Reintentando sin ella...');
        delete updateData.appointment_date;
        const retry = await supabase
          .from('contacts')
          .update(updateData)
          .eq('id', id)
          .select('*')
          .single();
        
        if (retry.error) throw retry.error;
        data = retry.data;
      } else {
        throw error;
      }
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error updating contact:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST – Crear o actualizar un contacto desde una llamada o servicio externo
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone, name, status, score, notes, transcript, duration } = body;

    let phoneNum = phone;
    let clientName = name;

    // Asignar número de marcador si el teléfono viene vacío
    if (!phoneNum || phoneNum.trim() === '') {
      phoneNum = `web-demo-${Date.now()}`;
      if (!clientName || clientName === 'Cliente' || clientName === 'Cliente de WhatsApp') {
        clientName = 'Cliente Web';
      }
    }

    // 1. Obtener o crear el contacto en Supabase (limpiando espacios)
    const contact = await getOrCreateContact(phoneNum, clientName);

    // Intentar extraer fecha de agendamiento inteligente desde la transcripción o las notas si vienen
    let appointmentDate: string | null = null;
    if (transcript) {
      appointmentDate = await extractAppointmentDateWithLLM(transcript);
      if (!appointmentDate && notes) {
        appointmentDate = await extractAppointmentDateWithLLM(notes);
      }
    }

    // 2. Preparar los datos a actualizar en base al reporte de llamada
    const updateData: any = {};
    if (clientName !== undefined && clientName !== 'Cliente') updateData.name = clientName;
    if (status !== undefined) updateData.status = status;
    if (score !== undefined) {
      updateData.score = parseInt(score, 10);
    } else if (status === 'POTENCIAL POSITIVO') {
      // Incrementar score por llamada positiva
      updateData.score = Math.min((contact.score || 0) + 30, 100);
    }
    if (notes !== undefined) {
      // Concatenar notas existentes si las hay
      updateData.notes = contact.notes 
        ? `${contact.notes}\n\n[Llamada ${new Date().toLocaleDateString()}]: ${notes}`
        : `[Llamada ${new Date().toLocaleDateString()}]: ${notes}`;
    }
    
    // Si se extrajo una fecha de cita, actualizar con el estado de reunion_agendada y la fecha
    if (appointmentDate) {
      console.log(`Fecha de cita extraída automáticamente de la llamada: ${appointmentDate}`);
      updateData.appointment_date = appointmentDate;
      updateData.status = 'reunion_agendada';
      // Asegurar un score mínimo para citas agendadas
      updateData.score = Math.max(updateData.score || contact.score || 0, 70);
    }

    updateData.updated_at = new Date().toISOString();

    let updatedContact = contact;
    let { data: updateRes, error: updateError } = await supabase
      .from('contacts')
      .update(updateData)
      .eq('id', contact.id)
      .select('*')
      .single();

    if (updateError) {
      // Fallback si la columna appointment_date no existe en la base de datos
      if (updateError.message.includes('appointment_date') || updateError.code === '42703') {
        console.warn('La columna appointment_date no existe en Supabase en POST /api/contacts. Reintentando sin ella...');
        delete updateData.appointment_date;
        const retry = await supabase
          .from('contacts')
          .update(updateData)
          .eq('id', contact.id)
          .select('*')
          .single();
        if (retry.error) throw retry.error;
        updateRes = retry.data;
      } else {
        throw updateError;
      }
    }

    if (updateRes) {
      updatedContact = updateRes;
    }

    // Asegurar que siempre exista una conversación activa al crear/actualizar vía POST
    // Esto permite que los leads agregados manualmente puedan recibir mensajes al instante.
    const conversation = await getOrCreateConversation(contact.id);

    // 3. Registrar el resumen o transcripción de la llamada en el chat del CRM
    if (transcript) {
      const durationStr = (duration !== undefined && duration !== null) ? `\nDuración: ${duration} segundos` : '';
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'system',
          content: `📞 [Reporte de Llamada] Estado: ${status || 'N/A'}${durationStr}\nNotas: ${notes || 'Sin notas de llamada.'}\n\nTranscripción:\n${transcript}`
        });

      // Actualizar fecha del último mensaje en la conversación
      await supabase
        .from('conversations')
        .update({ last_message: new Date().toISOString() })
        .eq('id', conversation.id);

      // Si la IA no está pausada, generar el mensaje de seguimiento por WhatsApp
      if (updatedContact && !updatedContact.pause_ai) {
        try {
          const calendlyLink = updatedContact.calendly_link || process.env.CALENDLY_LINK || '';
          const customPrompt = `Acabas de finalizar una llamada telefónica con el cliente.
Información del cliente:
- Nombre: ${updatedContact.name || 'Desconocido'}
- Teléfono: ${updatedContact.phone}
- Notas de la llamada: ${notes || 'Sin notas'}
- Estado de la llamada: ${status || 'N/A'}

Transcripción de la llamada:
"""
${transcript}
"""

Escribí un mensaje de WhatsApp amigable, profesional y muy argentino (usando voseo) para enviarle inmediatamente al cliente. Saludalo, hacé referencia a la llamada que acaban de tener y dale un cierre adecuado (por ejemplo, enviándole el enlace de Calendly si aceptó agendar, o saludándolo y quedando a disposición).
- Enlace de Calendly del asesor (si es necesario compartirlo): ${calendlyLink}

No agregues introducciones ni explicaciones de tu parte, devolvé ÚNICAMENTE el texto que le vamos a mandar por WhatsApp.`;

          const followUpMessage = await callAI({ customPrompt });

          if (followUpMessage && followUpMessage.trim()) {
            // Guardar el mensaje en el historial
            await supabase
              .from('messages')
              .insert({
                conversation_id: conversation.id,
                role: 'assistant',
                content: followUpMessage
              });

            // Enviar por WhatsApp si no es un número web demo
            if (!updatedContact.phone.startsWith('web-')) {
              await sendWhatsAppMessage(updatedContact.phone, followUpMessage);
            } else {
              console.log(`WhatsApp omitido para contacto demo web: ${updatedContact.phone}`);
            }

            // Actualizar last_message de nuevo
            await supabase
              .from('conversations')
              .update({ last_message: new Date().toISOString() })
              .eq('id', conversation.id);
          }
        } catch (followUpError) {
          console.error('Error generating or sending auto WhatsApp follow-up:', followUpError);
        }
      }

      // Ejecutar auto-aprendizaje comercial en segundo plano
      autoLearnFromCall(transcript).catch(err => {
        console.error('Error in background autoLearnFromCall:', err);
      });
    }

    // Obtener el contacto completo con sus conversaciones asociadas para responder en tiempo real en la interfaz
    const { data: finalContact, error: fetchError } = await supabase
      .from('contacts')
      .select('*, conversations(*)')
      .eq('id', contact.id)
      .single();

    if (fetchError) {
      // Fallback si falla el fetch detallado
      return NextResponse.json({ success: true, contact: { ...updatedContact, conversations: [conversation] } });
    }

    return NextResponse.json({ success: true, contact: finalContact });
  } catch (error: any) {
    console.error('Error in POST contacts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

