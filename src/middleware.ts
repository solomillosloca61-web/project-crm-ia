import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Exclude webhook routes so Meta and ElevenLabs can send events to the CRM
  if (
    pathname.startsWith('/api/webhook') ||
    pathname.startsWith('/api/tunnel')
  ) {
    return NextResponse.next();
  }

  // 2. Fetch credentials from environment variables (no hardcoded fallback — deny access if unset)
  const username = process.env.CRM_USERNAME;
  const password = process.env.CRM_PASSWORD;

  if (!username || !password) {
    console.error('[ERROR] CRM_USERNAME o CRM_PASSWORD no configuradas');
    return new NextResponse('Configuración de acceso incompleta', { status: 500 });
  }

  // 3. Read the Authorization header
  const authHeader = req.headers.get('authorization');

  if (authHeader) {
    // The header is formatted as: "Basic Base64EncodedCredentials"
    const authValue = authHeader.split(' ')[1];
    if (authValue) {
      try {
        // Decode base64 using atob (Edge Runtime safe)
        const decoded = atob(authValue);
        const index = decoded.indexOf(':');
        
        if (index !== -1) {
          const user = decoded.substring(0, index);
          const pass = decoded.substring(index + 1);

          if (user === username && pass === password) {
            return NextResponse.next();
          }
        }
      } catch (err) {
        console.error('Failed to decode credentials:', err);
      }
    }
  }

  // 4. Request Basic Auth by returning 401 and WWW-Authenticate header
  return new NextResponse('Acceso denegado', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="CRM Privado - MP Salud"',
    },
  });
}

// Matching rules: Protect all paths except Next.js assets, public images, and favicons
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
