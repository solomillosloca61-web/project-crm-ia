// C:\Users\lucia\PROJECT_CRM_IA\src\lib\helpers.ts
import { logger } from './logger';

/**
 * Realiza una actualización segura de contacto, reintentando sin la columna 'appointment_date'
 * en caso de que esta columna no exista aún en la base de datos de Supabase.
 */
export async function safeUpdateContact(supabaseClient: any, contactId: string, updateData: any) {
  const dataCopy = { ...updateData };
  
  let { data, error } = await supabaseClient
    .from('contacts')
    .update(dataCopy)
    .eq('id', contactId)
    .select('*')
    .single();

  if (error) {
    // Si el error es debido a la columna 'appointment_date' (código de error 42703 es columna no existente en postgres)
    const isColumnError = error.message?.includes('appointment_date') || error.code === '42703';
    if (isColumnError && 'appointment_date' in dataCopy) {
      logger.warn(`La columna appointment_date no existe en la tabla contacts de Supabase. Reintentando actualización sin ella...`);
      delete dataCopy.appointment_date;
      
      const retry = await supabaseClient
        .from('contacts')
        .update(dataCopy)
        .eq('id', contactId)
        .select('*')
        .single();

      if (retry.error) {
        logger.error(`Error en reintento de safeUpdateContact: ${retry.error.message}`);
        throw retry.error;
      }
      return retry.data;
    }
    
    logger.error(`Error en safeUpdateContact: ${error.message}`);
    throw error;
  }

  return data;
}
