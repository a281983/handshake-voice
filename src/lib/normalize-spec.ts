import { emptyJobSpec, type JobSpec } from "./negotiator-types";

/**
 * Coerce whatever the voice agent hands back (strings, CSVs, "none") into a
 * strict JobSpec so the confirm form and downstream logic see typed values.
 */
export function normalizeSpec(input: Record<string, unknown>): JobSpec {
  const base = emptyJobSpec();

  const toArr = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof v === "string")
      return v.split(/[,;/]/).map((s) => s.trim()).filter((s) => s && !/^(none|n\/a)$/i.test(s));
    return [];
  };

  const toNum = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  let year: number | null = null;
  if (input.year != null) {
    const m = String(input.year).match(/\d{4}/g);
    if (m) year = Number(m[m.length - 1]);
  }

  const cond = String(input.condition ?? "").toLowerCase();
  const condition: JobSpec["condition"] =
    cond === "new" ? "new" : cond === "used" ? "used" : base.condition;

  const pay = String(input.payment_method ?? "").toLowerCase();
  const payment_method: JobSpec["payment_method"] =
    pay === "cash" ? "cash" : pay.includes("finance") || pay.includes("lease") ? "finance" : base.payment_method;

  let trade_in = base.trade_in;
  const tin = input.trade_in;
  if (typeof tin === "string") {
    const s = tin.trim();
    if (s && !/^(no|none|n\/a|nope)$/i.test(s)) trade_in = { has_trade: true, details: s };
  } else if (tin && typeof tin === "object") {
    const obj = tin as { has_trade?: boolean; details?: string | null };
    trade_in = { has_trade: !!obj.has_trade, details: obj.details ?? null };
  }

  return {
    ...base,
    make: input.make ? String(input.make) : null,
    model: input.model ? String(input.model) : null,
    year,
    trim: input.trim ? String(input.trim) : null,
    condition,
    mileage_max: toNum(input.mileage_max),
    drivetrain: input.drivetrain ? String(input.drivetrain) : null,
    must_have_features: toArr(input.must_have_features),
    color_prefs: toArr(input.color_prefs),
    payment_method,
    trade_in,
    zip: input.zip != null && input.zip !== "" ? String(input.zip).replace(/[^\d]/g, "").slice(0, 5) : null,
    radius_miles: toNum(input.radius_miles) ?? base.radius_miles,
    timeline: input.timeline ? String(input.timeline) : null,
  };
}
