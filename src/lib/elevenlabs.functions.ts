import { createServerFn } from "@tanstack/react-start";

export const getInterviewToken = createServerFn({ method: "GET" }).handler(
  async () => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");

    // Prefer env override; fallback to system_config once /admin/sync has run.
    let agentId = process.env.ELEVENLABS_AGENT_ID_INTERVIEW ?? null;
    if (!agentId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("system_config")
        .select("value")
        .eq("vertical", "car_buying")
        .eq("key", "agent:interview")
        .maybeSingle();
      const v = data?.value as { id?: string } | null | undefined;
      agentId = v?.id ?? null;
      if (!agentId) throw new Error("Interview agent not provisioned. Visit /admin/sync first.");
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs token error [${res.status}]: ${err}`);
    }
    const { token } = (await res.json()) as { token: string };
    return { token, agentId };
  },
);
