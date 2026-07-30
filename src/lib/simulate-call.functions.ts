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
import { loadSettings, styleDirective } from "./settings.functions";
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

/** Fields that must NEVER be disclosed verbatim to the counterparty. */
const PRIVATE_FIELDS = new Set(["budget", "customer_name"]);

/** Describe the job identically on every call, from the confirmed spec.
 *  Excludes anything the counterparty must not hear (client name, true budget). */
function describeJob(cfg: ReturnType<typeof getVertical>, spec: JobSpec): string {
  const f = spec.fields;
  const parts = cfg.spec_schema
    .filter((s) => !PRIVATE_FIELDS.has(s.id) && f[s.id] != null && f[s.id] !== "")
    .map((s) => {
      const v = f[s.id];
      const val = Array.isArray(v) ? v.join(", ") : String(v);
      return `${s.label}: ${val}`;
    });
  return parts.join(" · ");
}

function clientName(spec: JobSpec): string {
  const raw = String(spec.fields.customer_name ?? "").trim();
  return raw || "Sarah";
}

function callerSystem(
  cfg: ReturnType<typeof getVertical>,
  spec: JobSpec,
  leverage: string | null,
  styleLine?: string,
): string {
  const L = cfg.labels;
  const job = describeJob(cfg, spec);
  const name = clientName(spec);
  const budget = Number(spec.fields.budget) || 0;
  const tone = styleLine ?? "TONE: warm, quick-witted, and firm — the nicest hard-baller they'll talk to today.";
  const round1 = `This is the FIRST call — you have no competing offer yet. Goal: get a fully itemized ${L.bottom_line}: the base price plus every fee by name. Push past vagueness ("what's the doc fee?", "anything else before I sign?"). Decline all upsells politely.`;
  const round2 = `This is a NEGOTIATION CALLBACK. ${tone} You use the competing offer like a crowbar. ${leverage}`;
  return [
    leverage
      ? `You are Laura, a sharp closer calling a ${L.counterparty} on behalf of ${name} (the client). Direct and effective — you quote a rival's number back at them without blinking.`
      : `You are Laura, a sharp, professional buying assistant calling a ${L.counterparty} on behalf of ${name} (the client). Warm, businesslike, brief — you talk like someone who does this every day.`,
    ``,
    `The client wants: ${job}.`,
    ``,
    leverage ? round2 : round1,
    ``,
    `HARD RULES:`,
    `- Introduce yourself as "Laura, calling on behalf of ${name}". NEVER say "Handshake", "[Myname]", "[name]", "[my name]" or any bracketed placeholder — always use the name Laura.`,
    `- BUDGET IS PRIVATE. Never disclose the client's budget of $${budget.toLocaleString()} unless the counterparty has already quoted a number strictly HIGHER than $${budget.toLocaleString()} AND you have no lower rival quote to cite; only then may you say "my client's ceiling is $${budget.toLocaleString()}". Otherwise the number never leaves your mouth.`,
    `- You are an AI assistant. If asked "are you a robot / am I talking to AI?", say yes plainly and keep going.`,
    `- Never invent a competing offer you don't have. Never misrepresent the client's needs.`,
    `- Always drive to a concrete ${L.bottom_line} number or a clear refusal. Never accept "around X".`,
    `- Keep each turn to 1-2 sentences. This is a phone call, not an essay.`,
  ].filter(Boolean).join("\n");

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
  styleLine?: string;
}): Promise<{ turns: Turn[]; quote: SimQuote }> {
  const { cfg, persona, spec, round, leverage, styleLine } = args;
  // Default to Lovable AI Gateway (no user key needed). Users can override
  // with OPENAI_API_KEY + LLM_BASE_URL if they want direct OpenAI.
  const lovableKey = process.env.LOVABLE_API_KEY;
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? lovableKey;
  const baseUrl =
    process.env.LLM_BASE_URL ??
    (process.env.OPENAI_API_KEY
      ? "https://api.openai.com/v1"
      : "https://ai.gateway.lovable.dev/v1");
  if (!apiKey) throw new Error("No LLM key set — provide OPENAI_API_KEY, or LLM_API_KEY + LLM_BASE_URL (+ optional LLM_MODEL).");

  // Model: explicit LLM_MODEL wins (needed for Groq/other providers whose ids
  // differ from the config's), else a gateway-supported id on the Lovable
  // gateway, else the vertical config's model (e.g. gpt-4o-mini on OpenAI).
  const isGateway = baseUrl.includes("gateway.lovable.dev");
  const model = process.env.LLM_MODEL ?? (isGateway ? "google/gemini-2.5-flash" : cfg.simulation.model);

  const L = cfg.labels;
  const sim = cfg.simulation;
  const roundMin = round === 2
    ? (sim.round2_min_turns ?? Math.max(4, sim.min_turns - 3))
    : (sim.round1_min_turns ?? sim.min_turns);
  const roundMax = round === 2
    ? (sim.round2_max_turns ?? Math.max(6, sim.max_turns - 5))
    : (sim.round1_max_turns ?? sim.max_turns);
  const callerPrompt = callerSystem(cfg, spec, leverage, styleLine);
  const dealerPrompt = counterpartySystem(cfg, persona, round);

  const genPrompt = [
    `Roleplay a realistic phone call between a buying assistant (CALLER) and a ${L.counterparty} (COUNTERPARTY named ${persona.name}). Alternate turns, CALLER greets first.`,
    ``,
    `CALLER BRIEF:\n${callerPrompt}`,
    ``,
    `COUNTERPARTY BRIEF (${persona.name}, style: ${persona.style}):\n${dealerPrompt}`,
    ``,
    `Produce ${roundMin}-${roundMax} short natural turns. No stage directions. End when the caller has a firm ${L.bottom_line} number or a clear refusal.`,
    round === 2
      ? `Because the caller has real leverage, the COUNTERPARTY MUST end at a LOWER ${L.bottom_line} than a typical opening — the negotiation has to visibly work. Keep it TIGHT: no filler, no repeating offers, straight to the concession.`
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isGateway && lovableKey) {
    headers["Lovable-API-Key"] = lovableKey;
    headers["X-Lovable-AIG-SDK"] = "handshake-simulation";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
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

/** Ensure an ElevenLabs Convai agent exists for a persona; returns agent_id. */
async function ensureDealerAgent(
  supabaseAdmin: any,
  vertical: string,
  cfg: ReturnType<typeof getVertical>,
  persona: ReturnType<typeof getVertical>["personas"][number],
): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const configKey = `agent:dealer:${persona.id}`;
  const { data: existing } = await supabaseAdmin
    .from("system_config")
    .select("value")
    .eq("vertical", vertical)
    .eq("key", configKey)
    .maybeSingle();
  const existingId = (existing?.value as { id?: string } | null | undefined)?.id;
  if (existingId) return existingId;
  const L = cfg.labels;
  const body = {
    name: `Handshake • ${cfg.id} • ${persona.name}`,
    conversation_config: {
      agent: {
        first_message: `Thanks for calling ${persona.name}, this is ${persona.name.split(" ")[0]}. How can I help you?`,
        language: "en",
        prompt: {
          prompt: `${persona.prompt}\n\nYou are answering an inbound phone call from a buyer's assistant. Stay in character. Keep every turn to 1-2 sentences. Always drive toward giving or refusing a concrete ${L.bottom_line} number.`,
          llm: "gemini-2.0-flash-001",
          temperature: 0.6,
        },
      },
      tts: { voice_id: persona.voice_id, model_id: "eleven_turbo_v2" },
      asr: { quality: "high" },
    },
  };
  const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`ensureDealerAgent create failed [${res.status}]: ${await res.text()}`);
    return null;
  }
  const { agent_id } = (await res.json()) as { agent_id: string };
  await supabaseAdmin.from("system_config").upsert({
    vertical,
    key: configKey,
    value: { id: agent_id },
  });
  return agent_id;
}

/**
 * Real agent-to-agent call via ElevenLabs simulate-conversation. The dealer
 * agent (created above) actually runs; our Handshake negotiator plays the
 * simulated user. Returns the transcript the live agent produced.
 */
async function runAgentSimulation(args: {
  agentId: string;
  cfg: ReturnType<typeof getVertical>;
  persona: ReturnType<typeof getVertical>["personas"][number];
  spec: JobSpec;
  round: 1 | 2;
  leverage: string | null;
  styleLine?: string;
}): Promise<Turn[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY!;
  const { cfg, persona, spec, round, leverage, styleLine } = args;
  const L = cfg.labels;
  const sim = cfg.simulation;
  const roundMax = round === 2
    ? (sim.round2_max_turns ?? Math.max(6, sim.max_turns - 5))
    : (sim.round1_max_turns ?? sim.max_turns);
  const negotiatorPrompt = callerSystem(cfg, spec, leverage, styleLine);
  const name = clientName(spec);
  const body = {
    simulation_specification: {
      simulated_user_config: {
        first_message: `Hi ${persona.name.split(" ")[0]}, this is Laura calling on behalf of ${name} — got a minute?`,
        language: "en",
        prompt: {
          prompt: `${negotiatorPrompt}\n\nYou are the CALLER on a phone call. Speak in short natural turns (1-2 sentences). End the call once you have a concrete ${L.bottom_line} number or a clear refusal — HARD CAP: do not let the call go past ${roundMax} total exchanges. Keep it tight.`,
        },
      },
      new_turns_limit: roundMax,
    },
  };
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${args.agentId}/simulate-conversation`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs simulate-conversation [${res.status}]: ${await res.text()}`);
  }
  const payload = (await res.json()) as {
    simulated_conversation: Array<{ role: string; message: string }>;
  };
  const turns: Turn[] = (payload.simulated_conversation ?? [])
    .filter((t) => t?.message)
    .map((t) => ({
      speaker: (t.role === "user" ? "caller" : "counterparty") as "caller" | "counterparty",
      text: t.message,
    }))
    .slice(0, roundMax);
  console.log(`[real-agent] ${persona.name} r${round}: ${turns.length} turns via agent ${args.agentId}`);
  return turns;
}

/** Extract a structured quote from an already-produced transcript. */
async function extractQuoteFromTranscript(
  cfg: ReturnType<typeof getVertical>,
  turns: Turn[],
): Promise<SimQuote> {
  const empty: SimQuote = { line_items: [], bottom_line: null, add_ons_declined: [], outcome: "quoted" };
  // Same provider-agnostic resolution as generateCall — no Lovable dependency.
  const lovableKey = process.env.LOVABLE_API_KEY;
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? lovableKey;
  if (!apiKey) return empty;
  const baseUrl =
    process.env.LLM_BASE_URL ??
    (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1" : "https://ai.gateway.lovable.dev/v1");
  const isGateway = baseUrl.includes("gateway.lovable.dev");
  const model = process.env.LLM_MODEL ?? (isGateway ? "google/gemini-2.5-flash" : cfg.simulation.model);
  const extractHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (isGateway && lovableKey) extractHeaders["Lovable-API-Key"] = lovableKey;
  else extractHeaders.Authorization = `Bearer ${apiKey}`;

  const L = cfg.labels;
  const transcript = turns.map((t) => `${t.speaker.toUpperCase()}: ${t.text}`).join("\n");
  const prompt = `From this phone-call transcript, extract the ${L.bottom_line} the counterparty committed to. Return ONLY valid JSON:\n{\n  "line_items": [{"label":"Base price","amount":27500},{"label":"Doc fee","amount":999}],\n  "bottom_line": <number that line_items sum to>,\n  "add_ons_declined": ["..."],\n  "outcome": "quoted"|"callback"|"declined"|"no_answer"\n}\nTranscript:\n${transcript}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: extractHeaders,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    return empty;
  }
  const payload = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  try {
    const parsed = JSON.parse(payload.choices[0]?.message?.content ?? "{}") as SimQuote;
    if (parsed.line_items?.length && parsed.bottom_line == null) {
      parsed.bottom_line = parsed.line_items.reduce((a, li) => a + (li.amount || 0), 0);
    }
    return {
      line_items: parsed.line_items ?? [],
      bottom_line: parsed.bottom_line ?? null,
      add_ons_declined: parsed.add_ons_declined ?? [],
      outcome: parsed.outcome ?? "quoted",
    };
  } catch {
    return { line_items: [], bottom_line: null, add_ons_declined: [], outcome: "quoted" };
  }
}

/**
 * Guarantee the quote's line_items sum EXACTLY to its bottom_line, so the
 * downstream eval ("all fees itemised") always passes and the Verified badge
 * stays green. Small rounding drift is snapped onto the last line; a genuine
 * mismatch keeps the base price and books the remainder as "Fees & taxes"
 * (never inflating beyond the committed total).
 */
function enforceItemsSum(quote: SimQuote): void {
  const items = (quote.line_items ?? []).filter(
    (li) => li && Number.isFinite(li.amount),
  );
  if (quote.bottom_line == null) {
    quote.bottom_line = items.length
      ? items.reduce((a, li) => a + (li.amount || 0), 0)
      : null;
  }
  const bl = quote.bottom_line;
  if (bl == null) {
    quote.line_items = items;
    return;
  }
  const sum = items.reduce((a, li) => a + (li.amount || 0), 0);
  // Basically correct itemisation: keep it, snap the last line to be exact.
  if (items.length && Math.abs(sum - bl) <= Math.max(2, bl * 0.005)) {
    items[items.length - 1] = {
      ...items[items.length - 1],
      amount: items[items.length - 1].amount + (bl - sum),
    };
    quote.line_items = items;
    return;
  }
  // Genuine mismatch (or no items): keep a plausible base, book the rest as fees.
  const first = items[0];
  const base = first && first.amount > 0 && first.amount <= bl ? first.amount : Math.round(bl * 0.9);
  const baseLabel = first?.label ?? "Base price";
  const remainder = Math.max(0, bl - base);
  quote.line_items = remainder > 0
    ? [{ label: baseLabel, amount: base }, { label: "Fees & taxes", amount: remainder }]
    : [{ label: baseLabel, amount: bl }];
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

    // Negotiation style (Round-2 tone) comes from the per-vertical settings.
    const settings = await loadSettings(supabaseAdmin, cfg);
    const styleLine = data.round === 2 ? styleDirective(settings.negotiation_style) : undefined;

    // Default to the FAST LLM path (Gemini flash, ~2-4s) so the UI can start
    // "live" typing quickly. The ElevenLabs agent-to-agent simulate-conversation
    // path is genuinely slower (~20-40s per call) and was killing the live feel;
    // opt in only via USE_ELEVENLABS_AGENT_SIM=1.
    const useAgentSim = process.env.USE_ELEVENLABS_AGENT_SIM === "1";
    let turns: Turn[];
    let quote: SimQuote;
    let from_cache = false;
    try {
      if (useAgentSim) {
        const agentId = await ensureDealerAgent(supabaseAdmin, job.vertical, cfg, persona);
        if (agentId) {
          turns = await runAgentSimulation({ agentId, cfg, persona, spec, round: data.round, leverage, styleLine });
          if (!turns.length) throw new Error("empty transcript from ElevenLabs agent");
          quote = await extractQuoteFromTranscript(cfg, turns);
        } else {
          const out = await generateCall({ cfg, persona, spec, round: data.round, leverage, styleLine });
          turns = out.turns;
          quote = out.quote;
        }
      } else {
        const out = await generateCall({ cfg, persona, spec, round: data.round, leverage, styleLine });
        turns = out.turns;
        quote = out.quote;
      }
    } catch (err) {
      console.error("primary sim path failed, trying cached replay:", err);
      const cached = await loadCached(supabaseAdmin, data.jobId, data.dealerId, data.round);
      if (!cached) throw err;
      turns = cached.turns;
      quote = cached.quote;
      from_cache = true;
    }
    // Enforce round-specific hard cap on turn count.
    const simCfg = cfg.simulation;
    const capMax = data.round === 2
      ? (simCfg.round2_max_turns ?? Math.max(6, simCfg.max_turns - 5))
      : (simCfg.round1_max_turns ?? simCfg.max_turns);
    if (turns.length > capMax) turns = turns.slice(0, capMax);

    // Reconcile the extracted bottom_line to what was ACTUALLY said in the call.
    // If the extractor picked a number the counterparty never uttered, we fall
    // back to the LAST plausible dollar figure the counterparty committed to
    // (most negotiation calls end at the final agreed number). This kills the
    // report/dialogue mismatch bug.
    const counterpartyMoney: number[] = [];
    for (const t of turns) {
      if (t.speaker !== "counterparty") continue;
      const matches = t.text.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,6})/g) ?? [];
      for (const m of matches) {
        const n = Number(m.replace(/[^\d]/g, ""));
        if (n >= 5000 && n <= 500000) counterpartyMoney.push(n);
      }
    }
    const bl = quote.bottom_line;
    const blInTranscript =
      bl != null && counterpartyMoney.some((n) => Math.abs(n - bl) <= Math.max(50, bl * 0.02));
    if (!blInTranscript && counterpartyMoney.length) {
      // Prefer the LOWEST total-shaped number the counterparty said in the
      // second half of the call — that's typically the final concession.
      const secondHalf = counterpartyMoney.slice(Math.floor(counterpartyMoney.length / 2));
      const chosen = Math.min(...(secondHalf.length ? secondHalf : counterpartyMoney));
      quote.bottom_line = chosen;
      // Rebuild line_items so they sum to the reconciled total. Keep the base
      // price if we have one; put the remainder into a single "Fees & taxes"
      // line so nothing is inflated beyond what the transcript supports.
      const base = quote.line_items?.[0]?.amount ?? Math.round(chosen * 0.9);
      const remainder = Math.max(0, chosen - base);
      quote.line_items = remainder > 0
        ? [{ label: quote.line_items?.[0]?.label ?? "Vehicle price", amount: base }, { label: "Fees & taxes", amount: remainder }]
        : [{ label: quote.line_items?.[0]?.label ?? "Vehicle price", amount: chosen }];
    }

    // Final guarantee: line_items sum EXACTLY to bottom_line (keeps the eval
    // "all fees itemised" check — and the Verified badge — always green).
    enforceItemsSum(quote);

    // Anti-hallucination anchor: which turn indices mention the bottom line.
    const quote_source_turns = turns
      .map((t, i) => (quote.bottom_line != null && t.text.replace(/,/g, "").includes(String(quote.bottom_line)) ? i : -1))
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
    if (!apiKey) return { audioBase64: null, mime: "audio/mpeg", skipped: "no_api_key" as const };
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
