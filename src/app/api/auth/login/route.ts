import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const crmPassword = process.env.CRM_PASSWORD;

  if (!crmPassword) {
    console.error('[ERROR] CRM_PASSWORD no está configurada en las variables de entorno');
    return NextResponse.json({ success: false }, { status: 500 });
  }

  const { password } = await req.json();

  if (password === crmPassword) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false }, { status: 401 });
}
