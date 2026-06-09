// C:\Users\lucia\PROJECT_CRM_IA\src\lib\airtable.ts
import { logger } from './logger';

const AIRTABLE_API_URL = 'https://api.airtable.com/v0';

/**
 * Busca un lead en Airtable por número de teléfono y actualiza su ESTADO.
 * Se usa cuando el cliente pide por WhatsApp que lo vuelvan a llamar,
 * para que el flujo de Valentina (n8n Schedule Trigger) lo detecte y lo llame.
 */
export async function updateAirtableLeadStatus(phone: string, newStatus: string): Promise<boolean> {
  const token = process.env.AIRTABLE_API_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableId = process.env.AIRTABLE_TABLE_ID;

  if (!token || !baseId || !tableId) {
    logger.warn('Airtable credentials missing in env variables. Skipping Airtable update.');
    return false;
  }

  // Limpiar el número para la búsqueda (quitar +, espacios, etc.)
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    // 1. Buscar el lead por teléfono en Airtable
    const searchUrl = `${AIRTABLE_API_URL}/${baseId}/${tableId}?filterByFormula=FIND('${cleanPhone}',{Teléfono})>0&maxRecords=1`;

    const searchResponse = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!searchResponse.ok) {
      const errData = await searchResponse.json();
      logger.error({ err: errData, phone: cleanPhone }, 'Error buscando lead en Airtable');
      return false;
    }

    const searchData = await searchResponse.json();
    const records = searchData.records ?? [];

    if (records.length === 0) {
      logger.warn({ phone: cleanPhone }, 'Lead no encontrado en Airtable para actualizar estado');
      return false;
    }

    const recordId = records[0].id;

    // 2. Actualizar el ESTADO del lead encontrado
    const updateUrl = `${AIRTABLE_API_URL}/${baseId}/${tableId}/${recordId}`;

    // Intentar primero con el estado exacto, si falla usar "Nuevo" como fallback
    // (Airtable no permite crear opciones nuevas vía API en plan básico)
    let statusToSet = newStatus;
    let updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          ESTADO: statusToSet
        }
      })
    });

    // Si la opción no existe en Airtable, usar "Nuevo" para que Valentina lo llame igual
    if (!updateResponse.ok) {
      const errCheck = await updateResponse.json();
      if (errCheck?.error?.type === 'INVALID_MULTIPLE_CHOICE_OPTIONS') {
        logger.warn(
          { newStatus, phone },
          `⚠️ La opción "${newStatus}" no existe en Airtable. Usando "Nuevo" como fallback para que Valentina llame al cliente.`
        );
        statusToSet = 'Nuevo';
        updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              ESTADO: statusToSet
            }
          })
        });
      }
    }

    if (!updateResponse.ok) {
      const errData = await updateResponse.json();
      logger.error({ err: errData, phone: cleanPhone, newStatus }, 'Error actualizando lead en Airtable');
      return false;
    }

    logger.info({ phone: cleanPhone, newStatus, recordId }, '✅ Lead actualizado en Airtable correctamente');
    return true;

  } catch (error: any) {
    logger.error({ err: error.message, phone: cleanPhone }, 'Excepción al actualizar Airtable');
    return false;
  }
}
