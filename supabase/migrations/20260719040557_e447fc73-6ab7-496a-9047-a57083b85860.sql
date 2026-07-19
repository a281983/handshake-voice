
-- Lock down demo tables: keep public read access (needed for tracker + realtime),
-- but only the server (service_role) can insert/update/delete.

DROP POLICY IF EXISTS "open jobs" ON public.jobs;
DROP POLICY IF EXISTS "open quotes" ON public.quotes;
DROP POLICY IF EXISTS "open call_events" ON public.call_events;
DROP POLICY IF EXISTS "open dealers" ON public.dealers;
DROP POLICY IF EXISTS "open system_config" ON public.system_config;

-- Public read (anonymous demo, no PII stored beyond demo inputs)
CREATE POLICY "public read jobs" ON public.jobs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read quotes" ON public.quotes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read call_events" ON public.call_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public read dealers" ON public.dealers FOR SELECT TO anon, authenticated USING (true);
-- system_config: not read from client; no anon policy

-- Revoke write privileges from anon/authenticated; server functions use service_role.
REVOKE INSERT, UPDATE, DELETE ON public.jobs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quotes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.call_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dealers FROM anon, authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.system_config FROM anon, authenticated;

GRANT ALL ON public.jobs, public.quotes, public.call_events, public.dealers, public.system_config TO service_role;
