-- Migration 006: Create webhook_subscriptions table for user webhook integrations
CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    source text NOT NULL,
    event_types jsonb NOT NULL DEFAULT '[]',
    trigger_action text NOT NULL,
    config jsonb NOT NULL DEFAULT '{}',
    enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can read own subscriptions"
    ON public.webhook_subscriptions FOR SELECT
    USING (auth.uid() IN (
        SELECT id FROM public.users WHERE email = webhook_subscriptions.email
    ));

CREATE POLICY "Users can manage own subscriptions"
    ON public.webhook_subscriptions FOR ALL
    USING (auth.uid() IN (
        SELECT id FROM public.users WHERE email = webhook_subscriptions.email
    ));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_email ON public.webhook_subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_source ON public.webhook_subscriptions(source);
