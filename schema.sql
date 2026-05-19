-- Supabase schema for CRM + WhatsApp Chatbot
-- ===========================================
-- Tables

-- contacts: información del prospecto / cliente
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  phone         text unique not null,
  name          text,
  email         text,
  source        text default 'whatsapp',
  status        text default 'nuevo',
  -- valores: nuevo | en_conversacion | lead_frio | lead_calificado | reunion_agendada | cliente
  score         int default 0,
  notes         text,
  calendly_link text,
  created_at    timestamptz default now(),
  pause_ai      boolean default false,
  updated_at    timestamptz default now()
);

-- conversations: conversación entre usuario y agente
create table conversations (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid references contacts(id) on delete cascade,
  started_at    timestamptz default now(),
  last_message  timestamptz default now(),
  intent        text,
  -- valores: consulta | queja | turno | informacion | otro
  resolved      boolean default false
);

-- messages: cada mensaje dentro de una conversación
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role            text not null,  -- 'user' | 'assistant' | 'system'
  content         text not null,
  tokens_used     int,
  created_at      timestamptz default now()
);

-- ==============================
-- Row Level Security (RLS)
-- ==============================
-- Habilitar RLS en todas las tablas de producción
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

-- Políticas básicas (solo permitir que el owner del Row-Level Security (el servicio) realice operaciones)
-- En caso de querer un acceso granular, se pueden extender estas políticas.

-- contacts
create policy "allow select on contacts for authenticated" on contacts
  using (auth.uid() is not null);
create policy "allow insert on contacts for authenticated" on contacts
  with check (auth.uid() is not null);
create policy "allow update on contacts for authenticated" on contacts
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "allow delete on contacts for authenticated" on contacts
  using (auth.uid() is not null);

-- conversations
create policy "allow select on conversations for authenticated" on conversations
  using (auth.uid() is not null);
create policy "allow insert on conversations for authenticated" on conversations
  with check (auth.uid() is not null);
create policy "allow update on conversations for authenticated" on conversations
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "allow delete on conversations for authenticated" on conversations
  using (auth.uid() is not null);

-- messages
create policy "allow select on messages for authenticated" on messages
  using (auth.uid() is not null);
create policy "allow insert on messages for authenticated" on messages
  with check (auth.uid() is not null);
create policy "allow update on messages for authenticated" on messages
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "allow delete on messages for authenticated" on messages
  using (auth.uid() is not null);

-- Nota: En producción, considerá crear políticas más restrictivas que distingan roles (admin, agente, cliente).

-- ------------------------------------------------------------
-- Tabla opcional para registrar envíos del cron de follow‑up
-- ------------------------------------------------------------
create table followup_logs (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid references contacts(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete cascade,
  sent_at          timestamptz default now(),
  message_text     text not null,
  success          boolean default false
);

-- Habilitar RLS para la tabla de logs (solo el backend debería escribir)
alter table followup_logs enable row level security;
create policy "allow insert on followup_logs for authenticated" on followup_logs
  using (auth.uid() is not null);

