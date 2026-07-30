// ─────────────────────────────────────────────────────────────────────────────
// Handshake settings — the lightweight config layer.
//
// A per-vertical settings object stored in the existing `system_config` table
// (key = "settings"). This is what the /admin page edits and what the pipeline
// honors: how many sellers to call, how many of the cheapest to negotiate, the
// negotiation style, and how many times to call back on no-answer.
//
// Design notes:
//  - Pure helpers (defaults, sanitize, style directive, loadSettings) take the
//    supabase client as an ARGUMENT so this file never imports client.server at
//    the top level (it ships to the client bundle). The two server functions
//    dynamic-import supabaseAdmin inside their handlers, like every other fn.
//  - getSettings always returns a fully-populated, sanitized object — there is
//    never a "no row" failure mode, so the demo works with zero setup.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVertical } from "./registry";
import type { Database } from "@/integrations/supabase/types";
import type { VerticalConfig } from "./types";

export type NegotiationStyle = "friendly_closer" | "aggressive" | "diplomatic";

export type HandshakeSettings = {
  /** How many of the cheapest Round-1 openers to call back and negotiate. */
  negotiate_top_n: number;
  /** The caller's Round-2 persona/tone. */
  negotiation_style: NegotiationStyle;
  /** How many sellers to find and call for quotes in Round 1. */
  discovery_count: number;
  /** Retry a call up to this many times when a seller doesn't pick up. */
  max_callbacks: number;
};

/** Style options for the admin form + the prompt directive each one injects. */
export const NEGOTIATION_STYLES: Array<{
  value: NegotiationStyle;
  label: string;
  hint: string;
}> = [
  {
    value: "friendly_closer",
    label: "Friendly closer",
    hint: "Warm, witty, firm — the nicest hard-baller they'll talk to.",
  },
  {
    value: "aggressive",
    label: "Aggressive",
    hint: "Blunt and relentless — leads with the rival number, hammers the junk fees.",
  },
  {
    value: "diplomatic",
    label: "Diplomatic",
    hint: "Calm and collaborative — patient, asks for specific waivers.",
  },
];

const STYLE_VALUES = new Set<NegotiationStyle>(NEGOTIATION_STYLES.map((s) => s.value));

/** Baseline settings derived from the vertical config — used when no row exists. */
export function defaultSettings(cfg: VerticalConfig): HandshakeSettings {
  const nPersonas = cfg.personas.length;
  return {
    negotiate_top_n: Math.min(2, nPersonas),
    negotiation_style: "friendly_closer",
    discovery_count: Math.min(cfg.discovery?.select_count ?? nPersonas, nPersonas),
    max_callbacks: 1,
  };
}

const clampInt = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
};

/**
 * Coerce/clamp an arbitrary object (DB row or form input) into safe settings.
 * We can only ever call/negotiate the personas we actually have, so all counts
 * are clamped to the persona set — a bad value can never break the pipeline.
 */
export function sanitizeSettings(raw: unknown, cfg: VerticalConfig): HandshakeSettings {
  const d = defaultSettings(cfg);
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<HandshakeSettings>;
  const nPersonas = cfg.personas.length;
  const discovery_count = clampInt(r.discovery_count, 1, nPersonas, d.discovery_count);
  return {
    discovery_count,
    // Never negotiate more sellers than we called.
    negotiate_top_n: clampInt(
      r.negotiate_top_n,
      1,
      discovery_count,
      Math.min(d.negotiate_top_n, discovery_count),
    ),
    negotiation_style: STYLE_VALUES.has(r.negotiation_style as NegotiationStyle)
      ? (r.negotiation_style as NegotiationStyle)
      : d.negotiation_style,
    max_callbacks: clampInt(r.max_callbacks, 0, 5, d.max_callbacks),
  };
}

/** The one-line Round-2 tone directive injected into the caller's system prompt. */
export function styleDirective(style: NegotiationStyle): string {
  switch (style) {
    case "aggressive":
      return "TONE: blunt and relentless. Open by naming the rival's number, call out each junk fee by name immediately, and keep the pressure on until they move. Stay professional — never insult, but never soften the ask.";
    case "diplomatic":
      return "TONE: calm and collaborative. Acknowledge their position, frame this as finding a deal that works for both sides, then ask for specific fee waivers one at a time. Patient and warm, never pushy.";
    case "friendly_closer":
    default:
      return "TONE: warm, quick-witted, and firm — the nicest hard-baller they'll talk to today. Use the rival offer like a crowbar, land at most one dry quip at the situation's expense, never the counterparty's.";
  }
}

/**
 * Server-side read that any handler can reuse (pass an already-loaded admin
 * client). Merges the stored row over the config defaults and sanitizes.
 */
export async function loadSettings(
  supabaseAdmin: SupabaseClient<Database>,
  cfg: VerticalConfig,
): Promise<HandshakeSettings> {
  try {
    const { data } = await supabaseAdmin
      .from("system_config")
      .select("value")
      .eq("vertical", cfg.id)
      .eq("key", "settings")
      .maybeSingle();
    return sanitizeSettings(data?.value ?? {}, cfg);
  } catch {
    return defaultSettings(cfg);
  }
}

/** Read the sanitized settings for a vertical (falls back to config defaults). */
export const getSettings = createServerFn({ method: "GET" })
  .inputValidator((i: { vertical: string }) => i)
  .handler(async ({ data }): Promise<HandshakeSettings> => {
    const cfg = getVertical(data.vertical);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadSettings(supabaseAdmin, cfg);
  });

/** Persist settings for a vertical. Sanitizes before storing. */
export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((i: { vertical: string; settings: Partial<HandshakeSettings> }) => i)
  .handler(async ({ data }): Promise<HandshakeSettings> => {
    const cfg = getVertical(data.vertical);
    const clean = sanitizeSettings(data.settings, cfg);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("system_config")
      .upsert({ vertical: cfg.id, key: "settings", value: clean as never });
    return clean;
  });
