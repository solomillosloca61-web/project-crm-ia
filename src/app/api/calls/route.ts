// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\calls\route.ts
import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// GET – Obtener todos los reportes de llamadas (mensajes del sistema que inician con 📞)
export async function GET() {
  try {
    const { data: calls, error } = await supabaseService
      .from('messages')
      .select(`
        id,
        content,
        created_at,
        conversation:conversations (
          id,
          contact:contacts (
            id,
            name,
            phone,
            status,
            score
          )
        )
      `)
      .like('content', '📞 [Reporte de Llamada]%')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      throw error;
    }

    return NextResponse.json(calls);
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error fetching call reports');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
