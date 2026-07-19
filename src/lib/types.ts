// ─────────────────────────────────────────────────────────────────────────────
// Handshake — core types.
//
// The whole product is one engine (discover → quote → leverage → negotiate →
// eval → report) driven by a VerticalConfig. Nothing below is car-specific.
// Swap the config, get a different vertical. See registry.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** A field in a vertical's intake schema. */
export type SpecField = {
  id: string;
  label: string;
  /** Storage/parse type. `string_list` accepts comma-separated input. */
  type: "string" | "number" | "string_list" | "boolean";
  /** Asked in the timed demo interview? Non-critical fields are defaulted. */
  demo_critical: boolean;
  /** Optional default applied when the interview skips this field. */
  default?: unknown;
  /** Optional hint shown on the confirm card. */
  placeholder?: string;
};

/** One rapid interview question. Keep prompts <10 words for the timed demo. */
export type InterviewQuestion = {
  field: string;
  ask: string;
};

/** The vocabulary that makes the UI read naturally per vertical. */
export type Labels = {
  /** The other side: "dealer", "hospital billing office", "moving company". */
  counterparty: string;
  /** Plural form for lists/headers. */
  counterparty_plural: string;
  /** The one comparable number: "out-the-door", "total bill", "annual premium". */
  bottom_line: string;
  /** Short verb for CTAs: "buy", "negotiate", "insure". */
  verb: string;
  /** What a single quote is called: "quote", "estimate", "bill". */
  quote_noun: string;
};

/** A simulated counterparty. The floor is a PRIVATE guardrail (see prompt only). */
export type Persona = {
  id: string;
  name: string;
  /** Freeform style tag, shown in UI ("stonewaller", "lowball_hidden_fees"). */
  style: string;
  /** ElevenLabs voice id for this counterparty. */
  voice_id: string;
  /** Opening bottom-line anchor for round 1. */
  opening_bottom_line: number;
  /**
   * Negotiation floor — the LOWEST this persona will go under pressure.
   * GUARDRAIL ONLY: injected into the dealer prompt so concessions stay
   * realistic. NEVER read by the report, tracker, or leverage engine.
   */
  negotiation_floor: number;
  /** System prompt describing this counterparty's negotiating behavior. */
  prompt: string;
};

export type VerticalConfig = {
  id: string;
  display_name: string;
  /** One-line pitch for the landing card. */
  tagline: string;
  /** lucide-react icon name for the landing card. */
  icon: string;
  /** Whether this vertical is fully wired for the live demo. */
  demo_ready: boolean;

  labels: Labels;

  spec_schema: SpecField[];

  interview: {
    first_message: string;
    questions: InterviewQuestion[];
    /** A pre-filled spec used by the "Run demo" fast path. */
    demo_spec: Record<string, unknown>;
  };

  benchmark: {
    description: string;
    /** Fair-market value of the comparable bottom line. */
    fair_bottom_line: number;
    source: string;
  };

  red_flag_rule: {
    type: "below_market_pct";
    threshold_pct: number;
    message: string;
  };

  discovery: {
    provider: "tavily";
    query_template: string;
    select_count: number;
  };

  /** Demo routing: production dials scraped numbers; demo hits role-players. */
  demo_mode: {
    enabled: boolean;
    note: string;
  };

  personas: Persona[];

  caller_voice_id: string;

  simulation: {
    min_turns: number;
    max_turns: number;
    model: string;
  };
};

// ── Runtime data shapes ──────────────────────────────────────────────────────

export type JobSpec = {
  vertical: string;
  fields: Record<string, unknown>;
};

export type LineItem = { label: string; amount: number };

export type Quote = {
  dealer_id: string;
  dealer_name: string;
  round: 1 | 2;
  line_items: LineItem[];
  add_ons_declined: string[];
  bottom_line: number | null;
  outcome: "quoted" | "callback" | "declined" | "no_answer";
  transcript: string;
  quote_source_turns: number[];
};

export type Turn = { speaker: "caller" | "counterparty"; text: string };

/** Rich leverage passed into round 2 — the fix for "weak leverage". */
export type LeveragePacket = {
  best_rival: { dealer_id: string; dealer_name: string; bottom_line: number } | null;
  rival_fee_intel: Array<{
    dealer_id: string;
    dealer_name: string;
    waived: string[];
    still_charging: string[];
  }>;
  /** Specific fee labels to attack by name on THIS dealer's callback. */
  attack_fees: string[];
  /** The bottom line we're pushing this specific dealer toward. */
  target_bottom_line: number;
  benchmark: number;
};

export type Stage =
  | "intake"
  | "spec_confirmed"
  | "discovering"
  | "quote_round"
  | "building_leverage"
  | "negotiation_round"
  | "evaluating"
  | "report_ready";

export type CallStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "no_answer"
  | "failed";

export type RankedEntry = {
  dealer_id: string;
  dealer_name: string;
  final_bottom_line: number;
  rank: number;
};

export type Report = {
  ranked: RankedEntry[];
  recommended: {
    dealer_id: string;
    dealer_name: string;
    reason: string;
    savings_vs_highest: number;
  } | null;
  red_flags: Array<{ dealer_id: string; flag: string; detail: string }>;
  eval: {
    passed: boolean;
    checks: {
      all_fees_itemised?: boolean;
      no_hallucinated_quotes?: boolean;
      red_flag_scan?: boolean;
      quotes_comparable?: boolean;
    };
  };
};
