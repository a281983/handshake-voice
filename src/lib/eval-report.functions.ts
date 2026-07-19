// ─────────────────────────────────────────────────────────────────────────────
// Eval + report. Runs after round 2, independent of the calling agents.
//
// The eval agent is the anti-bluff safeguard: for each captured quote it checks
// that every number in the bottom line is (a) itemized to a named line and
// (b) actually appears in the transcript. It also runs the red-flag scan and a
// comparability check. Its verdict gates the report's "verified" badge.
//
// buildReport ranks the real round-2 quotes (no hardcoded floors) and writes the
// recommended deal with a plain-language reason — including the "hid $X in fees
// we got waived" caveat that answers "how do we know it didn't bluff?".
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { getVertical } from "./registry";
import { redFlag } from "./leverage";
import type { Quote, Report } from "./types";

function toQuote(r: any): Quote {
  return {
    dealer_id: r.dealer_id,
    dealer_name: r.dealer_name,
    round: r.round,
    line_items: r.line_items ?? [],
    add_ons_declined: r.add_ons_declined ?? [],
    bottom_line: r.bottom_line,
    outcome: r.outcome ?? "quoted",
    transcript: r.transcript ?? "",
    quote_source_turns: r.quote_source_turns ?? [],
  };
}

/** Deterministic checks — do not need an LLM and cannot themselves hallucinate. */
function deterministicChecks(cfg: ReturnType<typeof getVertical>, quotes: Quote[]) {
  const perQuote = quotes.map((q) => {
    const sum = q.line_items.reduce((a, li) => a + (li.amount || 0), 0);
    const itemised =
      q.bottom_line == null ? false : Math.abs(sum - q.bottom_line) <= Math.max(2, q.bottom_line * 0.02);
    const inTranscript =
      q.bottom_line == null
        ? false
        : q.transcript.includes(String(q.bottom_line)) ||
          q.transcript.replace(/,/g, "").includes(String(q.bottom_line));
    const rf = q.bottom_line != null ? redFlag(cfg, q.bottom_line) : { flagged: false, message: "" };
    return { dealer_id: q.dealer_id, itemised, inTranscript, red_flagged: rf.flagged, rf_message: rf.message };
  });

  return {
    all_fees_itemised: perQuote.every((p) => p.itemised),
    no_hallucinated_quotes: perQuote.every((p) => p.inTranscript),
    red_flag_scan: true, // the scan ran; individual flags are surfaced in the report
    quotes_comparable: quotes.every((q) => q.round === quotes[0]?.round),
    perQuote,
  };
}

export const runEval = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string }) => i)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs").select("vertical").eq("id", data.jobId).single() as { data: any };
    if (!job) throw new Error("Job not found");
    const cfg = getVertical(job.vertical);

    const { data: rows } = await supabaseAdmin
      .from("quotes").select("*").eq("job_id", data.jobId).eq("round", 2) as { data: any[] };
    const quotes = (rows ?? []).map(toQuote);

    const checks = deterministicChecks(cfg, quotes);
    const passed =
      checks.all_fees_itemised &&
      checks.no_hallucinated_quotes &&
      checks.quotes_comparable;

    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: "evaluating",
      status: "done",
      message: passed
        ? "Eval passed — every fee itemized, every number traced to the transcript."
        : "Eval flagged issues — see report.",
    });

    return { passed, checks };
  });

export const buildReport = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string }) => i)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin
      .from("jobs").select("vertical").eq("id", data.jobId).single() as { data: any };
    if (!job) throw new Error("Job not found");
    const cfg = getVertical(job.vertical);
    const L = cfg.labels;

    const { data: allRows } = await supabaseAdmin
      .from("quotes").select("*").eq("job_id", data.jobId) as { data: any[] };
    const all = (allRows ?? []).map(toQuote);
    const round1 = all.filter((q) => q.round === 1);
    const round2 = all.filter((q) => q.round === 2);
    const source = round2.length ? round2 : round1;

    // Rank by real captured bottom line — no hardcoded floors.
    const ranked = source
      .filter((q) => q.outcome !== "no_answer" && q.bottom_line != null)
      .slice()
      .sort((a, b) => (a.bottom_line ?? Infinity) - (b.bottom_line ?? Infinity))
      .map((q, i) => ({
        dealer_id: q.dealer_id,
        dealer_name: q.dealer_name,
        final_bottom_line: q.bottom_line ?? 0,
        rank: i + 1,
      }));

    const winner = ranked[0] ?? null;
    const highest = ranked[ranked.length - 1] ?? null;

    // Caveat: did the winner's OPENING quote hide fees we later got waived?
    let caveat = "";
    if (winner) {
      const win1 = round1.find((q) => q.dealer_id === winner.dealer_id);
      const win2 = round2.find((q) => q.dealer_id === winner.dealer_id);
      if (win1?.bottom_line && win2?.bottom_line) {
        const dropped = win1.bottom_line - win2.bottom_line;
        const waived = win2.add_ons_declined?.length
          ? win2.add_ons_declined.join(", ")
          : "add-on fees";
        if (dropped > 0) {
          caveat = ` — but its opening ${L.quote_noun} was $${win1.bottom_line.toLocaleString()}; we negotiated $${dropped.toLocaleString()} off (${waived}).`;
        }
      }
    }

    // Red flags across final quotes.
    const red_flags = source
      .filter((q) => q.bottom_line != null)
      .map((q) => ({ q, rf: redFlag(cfg, q.bottom_line!) }))
      .filter((x) => x.rf.flagged)
      .map((x) => ({
        dealer_id: x.q.dealer_id,
        flag: `${L.bottom_line} >${cfg.red_flag_rule.threshold_pct}% below market`,
        detail: `${x.q.dealer_name} at $${x.q.bottom_line!.toLocaleString()} vs benchmark $${cfg.benchmark.fair_bottom_line.toLocaleString()}. ${x.rf.message}`,
      }));

    // Re-run eval checks for the report badge.
    const checks = deterministicChecks(cfg, round2.length ? round2 : round1);
    const report: Report = {
      ranked,
      recommended: winner && {
        dealer_id: winner.dealer_id,
        dealer_name: winner.dealer_name,
        reason: `Lowest ${L.bottom_line} after negotiation${caveat}`,
        savings_vs_highest:
          highest ? highest.final_bottom_line - winner.final_bottom_line : 0,
      },
      red_flags,
      eval: {
        passed:
          checks.all_fees_itemised &&
          checks.no_hallucinated_quotes &&
          checks.quotes_comparable,
        checks: {
          all_fees_itemised: checks.all_fees_itemised,
          no_hallucinated_quotes: checks.no_hallucinated_quotes,
          red_flag_scan: checks.red_flag_scan,
          quotes_comparable: checks.quotes_comparable,
        },
      },
    };

    await supabaseAdmin
      .from("jobs")
      .update({ stage: "report_ready", report })
      .eq("id", data.jobId);
    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: "report_ready",
      status: "done",
      message: "Report ready.",
    });

    return report;
  });
