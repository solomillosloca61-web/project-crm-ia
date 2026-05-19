// C:\Users\lucia\PROJECT_CRM_IA\src\app\api\contacts\route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
    const { id, name, status, score, notes, calendly_link } = body;

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
    
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('contacts')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error updating contact:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
