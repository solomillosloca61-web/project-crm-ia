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

    // 2. Reglas de Scoring y Detección de Agenda de Cita
    const isSchedulingIntent = 
      /(turno|agendar|calendly|reunión|reunion|cita|entrevista|reservar|reserva|llamada|llamame|videollamada)/i.test(text) ||
      // Ej. "se puede mañana", "puedo a las 6", "coordinamos para el lunes", "mañana a las 18"
      /((se puede|puedo|coordinar|coordinamos|llamada|llamen|llamame|reunión|reunion|hablar|entrevista).*(mañana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|hoy|tarde|día|dia))/i.test(text) ||
      /((mañana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|hoy).*(a las|alrededor de|cerca de|tipo|\b\d{1,2}\s*(am|pm|hs|horas|hora)))/i.test(text);

    // Detección amplia de agendamiento para gatillar la IA (OpenRouter)
    const hasPotentialSchedule = isSchedulingIntent || 
      /(hoy|mañana|manana|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|tarde|mediodía|mediodia|noche|hs|horas|hora|\b\d{1,2}\b)/i.test(text);

    let appointmentDate: string | null = null;
    if (hasPotentialSchedule) {
      appointmentDate = await extractAppointmentDateWithLLM(messageContent);
      if (!appointmentDate) {
        appointmentDate = parseAppointmentDate(messageContent);
      }
    }

    if (appointmentDate) {
      scoreDiff = 40;
      newStatus = 'reunion_agendada';
    } else if (isSchedulingIntent) {
      // Si el regex estricto dio true pero no extrajo fecha, igual lo consideramos intención de agendar
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

    // Si cambió el estado, el score, o se agendó una fecha
    if (newScore !== currentScore || newStatus !== contact.status || appointmentDate) {
      const updateData: any = {
        score: newScore,
        status: newStatus,
        updated_at: new Date().toISOString()
      };

      if (appointmentDate) {
        updateData.appointment_date = appointmentDate;
      }

      const { error: updateError } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contactId);

      if (updateError) {
        // Fallback si la columna no existe en Supabase
        if (updateError.message.includes('appointment_date') || updateError.code === '42703') {
          console.warn('La columna appointment_date no existe en Supabase. Reintentando sin ella...');
          delete updateData.appointment_date;
          const { error: retryError } = await supabase
            .from('contacts')
            .update(updateData)
            .eq('id', contactId);
          if (retryError) {
            console.error('Error reintentando sin appointment_date:', retryError);
          }
        } else {
          console.error('Error actualizando score/status del lead:', updateError);
        }
      } else {
        console.log(`Lead ${contactId} actualizado: Score ${currentScore} -> ${newScore}, Estado: ${contact.status} -> ${newStatus}, Cita: ${appointmentDate || 'No agendada'}`);
        // Notificar al administrador si el lead está calificado o agendado
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

/**
 * Parsea el texto del mensaje para extraer una fecha y hora aproximada de cita.
 * Retorna un string en formato ISO con offset de Argentina (UTC-3).
 */
function parseAppointmentDate(text: string): string | null {
  try {
    const now = new Date();
    let targetDate = new Date(now);
    let hasDate = false;
    const lowerText = text.toLowerCase();

    // 1. Detectar el día
    if (lowerText.includes('mañana') || lowerText.includes('manana')) {
      targetDate.setDate(targetDate.getDate() + 1);
      hasDate = true;
    } else if (lowerText.includes('hoy')) {
      hasDate = true;
    } else {
      const days = ['domingo', 'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado'];
      for (let i = 0; i < days.length; i++) {
        if (lowerText.includes(days[i])) {
          let targetDayIdx = i;
          if (days[i] === 'miercoles') targetDayIdx = 3;
          if (days[i] === 'sabado') targetDayIdx = 6;
          
          let currentDay = now.getDay();
          let diff = targetDayIdx - currentDay;
          if (diff <= 0) diff += 7; // Próxima semana
          targetDate.setDate(targetDate.getDate() + diff);
          hasDate = true;
          break;
        }
      }
    }

    // 2. Detectar la hora
    let hour = 18; // 6 PM default si no especifica
    let minute = 0;

    const hourMatches = [
      // "6 pm", "6pm", "18 hs", "18hs", "18:30"
      /(\b\d{1,2})(?::(\d{2}))?\s*(pm|am|hs|horas|hora)/i,
      // "a las 6", "a las 18"
      /a las\s*(\d{1,2})(?::(\d{2}))?/i,
      // "alrededor de las 6", "cerca de las 6", "alrededor de 6"
      /(?:alrededor de|cerca de|tipo|las)\s*(\d{1,2})(?::(\d{2}))?/i
    ];

    for (const regex of hourMatches) {
      const m = lowerText.match(regex);
      if (m) {
        let h = parseInt(m[1], 10);
        let min = m[2] ? parseInt(m[2], 10) : 0;
        let ampm = m[3] ? m[3].toLowerCase() : '';

        if (ampm.startsWith('p') && h < 12) {
          h += 12;
        }
        if (ampm.startsWith('a') && h === 12) {
          h = 0;
        }
        
        if (h >= 0 && h < 24) {
          hour = h;
          minute = min;
          break;
        }
      }
    }

    if (hasDate) {
      const yyyy = targetDate.getFullYear();
      const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const dd = String(targetDate.getDate()).padStart(2, '0');
      const hh = String(hour).padStart(2, '0');
      const minStr = String(minute).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${minStr}:00-03:00`;
    }
  } catch (err) {
    console.error('Error parseando fecha de cita:', err);
  }
  return null;
}

/**
 * Extrae una fecha de cita usando IA (OpenRouter) analizando el texto en español.
 * Devuelve un string en formato ISO con offset de Argentina (UTC-3) o null si no se encuentra fecha.
 */
export async function extractAppointmentDateWithLLM(text: string): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';

  if (!apiKey || !text || !text.trim()) {
    return null;
  }

  try {
    const now = new Date();
    // Obtener la fecha en la zona horaria de Argentina
    const referenceDateStr = now.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    const dayOfWeek = now.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long" });

    const systemPrompt = `Eres un asistente de extracción de datos del CRM de MP Salud.
Tu única tarea es analizar un mensaje de texto o transcripción en español y extraer la fecha y hora propuesta para una cita, llamada, reunión o turno.
La zona horaria de referencia es Argentina (UTC-3).

INFORMACIÓN DE REFERENCIA ACTUAL (HOY EN ARGENTINA):
- Fecha y hora actual de referencia: ${referenceDateStr} (Día: ${dayOfWeek})

REGLAS DE EXTRACCIÓN:
1. Si el texto indica que se quiere agendar una cita o llamada para un momento específico (ej: "mañana a las 6", "el lunes tipo 11hs", "este miércoles 15:30", "hoy a la tarde a las 18 hs", etc.), calcula la fecha y hora exactas correspondientes.
2. Si el usuario propone un día pero no especifica hora, asume por defecto las 18:00 hs (6 PM).
3. Si el usuario propone una hora pero no especifica día, asume el día actual (o el siguiente si la hora ya pasó).
4. El formato de salida debe ser estrictamente en formato ISO 8601 con offset de Argentina (-03:00): YYYY-MM-DDTHH:mm:ss-03:00.
5. Si no hay intención clara de agendar una cita, o no se menciona ninguna fecha/hora/momento resoluble, responde únicamente con la palabra "NONE".
6. NO devuelvas ninguna otra palabra, formato, explicación o Markdown. Tu respuesta debe ser ÚNICAMENTE el string de fecha (ej. "2026-05-23T18:00:00-03:00") o "NONE".`;

    const userPrompt = `Texto a analizar: "${text}"`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      console.error('Error al llamar a OpenRouter en extractAppointmentDateWithLLM:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    let result = (data?.choices?.[0]?.message?.content ?? '').trim();
    const reasoning = (data?.choices?.[0]?.message?.reasoning ?? '').trim();

    // Eliminar etiquetas de razonamiento <think>...</think> si estuvieran presentes
    if (result.includes('<think>')) {
      result = result.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    // Función auxiliar para extraer y normalizar la fecha ISO
    const extractIsoDate = (inputStr: string): string | null => {
      if (!inputStr) return null;
      const match = inputStr.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)/);
      if (match) {
        let dateStr = match[1];
        if (!/[+-]\d{2}:?\d{2}$/.test(dateStr) && !dateStr.endsWith('Z')) {
          if (dateStr.split(':').length === 2) {
            dateStr += ':00';
          }
          dateStr += '-03:00';
        } else {
          const parts = dateStr.split('T');
          if (parts.length === 2) {
            const timePart = parts[1];
            const offsetIndex = timePart.search(/[+-]|Z/);
            if (offsetIndex !== -1) {
              const timeOnly = timePart.substring(0, offsetIndex);
              const offsetOnly = timePart.substring(offsetIndex);
              if (timeOnly.split(':').length === 2) {
                dateStr = parts[0] + 'T' + timeOnly + ':00' + offsetOnly;
              }
            }
          }
        }
        return dateStr;
      }
      return null;
    };

    // Primero buscar en el contenido limpio
    let dateFound = extractIsoDate(result);
    if (dateFound) {
      return dateFound;
    }

    // Si no se encontró, probar con la propiedad reasoning si existe
    if (reasoning) {
      dateFound = extractIsoDate(reasoning);
      if (dateFound) {
        return dateFound;
      }
    }

    // Como último recurso, si la respuesta entera contenía <think> y eliminamos todo,
    // buscar en la respuesta sin limpiar
    const rawContent = (data?.choices?.[0]?.message?.content ?? '').trim();
    dateFound = extractIsoDate(rawContent);
    if (dateFound) {
      return dateFound;
    }

  } catch (err) {
    console.error('Excepción en extractAppointmentDateWithLLM:', err);
  }
  return null;
}
