// ─────────────────────────────────────────────────────────────────────────────
// agents.functions.ts — REAL ElevenLabs Conversational AI wiring.
//
// One ElevenLabs Convai Agent is provisioned per dealer persona. When the
// focused call runs, the browser opens a WebRTC session with that agent. Our
// "negotiator" side is an LLM (Lovable AI Gateway) whose next turn is injected
// into the dealer agent via sendUserMessage(). The negotiator turn is also
// TTS'd separately so the user hears both voices. Tool-call logic (record
// quote, end call) lives on the negotiator side, not on the dealer agent.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { getVertical } from "./registry";
import type { JobSpec } from "./types";
import { buildLeveragePacket, leverageBrief } from "./leverage";

const EL_BASE = "https://api.elevenlabs.io/v1";

function requireKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY missing");
  return k;
}

/** Build the ElevenLabs Convai agent config body for a dealer persona. */
function dealerAgentBody(
  cfg: ReturnType<typeof getVertical>,
  persona: ReturnType<typeof getVertical>["personas"][number],
) {
  const L = cfg.labels;
  const firstMessage = `Thanks for calling ${persona.name}, this is ${persona.name.split(" ")[0]}. How can I help you?`;
  return {
    name: `Handshake • ${cfg.id} • ${persona.name}`,
    conversation_config: {
      agent: {
        first_message: firstMessage,
        language: "en",
        prompt: {
          prompt: `${persona.prompt}\n\nYou are answering an inbound phone call from a buyer's assistant. Stay in character. Keep every turn to 1-2 sentences. If asked "are you AI?", say yes and continue naturally. Always drive toward giving or refusing a concrete ${L.bottom_line} number.`,
          llm: "gemini-2.0-flash-001",
          temperature: 0.6,
        },
      },
      tts: { voice_id: persona.voice_id, model_id: "eleven_turbo_v2_5" },
      asr: { quality: "high" },
    },
  };
}

/**
 * Provision one Convai agent per dealer persona for a vertical.
 * Idempotent: existing agent ids are read from system_config first.
 */
export const provisionAgents = createServerFn({ method: "POST" })
  .inputValidator((i: { vertical: string }) => i)
  .handler(async ({ data }) => {
    const key = requireKey();
    const cfg = getVertical(data.vertical);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: Record<string, { agent_id: string; created: boolean }> = {};

    for (const persona of cfg.personas) {
      const configKey = `agent:dealer:${persona.id}`;
      const { data: existing } = await supabaseAdmin
        .from("system_config")
        .select("value")
        .eq("vertical", data.vertical)
        .eq("key", configKey)
        .maybeSingle();
      const existingId = (existing?.value as { id?: string } | null | undefined)?.id;
      if (existingId) {
        results[persona.id] = { agent_id: existingId, created: false };
        continue;
      }

      const res = await fetch(`${EL_BASE}/convai/agents/create`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(dealerAgentBody(cfg, persona)),
      });
      if (!res.ok) {
        throw new Error(`ElevenLabs create agent [${res.status}]: ${await res.text()}`);
      }
      const { agent_id } = (await res.json()) as { agent_id: string };

      await supabaseAdmin.from("system_config").upsert({
        vertical: data.vertical,
        key: configKey,
        value: { id: agent_id },
      });
      results[persona.id] = { agent_id, created: true };
    }
    return { vertical: data.vertical, results };
  });

/** Mint a WebRTC conversation token for a specific dealer persona. */
export const getDealerCallToken = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string; dealerId: string; round: 1 | 2 }) => i)
  .handler(async ({ data }) => {
    const key = requireKey();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("vertical, job_spec")
      .eq("id", data.jobId)
      .single() as { data: any };
    if (!job) throw new Error("Job not found");

    const cfg = getVertical(job.vertical);
    const persona = cfg.personas.find((p) => p.id === data.dealerId);
    if (!persona) throw new Error(`Unknown persona: ${data.dealerId}`);

    // Ensure agent exists (auto-provision on first use).
    const configKey = `agent:dealer:${persona.id}`;
    let { data: existing } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("vertical", job.vertical)
      .eq("key", configKey)
      .maybeSingle();
    let agentId = (existing?.value as { id?: string } | null | undefined)?.id;

    if (!agentId) {
      const res = await fetch(`${EL_BASE}/convai/agents/create`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(dealerAgentBody(cfg, persona)),
      });
      if (!res.ok) throw new Error(`ElevenLabs create agent [${res.status}]: ${await res.text()}`);
      agentId = ((await res.json()) as { agent_id: string }).agent_id;
      await supabaseAdmin.from("system_config").upsert({
        vertical: job.vertical,
        key: configKey,
        value: { id: agentId },
      });
    }

    const res = await fetch(
      `${EL_BASE}/convai/conversation/token?agent_id=${agentId}`,
      { headers: { "xi-api-key": key } },
    );
    if (!res.ok) throw new Error(`ElevenLabs token [${res.status}]: ${await res.text()}`);
    const { token } = (await res.json()) as { token: string };

    return {
      token,
      agentId,
      persona: {
        id: persona.id,
        name: persona.name,
        style: persona.style,
        voice_id: persona.voice_id,
      },
      caller_voice_id: cfg.caller_voice_id,
    };
  });

/**
 * Compute the next NEGOTIATOR turn given the transcript so far.
 * Returns either a spoken line to inject into the dealer agent, or a final
 * quote extraction with `done: true`.
 */
export const nextNegotiatorTurn = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      jobId: string;
      dealerId: string;
      round: 1 | 2;
      transcript: Array<{ speaker: "negotiator" | "dealer"; text: string }>;
    }) => i,
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("vertical, job_spec")
      .eq("id", data.jobId)
      .single() as { data: any };
    if (!job) throw new Error("Job not found");

    const cfg = getVertical(job.vertical);
    const persona = cfg.personas.find((p) => p.id === data.dealerId);
    if (!persona) throw new Error(`Unknown persona: ${data.dealerId}`);
    const spec = job.job_spec as JobSpec;
    const L = cfg.labels;

    // Build leverage brief for round 2.
    let leverage = "";
    if (data.round === 2) {
      const { data: r1rows } = await supabaseAdmin
        .from("quotes")
        .select("dealer_id, dealer_name, round, line_items, add_ons_declined, bottom_line, outcome, transcript, quote_source_turns")
        .eq("job_id", data.jobId)
        .eq("round", 1);
      const rows = (r1rows ?? []).map((r: any) => ({
        dealer_id: r.dealer_id,
        dealer_name: r.dealer_name,
        round: 1 as const,
        line_items: r.line_items ?? [],
        add_ons_declined: r.add_ons_declined ?? [],
        bottom_line: r.bottom_line,
        outcome: r.outcome ?? "quoted",
        transcript: r.transcript ?? "",
        quote_source_turns: r.quote_source_turns ?? [],
      }));
      if (rows.length) {
        const packet = buildLeveragePacket(cfg, rows, data.dealerId);
        leverage = leverageBrief(cfg, packet);
      }
    }

    const jobDesc = cfg.spec_schema
      .filter((s) => spec.fields[s.id] != null && spec.fields[s.id] !== "")
      .map((s) => {
        const v = spec.fields[s.id];
        return `${s.label}: ${Array.isArray(v) ? v.join(", ") : v}`;
      })
      .join(" · ");

    const system = [
      `You are Handshake, a sharp, wickedly funny buying assistant on the phone with a ${L.counterparty} named ${persona.name}.`,
      `Client brief: ${jobDesc}`,
      data.round === 1
        ? `Round 1: Get an itemized ${L.bottom_line} — base price + every fee by name. Decline upsells politely.`
        : `Round 2 (NEGOTIATION CALLBACK): You are a nice-but-relentless closer. Use this competing leverage: ${leverage}. Push for a lower number.`,
      `RULES:`,
      `- Reply with ONE short line (1-2 sentences) — this is a phone call.`,
      `- Never invent competing offers you don't have.`,
      `- When you have a firm final ${L.bottom_line} number OR the dealer clearly refuses, respond with the special JSON: {"done": true, "bottom_line": <number|null>, "line_items": [{"label":"...","amount":n}], "add_ons_declined":["..."], "outcome": "quoted"|"declined"|"callback"}`,
      `- Otherwise respond with plain text ONE line — no JSON, no quotes, no stage directions. Just what you'd say out loud.`,
      `- If the transcript is empty, greet and open with your ask.`,
      `- Never let the call drag past 8-10 exchanges.`,
    ].join("\n");

    const messages = [
      { role: "system", content: system },
      ...data.transcript.map((t) => ({
        role: t.speaker === "negotiator" ? "assistant" : "user",
        content: t.text,
      })),
    ];

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY missing");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`LLM [${res.status}]: ${await res.text()}`);
    const payload = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    const raw = (payload.choices[0]?.message?.content ?? "").trim();

    // Try JSON first (done signal).
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && parsed.done) {
          return {
            done: true as const,
            text: null,
            quote: {
              line_items: parsed.line_items ?? [],
              bottom_line: parsed.bottom_line ?? null,
              add_ons_declined: parsed.add_ons_declined ?? [],
              outcome: parsed.outcome ?? "quoted",
            },
          };
        }
      } catch { /* fall through */ }
    }
    return { done: false as const, text: raw, quote: null };
  });

/** Persist the extracted quote at the end of a live call. */
export const recordLiveQuote = createServerFn({ method: "POST" })
  .inputValidator(
    (i: {
      jobId: string;
      dealerId: string;
      round: 1 | 2;
      transcript: Array<{ speaker: "negotiator" | "dealer"; text: string }>;
      quote: {
        line_items: Array<{ label: string; amount: number }>;
        bottom_line: number | null;
        add_ons_declined: string[];
        outcome: string;
      };
    }) => i,
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("vertical")
      .eq("id", data.jobId)
      .single() as { data: any };
    if (!job) throw new Error("Job not found");
    const cfg = getVertical(job.vertical);
    const persona = cfg.personas.find((p) => p.id === data.dealerId);
    if (!persona) throw new Error(`Unknown persona: ${data.dealerId}`);

    const transcriptStr = data.transcript
      .map((t) => `${t.speaker === "negotiator" ? "CALLER" : "COUNTERPARTY"}: ${t.text}`)
      .join("\n");

    await supabaseAdmin.from("quotes").insert({
      job_id: data.jobId,
      dealer_id: persona.id,
      dealer_name: persona.name,
      round: data.round,
      vehicle_price: data.quote.line_items[0]?.amount ?? null,
      bottom_line: data.quote.bottom_line,
      line_items: data.quote.line_items,
      fees: data.quote.line_items.slice(1),
      add_ons_declined: data.quote.add_ons_declined,
      outcome: data.quote.outcome,
      transcript: transcriptStr,
      quote_source_turns: [],
    });

    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: data.round === 1 ? "quote_round" : "negotiation_round",
      dealer_id: persona.id,
      status: "done",
      message: `${persona.name} — round ${data.round} (LIVE): $${(data.quote.bottom_line ?? 0).toLocaleString()} ${cfg.labels.bottom_line}`,
    });

    return { ok: true };
  });
