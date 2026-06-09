// C:\Users\lucia\PROJECT_CRM_IA\src\lib\logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined, // Remueve pid y hostname para mayor limpieza en los logs
  timestamp: pino.stdTimeFunctions.isoTime,
});
