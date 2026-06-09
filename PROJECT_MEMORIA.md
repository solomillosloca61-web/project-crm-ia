# 🧠 BÓVEDA DE MEMORIA: CRM + Chatbot MP Salud (Antigravity & Claude Code)

Este archivo actúa como la memoria persistente del proyecto para evitar pérdida de contexto entre sesiones de los agentes de IA (Antigravity y Claude Code). **Por favor, mantén este archivo actualizado tras cada cambio importante.**

---

## 🔐 Credenciales y Variables Críticas
* **Token de Antigravity (x-antigravity-token):** `7cf9e1773eead494a12a78e587057cceb06c184ebeafc6af8d82af654c2fae97`
  *(Guardado en `.env.local` como `ANTIGRAVITY_TOKEN`). Debe usarse en las cabeceras HTTP de las peticiones que haga el script de Antigravity al CRM.*
* **Subdominio del CRM (localtunnel):** `mp-salud-crm` (`https://mp-salud-crm.loca.lt`)
* **Subdominio de n8n (localtunnel):** `valentina-mpsalud` (`https://valentina-mpsalud.loca.lt`)
* **Base de Datos:** Supabase con RLS activo.
  * *Acceso backend/Next.js:* Usa `supabaseService` (Service Role Key) para saltar RLS.
  * *Acceso cliente/público:* Usa `supabase` (Anon Key).

---

## 🛠️ Cambios Implementados (Hoy)
1. **Instalación de Dependencias:** Se instalaron `pino`, `pino-pretty` y `zod` para robustecer el backend Next.js.
2. **Logger Estructurado (`src/lib/logger.ts`):** Logger pino centralizado. Se eliminaron transports (`pino-pretty` interno) para evitar bloqueos del worker thread en Next.js.
3. **Validación Zod (`src/lib/validation.ts`):** Schemas definidos para `ContactCreateSchema`, `ContactUpdateSchema` y `WebhookPayloadSchema` para tipado y validación de entrada estrictos.
4. **Helper de Base de Datos (`src/lib/helpers.ts`):** Creada función `safeUpdateContact` para reintentar actualizaciones si la columna `appointment_date` aún no ha sido migrada en Supabase.
5. **División de Supabase Client (`src/lib/supabase.ts`):** `supabase` usa la clave anónima por defecto (sujeto a RLS) y se exporta `supabaseService` con la Service Role Key para operaciones del servidor.
6. **API Antigravity (`src/app/api/antigravity/contacts/route.ts`):** Endpoint CRUD seguro que requiere autenticación del header `x-antigravity-token`.
7. **Refactorización del Backend:** Las rutas `/api/contacts`, `/api/messages`, `/api/webhook`, `/api/brain`, `/api/cron/followup`, y `/api/stats` fueron actualizadas para usar `supabaseService`, `logger` y validaciones con Zod.
8. **Endurecimiento n8n:** Sanitización de los flujos locales `.json` reemplazando credenciales harcodeadas por variables de entorno de n8n (`{{$env.AIRTABLE_TOKEN}}`, `{{$env.VAPI_API_KEY}}`).
9. **Automatización de Inicio (Windows Autostart):**
   * **Batch Script (`C:\Users\lucia\start-crm-dev.bat`):** Levanta Next.js en puerto 3000 de forma persistente.
   * **VBScript de Inicio (`C:\Users\lucia\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\start-crm-silent.vbs`):** Ejecuta de forma oculta en segundo plano al iniciar sesión:
     1. El CRM (Next.js) en puerto 3000.
     2. n8n en puerto 5678.
     3. El túnel localtunnel del CRM (`mp-salud-crm.loca.lt`).
     4. El túnel localtunnel de n8n (`valentina-mpsalud.loca.lt`).

---

## 📋 Estado del Sistema y Diagnóstico
* **Next.js CRM:** Operativo y corriendo en `http://localhost:3000`.
* **n8n:** Operativo en `http://localhost:5678`.
* **Túneles:** Levantados y apuntando a los puertos locales.
* **Logs del Servidor:** Guardados en `%USERPROFILE%\crm.log` y `%USERPROFILE%\crm_error.log`.
* **Logs de Túneles:** Guardados en `crm_tunnel.log` y `n8n_tunnel.log`.

---

## 🚀 Guía para Claude Code (Aliado de Programación)
Cuando trabajes en este proyecto:
1. **Lógica de Base de Datos:** Recuerda que para cualquier operación del lado del servidor debes importar `supabaseService` desde `@/lib/supabase` (nunca el cliente `supabase` por defecto, ya que usa la clave anónima y RLS te bloqueará la consulta silenciosamente).
2. **Validación:** Si agregas nuevos endpoints, valida los inputs con esquemas Zod en `src/lib/validation.ts`.
3. **Logs:** Usa `logger.info()` y `logger.error()` en lugar de `console.log()` para mantener la trazabilidad.
