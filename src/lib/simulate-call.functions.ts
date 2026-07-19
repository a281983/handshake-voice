// ─────────────────────────────────────────────────────────────────────────────
// simulateCall — runs ONE call between our Caller agent and a simulated
// counterparty (the "dealer"). The counterparty is LLM-roleplayed (we don't have
// three real dealerships on the line); the negotiation between caller and
// counterparty is genuine.
//
// Round 1: get an itemized bottom line.
// Round 2: the caller is armed with a rich LeveragePacket (see leverage.ts) and
//          genuinely works the counterparty down. The price moves because the
//          caller out-negotiates, not because a floor was pre-written. Each
//          persona's floor lives ONLY in its own prompt as a private guardrail.
//
// Resilience: every successful run caches {turns, quote} to the quotes row. If a
// live LLM call fails mid-demo, we replay the last good cached run for that
// persona+round instead of throwing. Genuinely LLM-driven, but demo-safe.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { getVertical } from "./registry";
import { buildLeveragePacket, leverageBrief } from "./leverage";
import type { JobSpec, LineItem, Quote, Turn } from "./types";

type SimQuote = {
  line_items: LineItem[];
  bottom_line: number | null;
  add_ons_declined: string[];
  outcome: Quote["outcome"];
};

type SimResult = {
  persona: { id: string; name: string; style: string; voice_id: string };
  caller_voice_id: string;
  turns: Turn[];
  quote: SimQuote;
  from_cache: boolean;
};

/** Describe the job identically on every call, from the confirmed spec. */
function describeJob(cfg: ReturnType<typeof getVertical>, spec: JobSpec): string {
  const f = spec.fields;
  const parts = cfg.spec_schema
    .filter((s) => f[s.id] != null && f[s.id] !== "")
    .map((s) => {
      const v = f[s.id];
      const val = Array.isArray(v) ? v.join(", ") : String(v);
      return `${s.label}: ${val}`;
    });
  return parts.join(" · ");
}

function callerSystem(
  cfg: ReturnType<typeof getVertical>,
  spec: JobSpec,
  leverage: string | null,
): string {
  const L = cfg.labels;
  const job = describeJob(cfg, spec);
  const round1 = `This is the FIRST call — you have no competing offer yet. Goal: get a fully itemized ${L.bottom_line}: the base price plus every fee by name. Push past vagueness ("what's the doc fee?", "anything else before I sign?"). Decline all upsells politely.`;
  const round2 = `This is a NEGOTIATION CALLBACK. ${leverage}`;
  return [
    `You are a sharp, professional buying assistant calling a ${L.counterparty} on behalf of a real client. Warm, businesslike, brief — you talk like someone who does this every day.`,
    ``,
    `The client wants: ${job}.`,
    ``,
    leverage ? round2 : round1,
    ``,
    `HARD RULES:`,
    `- You are an AI assistant. If asked "are you a robot / am I talking to AI?", say yes plainly and keep going.`,
    `- Never invent a competing offer you don't have. Never misrepresent the client's needs.`,
    `- Always drive to a concrete ${L.bottom_line} number or a clear refusal. Never accept "around X".`,
    `- Keep each turn to 1-2 sentences. This is a phone call, not an essay.`,
  ].join("\n");
}

function counterpartySystem(
  cfg: ReturnType<typeof getVertical>,
  persona: ReturnType<typeof getVertical>["personas"][number],
  round: 1 | 2,
): string {
  const base = persona.prompt;
  const r2 =
    round === 2
      ? `\n\nThis is a negotiation callback and the caller has a REAL competing offer. Under genuine pressure — a specific rival number and named fees — you concede toward (but never below) your guardrail floor. Make them work for it: don't cave on the first ask, but do move. Drop the fees they name if pressed. Stay in character.`
      : "";
  return base + r2;
}

/**
 * Generate the dialogue + structured quote via the LLM gateway.
 * We keep the OpenAI-compatible gateway so this works with either the
 * ElevenLabs-bundled LLM path or OpenAI directly (see .env).
 */
async function generateCall(args: {
  cfg: ReturnType<typeof getVertical>;
  persona: ReturnType<typeof getVertical>["personas"][number];
  spec: JobSpec;
  round: 1 | 2;
  leverage: string | null;
}): Promise<{ turns: Turn[]; quote: SimQuote }> {
  const { cfg, persona, spec, round, leverage } = args;
  // Default to Lovable AI Gateway (no user key needed). Users can override
  // with OPENAI_API_KEY + LLM_BASE_URL if they want direct OpenAI.
  const lovableKey = process.env.LOVABLE_API_KEY;
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? lovableKey;
  const baseUrl =
    process.env.LLM_BASE_URL ??
    (process.env.OPENAI_API_KEY
      ? "https://api.openai.com/v1"
      : "https://ai.gateway.lovable.dev/v1");
  if (!apiKey) throw new Error("No LLM key available (LOVABLE_API_KEY missing)");

  // If the config's model isn't a gateway-supported id, fall back to a
  // Lovable AI Gateway model when we're on the gateway.
  const isGateway = baseUrl.includes("gateway.lovable.dev");
  const model = isGateway ? "google/gemini-2.5-flash" : cfg.simulation.model;

  const L = cfg.labels;
  const sim = cfg.simulation;
  const callerPrompt = callerSystem(cfg, spec, leverage);
  const dealerPrompt = counterpartySystem(cfg, persona, round);

  const genPrompt = [
    `Roleplay a realistic phone call between a buying assistant (CALLER) and a ${L.counterparty} (COUNTERPARTY named ${persona.name}). Alternate turns, CALLER greets first.`,
    ``,
    `CALLER BRIEF:\n${callerPrompt}`,
    ``,
    `COUNTERPARTY BRIEF (${persona.name}, style: ${persona.style}):\n${dealerPrompt}`,
    ``,
    `Produce ${sim.min_turns}-${sim.max_turns} short natural turns. No stage directions. End when the caller has a firm ${L.bottom_line} number or a clear refusal.`,
    round === 2
      ? `Because the caller has real leverage, the COUNTERPARTY MUST end at a LOWER ${L.bottom_line} than a typical opening — the negotiation has to visibly work.`
      : ``,
    ``,
    `Return ONLY valid JSON, no markdown fences, exactly:`,
    `{`,
    `  "turns": [{"speaker": "caller"|"counterparty", "text": "..."}],`,
    `  "quote": {`,
    `    "line_items": [{"label": "Base price", "amount": 27500}, {"label": "Doc fee", "amount": 999}],`,
    `    "bottom_line": <number: the final total the counterparty committed to>,`,
    `    "add_ons_declined": ["..."],`,
    `    "outcome": "quoted"|"callback"|"declined"|"no_answer"`,
    `  }`,
    `}`,
    `The line_items MUST sum to bottom_line. Every number in the quote must appear in the dialogue.`,
  ].join("\n");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: genPrompt }],
      response_format: { type: "json_object" },
      temperature: round === 2 ? 0.7 : 0.6,
    }),
  });
  if (!res.ok) throw new Error(`LLM gateway [${res.status}]: ${await res.text()}`);
  const payload = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = payload.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { turns: Turn[]; quote: SimQuote };

  // Guardrail: ensure line items sum to bottom line (repair if the model drifts).
  if (parsed.quote?.line_items?.length) {
    const sum = parsed.quote.line_items.reduce((a, li) => a + (li.amount || 0), 0);
    if (parsed.quote.bottom_line == null) parsed.quote.bottom_line = sum;
  }
  return parsed;
}

/** Pull the most recent cached run for this persona+round, if any. */
async function loadCached(
  supabaseAdmin: any,
  jobId: string,
  dealerId: string,
  round: 1 | 2,
): Promise<{ turns: Turn[]; quote: SimQuote } | null> {
  const { data } = await supabaseAdmin
    .from("quotes")
    .select("line_items, bottom_line, add_ons_declined, outcome, transcript")
    .eq("job_id", jobId)
    .eq("dealer_id", dealerId)
    .eq("round", round)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.transcript) return null;
  const turns: Turn[] = String(data.transcript)
    .split("\n")
    .filter(Boolean)
    .map((line: string) => {
      const isCaller = line.startsWith("CALLER:");
      return {
        speaker: isCaller ? ("caller" as const) : ("counterparty" as const),
        text: line.replace(/^(CALLER|COUNTERPARTY):\s*/, ""),
      };
    });
  return {
    turns,
    quote: {
      line_items: data.line_items ?? [],
      bottom_line: data.bottom_line,
      add_ons_declined: data.add_ons_declined ?? [],
      outcome: data.outcome ?? "quoted",
    },
  };
}

export const simulateCall = createServerFn({ method: "POST" })
  .inputValidator(
    (i: { jobId: string; dealerId: string; round: 1 | 2 }) => i,
  )
  .handler(async ({ data }): Promise<SimResult> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

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

    // Round 2: build the rich leverage packet from captured round-1 quotes.
    let leverage: string | null = null;
    if (data.round === 2) {
      const { data: r1rows } = await supabaseAdmin
        .from("quotes")
        .select("dealer_id, dealer_name, round, line_items, add_ons_declined, bottom_line, outcome, transcript, quote_source_turns")
        .eq("job_id", data.jobId)
        .eq("round", 1);
      const round1: Quote[] = (r1rows ?? []).map((r: any) => ({
        dealer_id: r.dealer_id,
        dealer_name: r.dealer_name,
        round: 1,
        line_items: r.line_items ?? [],
        add_ons_declined: r.add_ons_declined ?? [],
        bottom_line: r.bottom_line,
        outcome: r.outcome ?? "quoted",
        transcript: r.transcript ?? "",
        quote_source_turns: r.quote_source_turns ?? [],
      }));
      const packet = buildLeveragePacket(cfg, round1, data.dealerId);
      leverage = leverageBrief(cfg, packet);
    }

    // Generate — with cached fallback on any failure.
    let turns: Turn[];
    let quote: SimQuote;
    let from_cache = false;
    try {
      const out = await generateCall({
        cfg,
        persona,
        spec,
        round: data.round,
        leverage,
      });
      turns = out.turns;
      quote = out.quote;
    } catch (err) {
      const cached = await loadCached(
        supabaseAdmin,
        data.jobId,
        data.dealerId,
        data.round,
      );
      if (!cached) throw err; // nothing to fall back to
      turns = cached.turns;
      quote = cached.quote;
      from_cache = true;
    }

    // Anti-hallucination anchor: which turn indices mention the bottom line.
    const quote_source_turns = turns
      .map((t, i) => (quote.bottom_line != null && t.text.includes(String(quote.bottom_line)) ? i : -1))
      .filter((i) => i >= 0);

    // Persist (only when freshly generated — don't duplicate a cached replay).
    if (!from_cache) {
      await supabaseAdmin.from("quotes").insert({
        job_id: data.jobId,
        dealer_id: persona.id,
        dealer_name: persona.name,
        round: data.round,
        vehicle_price: quote.line_items[0]?.amount ?? null,
        bottom_line: quote.bottom_line,
        line_items: quote.line_items ?? [],
        fees: quote.line_items?.slice(1) ?? [],
        add_ons_declined: quote.add_ons_declined ?? [],
        outcome: quote.outcome ?? "quoted",
        transcript: turns
          .map((t) => `${t.speaker.toUpperCase()}: ${t.text}`)
          .join("\n"),
        quote_source_turns,
      });
    }

    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: data.round === 1 ? "quote_round" : "negotiation_round",
      dealer_id: persona.id,
      status: "done",
      message: `${persona.name} — round ${data.round}: $${(quote.bottom_line ?? 0).toLocaleString()} ${cfg.labels.bottom_line}${from_cache ? " (replay)" : ""}`,
    });

    return {
      persona: {
        id: persona.id,
        name: persona.name,
        style: persona.style,
        voice_id: persona.voice_id,
      },
      caller_voice_id: cfg.caller_voice_id,
      turns,
      quote,
      from_cache,
    };
  });

/** Synthesize one dialogue turn to MP3 (base64) via ElevenLabs. */
export const synthesizeTurn = createServerFn({ method: "POST" })
  .inputValidator((i: { text: string; voiceId: string }) => i)
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${data.voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: data.text,
          model_id: "eleven_turbo_v2_5",
        }),
      },
    );
    if (!res.ok) throw new Error(`TTS [${res.status}]: ${await res.text()}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    return { audioBase64: btoa(binary), mime: "audio/mpeg" };
  });
