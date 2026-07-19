// ─────────────────────────────────────────────────────────────────────────────
// Vertical registry — the "config, not code" seam.
//
// This is the ONLY file that imports config JSON. Everything else resolves the
// active vertical through getVertical(id) using the job's `vertical` field.
// Adding a vertical = drop a JSON file in /config + one line here.
// ─────────────────────────────────────────────────────────────────────────────

import type { VerticalConfig } from "./types";

import carBuying from "../../config/car_buying.json";
import homeBuying from "../../config/home_buying.json";
import medicalBills from "../../config/medical_bills.json";
import moving from "../../config/moving.json";
import lifeInsurance from "../../config/life_insurance.json";

const RAW: unknown[] = [
  carBuying,
  homeBuying,
  medicalBills,
  moving,
  lifeInsurance,
];

/** Fail loudly at module load if a config is malformed. */
function validate(c: VerticalConfig): VerticalConfig {
  const need = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[registry] ${c?.id ?? "unknown"}: ${msg}`);
  };
  need(!!c.id, "missing id");
  need(!!c.display_name, "missing display_name");
  need(!!c.labels?.bottom_line, "missing labels.bottom_line");
  need(Array.isArray(c.spec_schema) && c.spec_schema.length > 0, "empty spec_schema");
  need(Array.isArray(c.personas) && c.personas.length >= 2, "need >= 2 personas");
  need(!!c.benchmark?.fair_bottom_line, "missing benchmark.fair_bottom_line");
  for (const p of c.personas) {
    need(!!p.id && !!p.name, `persona missing id/name`);
    need(
      p.negotiation_floor <= p.opening_bottom_line,
      `persona ${p.id}: floor must be <= opening`,
    );
  }
  return c;
}

const REGISTRY: Record<string, VerticalConfig> = {};
for (const raw of RAW) {
  const cfg = validate(raw as VerticalConfig);
  REGISTRY[cfg.id] = cfg;
}

/** Resolve a vertical config by id. Throws if unknown. */
export function getVertical(id: string): VerticalConfig {
  const cfg = REGISTRY[id];
  if (!cfg) throw new Error(`[registry] unknown vertical: ${id}`);
  return cfg;
}

/** All verticals, demo-ready first, for the landing page. */
export function listVerticals(): VerticalConfig[] {
  return Object.values(REGISTRY).sort((a, b) => {
    if (a.demo_ready !== b.demo_ready) return a.demo_ready ? -1 : 1;
    return a.display_name.localeCompare(b.display_name);
  });
}

/** The default vertical for the demo rail. */
export const DEFAULT_VERTICAL = "car_buying";
