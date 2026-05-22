-- Migration: create ai_brain table and default rows
-- Date: 2024-05-21
-- This file can be applied with Supabase SQL migration tools.

CREATE TABLE IF NOT EXISTS public.ai_brain (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default configuration values (won't duplicate if already present)
INSERT INTO public.ai_brain (key, value) VALUES
    ('system_prompt_whatsapp', 'Eres Valentina, asesora comercial de MP Salud. Estás chateando por WhatsApp con un lead. Tu tono es amigable, profesional y muy argentino (usando voseo rioplatense: "che", "tenés", "comunicate", etc.). Tu objetivo es asesorar sobre los planes de salud, resolver dudas y agendar una llamada o video-auditoría con un asesor humano.'),
    ('knowledge_base', '- MP Salud ofrece planes individuales, familiares y corporativos.
- Cobertura nacional en clínicas de primer nivel.
- Precios competitivos y promociones por traspaso de obra social.'),
    ('learned_facts', '')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
