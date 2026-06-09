import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';

const LOG_PATH = 'C:\\Users\\lucia\\cloudflare_n8n.log';

export async function GET() {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      logger.error(`Tunnel log file not found at ${LOG_PATH}`);
      return NextResponse.json({ error: 'Log file not found' }, { status: 404 });
    }

    const logBuffer = fs.readFileSync(LOG_PATH);
    let logContent = '';
    if (logBuffer[0] === 0xff && logBuffer[1] === 0xfe) {
      logContent = logBuffer.toString('utf16le');
    } else {
      logContent = logBuffer.toString('utf8');
    }
    const match = logContent.match(/(https:\/\/[^\s]+\.trycloudflare\.com)/i);
    
    if (!match) {
      logger.error('Could not find trycloudflare URL in log content');
      return NextResponse.json({ error: 'URL not found in log file' }, { status: 404 });
    }

    const baseUrl = match[1].trim().replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/webhook/vapi-callback`;

    return NextResponse.json({
      baseUrl,
      webhookUrl
    });
  } catch (error: any) {
    logger.error({ err: error.message }, 'Error in GET /api/tunnel');
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
