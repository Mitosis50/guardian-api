-- Migration 005: Create heartbeats table for desktop app health tracking
CREATE TABLE IF NOT EXISTS public.heartbeats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL UNIQUE,
    agent_count integer DEFAULT 0,
    last_backup_at timestamp with time zone,
    tier text DEFAULT 'free',
    app_version text,
    state text DEFAULT 'idle',
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can read own heartbeat"
    ON public.heartbeats FOR SELECT
    USING (auth.uid() IN (
        SELECT id FROM public.users WHERE email = heartbeats.email
    ));

CREATE POLICY "Users can upsert own heartbeat"
    ON public.heartbeats FOR ALL
    USING (auth.uid() IN (
        SELECT id FROM public.users WHERE email = heartbeats.email
    ));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_heartbeats_email ON public.heartbeats(email);
CREATE INDEX IF NOT EXISTS idx_heartbeats_last_seen ON public.heartbeats(last_seen_at);
