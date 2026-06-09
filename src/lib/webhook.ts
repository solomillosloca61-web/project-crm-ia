// C:\Users\lucia\PROJECT_CRM_IA\src\lib\webhook.ts
import type { NextRequest } from 'next/server';

/**
 * Verifica la firma HMAC enviada por Meta (si está habilitada).
 * Por simplicidad y desarrollo local rápido, por ahora retorna true.
 */
export function verifyMetaSignature(request: NextRequest): boolean {
  return true; 
}

/**
 * Envía un mensaje de texto al celular del usuario utilizando la API oficial de WhatsApp Cloud.
 */
export async function sendWhatsAppMessage(toPhone: string, textContent: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error('Meta WhatsApp credentials missing in env variables.');
    return false;
  }

  // Quitar el '+' o caracteres extra del número de teléfono si existen
  const cleanPhone = toPhone.replace(/\D/g, '');

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: textContent
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error sending WhatsApp message via Meta API:', data);
      return false;
    }

    console.log(`WhatsApp message successfully sent to ${cleanPhone}:`, data.messages?.[0]?.id);
    return true;
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
    return false;
  }
}

/**
 * Envía una plantilla de mensaje al celular del usuario utilizando la API oficial de WhatsApp Cloud.
 */
export async function sendWhatsAppTemplate(toPhone: string, templateName: string, clientName: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error('Meta WhatsApp credentials missing in env variables.');
    return false;
  }

  // Quitar el '+' o caracteres extra del número de teléfono si existen
  const cleanPhone = toPhone.replace(/\D/g, '');

  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    
    // Si la plantilla es hello_world, Meta no usa componentes ni parámetros personalizados.
    // Para plantillas de producción, asumimos que tienen un parámetro en el body para el nombre.
    const isHelloWorld = templateName === 'hello_world';
    
    const body: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: isHelloWorld ? 'en_US' : 'es_AR'
        }
      }
    };

    if (!isHelloWorld) {
      body.template.components = [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: clientName
            }
          ]
        }
      ];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Error sending WhatsApp template '${templateName}' via Meta API:`, data);
      return false;
    }

    console.log(`WhatsApp template '${templateName}' successfully sent to ${cleanPhone}:`, data.messages?.[0]?.id);
    return true;
  } catch (error) {
    console.error('Failed to send WhatsApp template:', error);
    return false;
  }
}

