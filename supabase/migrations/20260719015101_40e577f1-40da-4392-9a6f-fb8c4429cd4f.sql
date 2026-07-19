
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vertical TEXT NOT NULL,
  job_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  stage TEXT NOT NULL DEFAULT 'intake',
  report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO anon, authenticated;
GRANT ALL ON public.jobs TO service_role;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open jobs" ON public.jobs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.quotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  dealer_id TEXT NOT NULL,
  dealer_name TEXT NOT NULL,
  round INT NOT NULL DEFAULT 1,
  vehicle_price NUMERIC,
  bottom_line NUMERIC,
  out_the_door NUMERIC,
  apr NUMERIC,
  trade_in_offer NUMERIC,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  fees JSONB NOT NULL DEFAULT '[]'::jsonb,
  add_ons_declined JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome TEXT NOT NULL DEFAULT 'quoted',
  transcript TEXT,
  conversation_id TEXT,
  quote_source_turns JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO anon, authenticated;
GRANT ALL ON public.quotes TO service_role;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open quotes" ON public.quotes FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.call_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  dealer_id TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  message TEXT,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_events TO anon, authenticated;
GRANT ALL ON public.call_events TO service_role;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open call_events" ON public.call_events FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.dealers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  dealer_id TEXT NOT NULL,
  dealer_name TEXT NOT NULL,
  style TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, dealer_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealers TO anon, authenticated;
GRANT ALL ON public.dealers TO service_role;
ALTER TABLE public.dealers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open dealers" ON public.dealers FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.system_config (
  vertical TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vertical, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_config TO anon, authenticated;
GRANT ALL ON public.system_config TO service_role;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open system_config" ON public.system_config FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for pizza-tracker UI
ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
