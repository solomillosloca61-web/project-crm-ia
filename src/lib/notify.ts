import { sendWhatsAppMessage } from '@/lib/webhook';

/**
 * Envía una notificación a un número de administrador cuando un lead se califica.
 *
 * @param name   Nombre del contacto
 * @param phone  Teléfono del contacto (raw, sin formato especial)
 * @param score  Puntaje final del lead
 * @param status Estado final del lead (p.ej. "reunion_agendada")
 * @returns true si el mensaje se envió correctamente, false en caso contrario
 */
export async function notifyAdmin(
  name: string,
  phone: string,
  score: number,
  status: string
): Promise<boolean> {
  const adminPhone = '+5491178297354';
  const message = `¡Nuevo Lead Calificado!\nNombre: ${name}\nTeléfono: ${phone}\nScore: ${score}\nEstado: ${status}`;
  return await sendWhatsAppMessage(adminPhone, message);
}
