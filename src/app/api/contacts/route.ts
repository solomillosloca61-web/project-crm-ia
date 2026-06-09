// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\contacts\route.ts
import { NextResponse } from 'next/server';
import { supabaseService, getOrCreateContact, getOrCreateConversation } from '@/lib/supabase';
import { callAI, autoLearnFromCall } from '@/lib/ai';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from '@/lib/webhook';
import { extractAppointmentDateWithLLM } from '@/lib/lead';
import { logger } from '@/lib/logger';
import { ContactCreateSchema, ContactUpdateSchema } from '@/lib/validation';
import { safeUpdateContact } from '@/lib/helpers';
import { notifyAdmin } from '@/lib/notify';

// GET – Obtener todos los contactos con sus conversaciones
export async function GET() {
  try {
    const { data: contacts, error } = await supabaseService
      .from('contacts')
      .select('*, conversations(*, messages(role))')
      .order('updated_at', { ascending: false });

    if (error) {
      throw error;
    }

    const contactsWithChatFlag = contacts.map((c: any) => {
      const hasChat = c.conversations?.some((conv: any) => 
        conv.messages?.some((msg: any) => msg.role === 'user')
      ) || false;
      
      const cleanConvs = c.conversations?.map((conv: any) => {
        const { messages, ...rest } = conv;
        return rest;
      }) || [];

      return {
        ...c,
        conversations: cleanConvs,
        has_chat_messages: hasChat
      };
    });

    return NextResponse.json(contactsWithChatFlag);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error fetching contacts');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH – Actualizar detalles de un contacto
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const parsed = ContactUpdateSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ validationErrors: parsed.error.format() }, 'Validación fallida en PATCH /api/contacts');
      return NextResponse.json({ error: 'Datos de entrada inválidos', details: parsed.error.format() }, { status: 400 });
    }

    const { id, ...updateData } = parsed.data;

    // Utiliza el helper seguro de safeUpdateContact
    const data = await safeUpdateContact(supabaseService, id, updateData);

    return NextResponse.json(data);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error updating contact');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST – Crear o actualizar un contacto desde una llamada o servicio externo
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ContactCreateSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn({ validationErrors: parsed.error.format() }, 'Validación fallida en POST /api/contacts');
      return NextResponse.json({ error: 'Datos de entrada inválidos', details: parsed.error.format() }, { status: 400 });
    }

    const { phone, name, status, score, notes, transcript, duration } = parsed.data;

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

    let appointmentDate: string | null = null;
    const positiveStatuses = [
      'POTENCIAL POSITIVO',
      'CORTÓ CON DATOS',
      'reunion_agendada',
      'volver_a_llamar',
      'EN_CONVERSACION',
      'INTERESADO_PLAN_FAMILIAR',
      'INTERESADO_PLAN_CORPORATIVO',
      'PIDE_DATOS_CLINICA',
      'PENDIENTE_AUDITORIA',
      'LEAD_CALIFICADO'
    ];
    const isNegativeStatus = !positiveStatuses.includes(status || '');
    if (transcript && !isNegativeStatus) {
      const hasSchedulingIntent = /(turno|agendar|calendly|reunión|reunion|cita|entrevista|reservar|reserva|llamada|llamame|videollamada)/i.test(transcript);
      if (hasSchedulingIntent) {
        appointmentDate = await extractAppointmentDateWithLLM(transcript);
      }
    }

    // 2. Preparar los datos a actualizar en base al reporte de llamada
    const updateData: any = {};
    if (clientName !== undefined && clientName !== 'Cliente') updateData.name = clientName;
    if (status !== undefined) updateData.status = status;
    if (score !== undefined) {
      updateData.score = score;
    } else if (status === 'POTENCIAL POSITIVO') {
      // Incrementar score por llamada positiva
      updateData.score = Math.min((contact.score || 0) + 30, 100);
    } else if (status && !positiveStatuses.includes(status)) {
      // Si el estado es negativo/descalificado, resetear el score a 0
      updateData.score = 0;
    }
    if (notes !== undefined) {
      // Concatenar notas existentes si las hay
      updateData.notes = contact.notes 
        ? `${contact.notes}\n\n[Llamada ${new Date().toLocaleDateString()}]: ${notes}`
        : `[Llamada ${new Date().toLocaleDateString()}]: ${notes}`;
    }
    
    // Si se extrajo una fecha de cita, actualizar con el estado de reunion_agendada y la fecha
    if (appointmentDate) {
      logger.info({ appointmentDate }, `Fecha de cita extraída automáticamente de la llamada`);
      updateData.appointment_date = appointmentDate;
      updateData.status = 'reunion_agendada';
      // Asegurar un score mínimo para citas agendadas
      updateData.score = Math.max(updateData.score || contact.score || 0, 70);
    }

    updateData.updated_at = new Date().toISOString();

    // Utiliza el helper seguro de safeUpdateContact
    const updatedContact = await safeUpdateContact(supabaseService, contact.id, updateData);

    // Notificar al administrador si el lead es calificado, potencial positivo, cortó con datos o tiene cita agendada Y no está descalificado
    const isPositiveStatus = positiveStatuses.includes(updatedContact.status || '');
    const shouldNotify = isPositiveStatus && (
      updatedContact.status === 'POTENCIAL POSITIVO' || 
      updatedContact.status === 'CORTÓ CON DATOS' || 
      updatedContact.status === 'reunion_agendada' || 
      (updatedContact.score || 0) >= 100
    );
    if (updatedContact && shouldNotify) {
      try {
        await notifyAdmin(
          updatedContact.name || 'Sin nombre',
          updatedContact.phone,
          updatedContact.score || 0,
          updatedContact.status || 'N/A'
        );
      } catch (notifyErr) {
        logger.error(notifyErr, 'Error al enviar notificación al administrador desde /api/contacts');
      }
    }

    // Asegurar que siempre exista una conversación activa al crear/actualizar vía POST
    const conversation = await getOrCreateConversation(contact.id);

    // 3. Registrar el resumen o transcripción de la llamada en el chat del CRM
    if (transcript) {
      const durationStr = (duration !== undefined && duration !== null) ? `\nDuración: ${duration} segundos` : '';
      await supabaseService
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          role: 'system',
          content: `📞 [Reporte de Llamada] Estado: ${status || 'N/A'}${durationStr}\nNotas: ${notes || 'Sin notas de llamada.'}\n\nTranscripción:\n${transcript}`
        });

      // Actualizar fecha del último mensaje en la conversación
      await supabaseService
        .from('conversations')
        .update({ last_message: new Date().toISOString() })
        .eq('id', conversation.id);

      // Si la IA no está pausada, generar el mensaje de seguimiento por WhatsApp
      const isPositive = positiveStatuses.includes(status || '');

      if (updatedContact && !updatedContact.pause_ai && isPositive) {
        try {
          // 1. Verificar si hay mensajes del usuario en las últimas 24 horas para saber si la ventana está abierta
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: userMessages, error: msgError } = await supabaseService
            .from('messages')
            .select('id')
            .eq('conversation_id', conversation.id)
            .eq('role', 'user')
            .gt('created_at', twentyFourHoursAgo)
            .limit(1);

          if (msgError) {
            logger.error({ err: msgError.message }, 'Error checking user messages for 24h window');
          }

          const isWindowOpen = userMessages && userMessages.length > 0;

          if (isWindowOpen) {
            // Ventana abierta -> Mandar mensaje personalizado con IA
            logger.info({ contactId: updatedContact.id }, 'Ventana de 24h abierta. Generando seguimiento con IA.');
            let calendlyLink = updatedContact.calendly_link || process.env.CALENDLY_LINK || '';
            if (calendlyLink === 'YOUR_CALENDLY_LINK' || calendlyLink.trim() === '') {
              calendlyLink = '';
            }

            const calendlyInstruction = calendlyLink
              ? `- Enlace de Calendly del asesor (si es necesario compartirlo): ${calendlyLink}`
              : `- NOTA IMPORTANTE: El asesor NO tiene configurado un enlace de Calendly en este momento. NO inventes ningún enlace ficticio ni uses marcadores de posición en el mensaje. Si el cliente aceptó agendar la cita, decile de manera amable que le vas a estar coordinando el turno a la brevedad.`;

            let customPrompt = '';
            if (status === 'CORTÓ A LA MITAD') {
              customPrompt = `Acabas de finalizar una llamada telefónica con el cliente, pero la llamada se CORTÓ A LA MITAD.
Información del cliente:
- Nombre: ${updatedContact.name || 'Desconocido'}
- Teléfono: ${updatedContact.phone}

Escribí un mensaje de WhatsApp corto, amigable, profesional y muy argentino (usando voseo, pero NUNCA la palabra "che" porque no suena profesional) para enviarle inmediatamente al cliente.
Saludalo, comentale de forma simpática que se cortó la llamada y decile que le escribís por acá por si prefiere coordinar o charlar por texto, o si prefiere que lo vuelvas a llamar en otro momento.

No agregues introducciones ni explicaciones de tu parte, devolvé ÚNICAMENTE el texto que le vamos a mandar por WhatsApp.`;
            } else {
              customPrompt = `Acabas de finalizar una llamada telefónica con el cliente.
Información del cliente:
- Nombre: ${updatedContact.name || 'Desconocido'}
- Teléfono: ${updatedContact.phone}
- Notas de la llamada: ${notes || 'Sin notas'}
- Estado de la llamada: ${status || 'N/A'}

Transcripción de la llamada:
"""
${transcript}
"""

Escribí un mensaje de WhatsApp amigable, profesional y muy argentino (usando voseo, pero NUNCA la palabra "che" porque no suena profesional) para enviarle inmediatamente al cliente. Saludalo, hacé referencia a la llamada que acaban de tener y dale un cierre adecuado.
${calendlyInstruction}

No agregues introducciones ni explicaciones de tu parte, devolvé ÚNICAMENTE el texto que le vamos a mandar por WhatsApp.`;
            }

            const followUpMessage = await callAI({ customPrompt });

            if (followUpMessage && followUpMessage.trim()) {
              // Guardar el mensaje en el historial
              await supabaseService
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
                logger.info(`WhatsApp omitido para contacto demo web: ${updatedContact.phone}`);
              }
            }
          } else {
            // Ventana cerrada o cliente nuevo -> Mandar plantilla oficial
            const templateName = process.env.WHATSAPP_FOLLOWUP_TEMPLATE || 'hello_world';
            logger.info({ contactId: updatedContact.id, templateName }, 'Ventana de 24h cerrada o cliente nuevo. Enviando plantilla.');

            const isHelloWorld = templateName === 'hello_world';
            const templateText = isHelloWorld 
              ? `👋 (Mensaje de Plantilla: hello_world)`
              : `📢 [Mensaje de Plantilla: ${templateName}] Hola ${updatedContact.name || 'Cliente'}, te escribo para dejarte por acá los detalles del Plan 1000 que conversamos por teléfono. ¿Pudiste revisarlo?`;

            // Guardar el mensaje representativo de la plantilla en el historial
            await supabaseService
              .from('messages')
              .insert({
                conversation_id: conversation.id,
                role: 'assistant',
                content: templateText
              });

            // Enviar la plantilla real por WhatsApp
            if (!updatedContact.phone.startsWith('web-')) {
              await sendWhatsAppTemplate(updatedContact.phone, templateName, updatedContact.name || 'Cliente');
            } else {
              logger.info(`WhatsApp Template omitido para contacto demo web: ${updatedContact.phone}`);
            }
          }

          // Actualizar last_message de nuevo
          await supabaseService
            .from('conversations')
            .update({ last_message: new Date().toISOString() })
            .eq('id', conversation.id);

        } catch (followUpError) {
          logger.error(followUpError, 'Error generating or sending auto WhatsApp follow-up');
        }
      }

      // Ejecutar auto-aprendizaje comercial en segundo plano
      autoLearnFromCall(transcript).catch(err => {
        logger.error(err, 'Error in background autoLearnFromCall');
      });
    }

    // Obtener el contacto completo con sus conversaciones asociadas para responder en tiempo real en la interfaz
    const { data: finalContact, error: fetchError } = await supabaseService
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
    logger.error({ err: error.message }, 'Error in POST contacts');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
