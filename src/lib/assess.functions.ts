// ─────────────────────────────────────────────────────────────────────────────
// Persona assessment — runs BETWEEN the quote round and the negotiation round.
//
// During quoting we deliberately do NOT label the counterparty. The label is
// EARNED: after round 1 we hand every transcript to the LLM and ask it to
// classify each dealer's negotiating persona from what they actually said, then
// state the concrete strategy we'll use against them in round 2.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { getVertical } from "./registry";

export type PersonaAssessment = {
  dealer_id: string;
  dealer_name: string;
  persona: string;
  evidence: string;
  strategy: string;
  bottom_line: number | null;
  selected: boolean;
};

function fallback(name: string): { persona: string; evidence: string; strategy: string } {
  return {
    persona: "Standard negotiator",
    evidence: `Quote captured from ${name}, no strong tell in the transcript.`,
    strategy: "Open with the best rival number and attack every named fee.",
  };
}

export const assessPersonas = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string; negotiateCount?: number }) => i)
  .handler(async ({ data }): Promise<{ assessments: PersonaAssessment[] }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs").select("vertical").eq("id", data.jobId).single() as { data: any };
    if (!job) throw new Error("Job not found");
    const cfg = getVertical(job.vertical);
    const L = cfg.labels;

    const { data: rows } = await supabaseAdmin
      .from("quotes")
      .select("dealer_id, dealer_name, bottom_line, line_items, transcript")
      .eq("job_id", data.jobId)
      .eq("round", 1) as { data: any[] };

    // De-dupe: keep the most recent row per dealer.
    const byDealer = new Map<string, any>();
    for (const r of rows ?? []) byDealer.set(r.dealer_id, r);
    const quotes = Array.from(byDealer.values());

    const negotiateCount =
      data.negotiateCount ?? cfg.simulation.negotiate_count ?? 2;

    const priced = quotes
      .filter((q) => q.bottom_line != null)
      .sort((a, b) => a.bottom_line - b.bottom_line);
    const selectedIds = new Set(priced.slice(0, negotiateCount).map((q) => q.dealer_id));

    // Ask the LLM to classify each dealer from their transcript.
    let llm: Record<string, { persona: string; evidence: string; strategy: string }> = {};
    const lovableKey = process.env.LOVABLE_API_KEY;
    if (lovableKey && quotes.length) {
      const blocks = quotes
        .map(
          (q) =>
            `DEALER ${q.dealer_id} (${q.dealer_name}) — ${L.bottom_line}: $${q.bottom_line ?? "n/a"}\n${String(q.transcript ?? "").slice(0, 2500)}`,
        )
        .join("\n\n---\n\n");
      const prompt = [
        `You are a negotiation analyst. Read each phone transcript below and classify the ${L.counterparty}'s negotiating persona from what they ACTUALLY said (e.g. stonewaller, lowball with hidden fees, hard-sell upseller, friendly anchor, volume discounter, or another label you justify).`,
        `For each dealer return: the persona label, one short sentence of evidence quoting/paraphrasing a tell from the transcript, and the concrete strategy the buyer's agent should use on the callback (which fees to attack, what rival number to cite, what tone to take).`,
        ``,
        `Return ONLY valid JSON: {"assessments":[{"dealer_id":"...","persona":"...","evidence":"...","strategy":"..."}]}`,
        ``,
        blocks,
      ].join("\n");
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": lovableKey,
            "X-Lovable-AIG-SDK": "handshake-assess",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
        });
        if (res.ok) {
          const payload = (await res.json()) as { choices: Array<{ message: { content: string } }> };
          const parsed = JSON.parse(payload.choices[0]?.message?.content ?? "{}") as {
            assessments?: Array<{ dealer_id: string; persona: string; evidence: string; strategy: string }>;
          };
          for (const a of parsed.assessments ?? []) {
            if (a?.dealer_id) {
              llm[a.dealer_id] = {
                persona: a.persona ?? "",
                evidence: a.evidence ?? "",
                strategy: a.strategy ?? "",
              };
            }
          }
        }
      } catch {
        /* fall through to deterministic fallback */
      }
    }

    const assessments: PersonaAssessment[] = quotes
      .slice()
      .sort((a, b) => (a.bottom_line ?? Infinity) - (b.bottom_line ?? Infinity))
      .map((q) => {
        const f = fallback(q.dealer_name);
        const hit = llm[q.dealer_id];
        return {
          dealer_id: q.dealer_id,
          dealer_name: q.dealer_name,
          persona: hit?.persona || f.persona,
          evidence: hit?.evidence || f.evidence,
          strategy: hit?.strategy || f.strategy,
          bottom_line: q.bottom_line ?? null,
          selected: selectedIds.has(q.dealer_id),
        };
      });

    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: "building_leverage",
      status: "done",
      message: `Profiled ${assessments.length} ${L.counterparty_plural}; shortlisted ${selectedIds.size} for negotiation.`,
    });

    return { assessments };
  });
