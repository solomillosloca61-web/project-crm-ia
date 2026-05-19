// C:\Users\lucia\PROJECT_CRM_IA\src\lib\supabase.ts
import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase configuration missing in env');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Busca un contacto por teléfono o lo crea si no existe.
 */
export async function getOrCreateContact(phone: string, name?: string) {
  // Asegurarse de quitar espacios y formatear
  const cleanPhone = phone.trim();

  // Buscar contacto
  const { data: contact, error: findError } = await supabase
    .from('contacts')
    .select('*')
    .eq('phone', cleanPhone)
    .maybeSingle();

  if (findError) {
    console.error('Error buscando contacto:', findError);
    throw findError;
  }

  if (contact) {
    return contact;
  }

  // Si no existe, crearlo
  const { data: newContact, error: createError } = await supabase
    .from('contacts')
    .insert({
      phone: cleanPhone,
      name: name || 'Cliente de WhatsApp',
      status: 'nuevo',
      score: 0
    })
    .select('*')
    .single();

  if (createError) {
    console.error('Error creando contacto:', createError);
    throw createError;
  }

  return newContact;
}

/**
 * Busca una conversación activa (no resuelta) para un contacto o crea una nueva.
 */
export async function getOrCreateConversation(contactId: string) {
  const { data: conversation, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .eq('resolved', false)
    .order('last_message', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) {
    console.error('Error buscando conversación:', findError);
    throw findError;
  }

  if (conversation) {
    return conversation;
  }

  // Si no existe una activa, crear una nueva
  const { data: newConversation, error: createError } = await supabase
    .from('conversations')
    .insert({
      contact_id: contactId,
      resolved: false
    })
    .select('*')
    .single();

  if (createError) {
    console.error('Error creando conversación:', createError);
    throw createError;
  }

  return newConversation;
}

/**
 * Guarda un mensaje recibido en la base de datos de Supabase,
 * asociándolo con el contacto y la conversación correctos.
 */
export async function saveMessage(payload: any) {
  try {
    // 1. Extraer los datos del mensaje y del contacto del payload de WhatsApp de Meta
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    
    // Si viene en formato WhatsApp estándar
    const messageData = value?.messages?.[0];
    const contactData = value?.contacts?.[0];

    let phone = '';
    let name = '';
    let content = '';
    let isFromUser = true;

    if (messageData) {
      phone = messageData.from;
      name = contactData?.profile?.name || 'Cliente';
      content = messageData.text?.body || '';
      isFromUser = true;
    } else if (payload.phone && payload.content) {
      // Para pruebas locales directas con payloads simplificados
      phone = payload.phone;
      name = payload.name || 'Cliente de Pruebas';
      content = payload.content;
      isFromUser = payload.role !== 'assistant';
    } else {
      console.warn('Estructura de mensaje no reconocida:', JSON.stringify(payload));
      return null;
    }

    if (!phone || !content) {
      console.log('Mensaje vacío o sin número telefónico, ignorando...');
      return null;
    }

    // 2. Obtener o crear el contacto
    const contact = await getOrCreateContact(phone, name);

    // 3. Obtener o crear la conversación activa
    const conversation = await getOrCreateConversation(contact.id);

    // 4. Insertar el mensaje
    const { data: message, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        role: isFromUser ? 'user' : 'assistant',
        content: content
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Error insertando mensaje:', insertError);
      throw insertError;
    }

    // 5. Actualizar la fecha del último mensaje en la conversación
    await supabase
      .from('conversations')
      .update({ last_message: new Date().toISOString() })
      .eq('id', conversation.id);

    // 6. Actualizar la fecha del contacto
    await supabase
      .from('contacts')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', contact.id);

    return { contact, conversation, message };
  } catch (error) {
    console.error('Fallo en saveMessage:', error);
    throw error;
  }
}
