import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * ElevenLabs post-call webhook.
 * Receives the full conversation payload after each call ends and extracts
 * the quote logged via the `log_quote` client tool.
 *
 * Configure this URL in ElevenLabs → Post-call webhooks:
 *   https://<your-app>.lovable.app/api/public/elevenlabs/postcall
 */
export const Route = createFileRoute("/api/public/elevenlabs/postcall")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

        // Verify signature (ElevenLabs sends `ElevenLabs-Signature: t=<ts>,v0=<hmac>`)
        if (secret) {
          const header = request.headers.get("elevenlabs-signature") ?? "";
          const parts = Object.fromEntries(
            header.split(",").map((p) => p.trim().split("=") as [string, string]),
          );
          const ts = parts.t;
          const sig = parts.v0;
          if (!ts || !sig) return new Response("bad signature", { status: 401 });
          const expected = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
          const a = Buffer.from(sig, "hex");
          const b = Buffer.from(expected, "hex");
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return new Response("bad signature", { status: 401 });
          }
        }

        let payload: Record<string, unknown>;
        try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

        const dataObj = (payload.data ?? payload) as Record<string, unknown>;
        const dyn = (dataObj?.conversation_initiation_client_data as {
          dynamic_variables?: Record<string, string>;
        })?.dynamic_variables ?? {};
        const jobId = dyn.job_id;
        const dealerId = dyn.dealer_id;
        const dealerName = dyn.dealer_name ?? "Unknown dealer";
        const conversationId = (dataObj?.conversation_id as string) ?? null;
        const transcript = Array.isArray(dataObj?.transcript)
          ? (dataObj.transcript as Array<{ role: string; message: string }>)
              .map((t) => `${t.role}: ${t.message}`).join("\n")
          : (dataObj?.transcript as string) ?? "";

        if (!jobId || !dealerId) {
          return new Response("missing job/dealer identifiers", { status: 400 });
        }

        // Find the log_quote tool call in the transcript, if the agent called it
        const toolCalls =
          (dataObj?.analysis as { tool_calls?: Array<{ name: string; parameters: Record<string, unknown> }> })
            ?.tool_calls ??
          extractToolCallsFromTranscript(dataObj);

        const logged = toolCalls?.find((t) => t.name === "log_quote")?.parameters ?? {};

        const feesRaw = logged.fees_json;
        let fees: Array<{ label: string; amount: number }> = [];
        if (typeof feesRaw === "string" && feesRaw.trim()) {
          try { fees = JSON.parse(feesRaw); } catch { fees = []; }
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        await supabaseAdmin.from("quotes").insert({
          job_id: jobId,
          dealer_id: dealerId,
          dealer_name: dealerName,
          round: 1,
          vehicle_price: numOrNull(logged.vehicle_price),
          out_the_door: numOrNull(logged.out_the_door),
          apr: numOrNull(logged.apr),
          trade_in_offer: numOrNull(logged.trade_in_offer),
          fees,
          add_ons_declined: typeof logged.add_ons_declined === "string"
            ? logged.add_ons_declined.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
          outcome: (logged.outcome as string) ?? "quoted",
          conversation_id: conversationId,
          transcript,
        });

        await supabaseAdmin.from("call_events").insert({
          job_id: jobId, stage: "quote_round", dealer_id: dealerId,
          status: "done",
          message: `${dealerName}: ${logged.outcome ?? "call ended"}${
            logged.out_the_door ? ` · OTD $${Number(logged.out_the_door).toLocaleString()}` : ""
          }`,
        });

        return Response.json({ ok: true });
      },

      OPTIONS: async () => new Response(null, { status: 204 }),
    },
  },
});

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractToolCallsFromTranscript(data: Record<string, unknown>) {
  // Fallback: some payload shapes nest tool calls per-turn
  const turns = data.transcript as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(turns)) return [];
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  for (const t of turns) {
    const tc = t.tool_calls as Array<{ tool_name?: string; name?: string; params_as_json?: string; parameters?: Record<string, unknown> }> | undefined;
    if (!tc) continue;
    for (const c of tc) {
      const name = c.tool_name ?? c.name;
      if (!name) continue;
      let params: Record<string, unknown> = c.parameters ?? {};
      if (!c.parameters && c.params_as_json) {
        try { params = JSON.parse(c.params_as_json); } catch { params = {}; }
      }
      calls.push({ name, parameters: params });
    }
  }
  return calls;
}
