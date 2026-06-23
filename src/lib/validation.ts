// C:\Users\lucia\PROJECT_CRM_IA\src\lib\validation.ts
import { z } from 'zod';

export const ContactCreateSchema = z.object({
  phone: z.string().min(1, 'El teléfono es requerido'),
  name: z.string().optional(),
  status: z.string().optional(),
  score: z.union([z.number(), z.string().transform((val) => parseInt(val, 10))]).optional(),
  notes: z.string().optional(),
  transcript: z.string().optional(),
  duration: z.union([z.number(), z.string().transform((val) => parseInt(val, 10))]).optional(),
  recordingUrl: z.string().optional(),
});

export const ContactUpdateSchema = z.object({
  id: z.string().uuid('ID de contacto inválido (debe ser UUID)'),
  name: z.string().optional(),
  status: z.string().optional(),
  score: z.union([z.number(), z.string().transform((val) => parseInt(val, 10))]).optional(),
  notes: z.string().optional(),
  calendly_link: z.string().optional(),
  pause_ai: z.boolean().optional(),
  appointment_date: z.string().nullable().optional(),
});

export const WebhookPayloadSchema = z.object({
  entry: z.array(z.any()).optional(),
  object: z.string().optional(),
  phone: z.string().optional(),
  content: z.string().optional(),
  name: z.string().optional(),
  role: z.string().optional(),
});

export type ContactCreateInput = z.infer<typeof ContactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof ContactUpdateSchema>;
export type WebhookPayloadInput = z.infer<typeof WebhookPayloadSchema>;
