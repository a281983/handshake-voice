// ─────────────────────────────────────────────────────────────────────────────
// Leverage engine — the core of the negotiation.
//
// THE OLD BUG: round 2 passed a single number ("you have $29,200 in writing").
// The dealer had nothing specific to react to, so the model wandered and the
// price barely moved — or moved only because a floor was pre-written.
//
// THE FIX: for each dealer we build a LeveragePacket that is specific and
// adversarial: the best rival's bottom line, WHICH fees rivals waived, WHICH of
// THIS dealer's fees to attack by name, and a concrete target to push toward.
// The caller can now say "ValueMax is $29,200 and waived paint protection and
// nitrogen — your market adjustment and dealer prep have to go." That specificity
// is why the counterparty concedes.
//
// This module is pure and deterministic. It does NOT read persona floors — the
// floor is a private guardrail inside each dealer's prompt. Leverage is computed
// only from real captured round-1 quotes.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeveragePacket, LineItem, Quote, VerticalConfig } from "./types";

/** Fee-ish line items = everything that isn't the core price/vehicle line. */
function feeItems(items: LineItem[]): LineItem[] {
  return items.filter((li) => !/vehicle price|base price|loan|premium base|core/i.test(li.label));
}

/** Normalize a fee label for comparison across dealers. */
function feeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

/**
 * Given all round-1 quotes, compute a LeveragePacket for `targetDealerId`.
 *
 * Strategy:
 *  - best_rival        = the lowest bottom_line among OTHER dealers
 *  - rival_fee_intel   = what each rival is/ isn't charging (so the caller can
 *                        cite "your competitor doesn't charge X")
 *  - attack_fees       = THIS dealer's fees that a rival either doesn't charge or
 *                        that exceed the benchmark's implied norm — the named
 *                        targets for the callback
 *  - target_bottom_line= a concrete goal: undercut the best rival slightly, but
 *                        never propose something below the fair-market benchmark
 *                        (that would be an unrealistic ask and trips the red flag)
 */
export function buildLeveragePacket(
  cfg: VerticalConfig,
  round1: Quote[],
  targetDealerId: string,
): LeveragePacket {
  const benchmark = cfg.benchmark.fair_bottom_line;
  const others = round1.filter(
    (q) => q.dealer_id !== targetDealerId && (q.bottom_line ?? 0) > 0,
  );
  const target = round1.find((q) => q.dealer_id === targetDealerId);

  // Best rival by lowest bottom line.
  let best_rival: LeveragePacket["best_rival"] = null;
  if (others.length) {
    const b = others.reduce((a, c) =>
      (c.bottom_line ?? Infinity) < (a.bottom_line ?? Infinity) ? c : a,
    );
    best_rival = {
      dealer_id: b.dealer_id,
      dealer_name: b.dealer_name,
      bottom_line: b.bottom_line!,
    };
  }

  // What is each rival charging? (labels only — used to shame this dealer's fees)
  const rival_fee_intel = others.map((q) => {
    const charging = feeItems(q.line_items).map((li) => `${li.label} ${li.amount}`);
    const waived = q.add_ons_declined ?? [];
    return {
      dealer_id: q.dealer_id,
      dealer_name: q.dealer_name,
      waived,
      still_charging: charging,
    };
  });

  // Which of THIS dealer's fees to attack: any fee a rival doesn't also charge.
  const rivalFeeKeys = new Set<string>();
  for (const q of others) {
    for (const li of feeItems(q.line_items)) rivalFeeKeys.add(feeKey(li.label));
  }
  const attack_fees: string[] = [];
  if (target) {
    for (const li of feeItems(target.line_items)) {
      // Attack junk-sounding fees and anything a cheaper rival doesn't charge.
      const junky = /market adjustment|paint|nitrogen|etching|prep|processing|surcharge|points/i.test(li.label);
      const unmatched = !rivalFeeKeys.has(feeKey(li.label));
      if (junky || unmatched) attack_fees.push(li.label);
    }
  }

  // Target: push this dealer below the CHEAPER of (best rival, its own opening),
  // floored at the benchmark — never ask below fair market, that's an unrealistic
  // ask and trips the red flag. This handles the already-cheapest dealer: its
  // rival is pricier, so we push it down from its own opening, not up toward the
  // rival.
  const targetOpening = target?.bottom_line ?? Infinity;
  const rivalAnchor = best_rival?.bottom_line ?? Infinity;
  const anchor = Math.min(targetOpening, rivalAnchor);
  const target_bottom_line = Number.isFinite(anchor)
    ? Math.max(benchmark, Math.round(anchor * 0.97))
    : benchmark;

  return {
    best_rival,
    rival_fee_intel,
    attack_fees: [...new Set(attack_fees)],
    target_bottom_line,
    benchmark,
  };
}

/**
 * Render a LeveragePacket into a plain-English brief the caller agent uses in
 * its round-2 system prompt. This is what turns structured leverage into an
 * actual negotiating script.
 */
export function leverageBrief(cfg: VerticalConfig, packet: LeveragePacket): string {
  const L = cfg.labels;
  const lines: string[] = [];

  if (packet.best_rival) {
    lines.push(
      `You have a REAL competing ${L.quote_noun} from ${packet.best_rival.dealer_name}: ` +
        `$${packet.best_rival.bottom_line.toLocaleString()} ${L.bottom_line}. ` +
        `Cite it by name and dollar amount. It is genuine — do not exaggerate it.`,
    );
  } else {
    lines.push(
      `You do not yet have a competing ${L.quote_noun}. Push on fees and the market benchmark instead.`,
    );
  }

  const intelWithWaivers = packet.rival_fee_intel.filter((r) => r.waived.length);
  if (intelWithWaivers.length) {
    const parts = intelWithWaivers.map(
      (r) => `${r.dealer_name} waived ${r.waived.join(", ")}`,
    );
    lines.push(`Rivals already dropped fees: ${parts.join("; ")}. Use this to demand parity.`);
  }

  if (packet.attack_fees.length) {
    lines.push(
      `Attack these specific fees by name and ask for each to be waived: ` +
        `${packet.attack_fees.join(", ")}.`,
    );
  }

  lines.push(
    `Your target is $${packet.target_bottom_line.toLocaleString()} ${L.bottom_line} or better. ` +
      `Fair-market benchmark is $${packet.benchmark.toLocaleString()} — anything far below that is suspicious, ` +
      `so don't chase an unrealistic number, but do not settle above your target without a real reason.`,
  );

  lines.push(
    `Stay anchored on the total ${L.bottom_line}. Refuse attempts to reframe as a monthly payment or to re-add upsells.`,
  );

  return lines.join("\n");
}

/** Apply the config's red-flag rule to a bottom line. */
export function redFlag(
  cfg: VerticalConfig,
  bottomLine: number,
): { flagged: boolean; message: string } {
  const { threshold_pct, message } = cfg.red_flag_rule;
  const floor = cfg.benchmark.fair_bottom_line * (1 - threshold_pct / 100);
  return { flagged: bottomLine > 0 && bottomLine < floor, message };
}
