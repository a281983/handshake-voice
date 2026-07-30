import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Save, Check, SlidersHorizontal } from "lucide-react";
import { listVerticals, getVertical } from "@/lib/registry";
import {
  getSettings,
  saveSettings,
  NEGOTIATION_STYLES,
  type HandshakeSettings,
} from "@/lib/settings.functions";

// Lightweight backend config surface. Everything here is stored per-vertical in
// `system_config` and read by the live pipeline on the next job — no rebuild,
// no deploy. This is the "advanced product" seam: the same engine, dialed.
export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const verticals = listVerticals();
  const [vertical, setVertical] = useState(verticals[0]?.id ?? "car_buying");
  const [settings, setSettings] = useState<HandshakeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const cfg = getVertical(vertical);
  const maxPersonas = cfg.personas.length;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSaved(false);
    getSettings({ data: { vertical } })
      .then((s) => {
        if (alive) setSettings(s);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [vertical]);

  const patch = (p: Partial<HandshakeSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s));
    setSaved(false);
  };

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const clean = await saveSettings({ data: { vertical, settings } });
      setSettings(clean);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-dvh grid-bg pb-28">
      <div className="mx-auto max-w-md px-5 pt-8">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/30 grid place-items-center">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary font-mono">Admin</p>
            <h1 className="text-lg font-semibold leading-tight">Pipeline configuration</h1>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Tune how the agent works a market — how many sellers it calls, how many it negotiates, its
          tone, and callback retries. Saved per category; the live run reads these on the next job.
        </p>

        {/* Category picker */}
        <label className="mt-6 block">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Category
          </span>
          <select
            value={vertical}
            onChange={(e) => setVertical(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary/50"
          >
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name}
                {v.demo_ready ? "" : " (soon)"}
              </option>
            ))}
          </select>
        </label>

        {loading || !settings ? (
          <div className="mt-8 grid place-items-center">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-border bg-surface divide-y divide-border overflow-hidden">
            <Field
              label="Sellers to call · Round 1"
              hint={`How many of the ${maxPersonas} available ${cfg.labels.counterparty_plural} to price. Max ${maxPersonas}.`}
            >
              <NumberInput
                value={settings.discovery_count}
                min={1}
                max={maxPersonas}
                onChange={(n) =>
                  patch({
                    discovery_count: n,
                    negotiate_top_n: Math.min(settings.negotiate_top_n, n),
                  })
                }
              />
            </Field>

            <Field
              label="Negotiate top-N cheapest"
              hint="After Round 1, call back this many of the cheapest openers to negotiate. The rest stay at their opening quote."
            >
              <NumberInput
                value={settings.negotiate_top_n}
                min={1}
                max={settings.discovery_count}
                onChange={(n) => patch({ negotiate_top_n: n })}
              />
            </Field>

            <Field
              label="Negotiation style"
              hint={
                NEGOTIATION_STYLES.find((s) => s.value === settings.negotiation_style)?.hint ?? ""
              }
            >
              <select
                value={settings.negotiation_style}
                onChange={(e) =>
                  patch({
                    negotiation_style: e.target.value as HandshakeSettings["negotiation_style"],
                  })
                }
                className="w-36 rounded-lg border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary/50"
              >
                {NEGOTIATION_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Callbacks on no-answer"
              hint="If a seller doesn't pick up, retry the call up to this many times before giving up."
            >
              <NumberInput
                value={settings.max_callbacks}
                min={0}
                max={5}
                onChange={(n) => patch({ max_callbacks: n })}
              />
            </Field>
          </div>
        )}

        <p className="mt-4 text-[11px] text-muted-foreground text-center">
          {maxPersonas} role-player {cfg.labels.counterparty_plural} configured for{" "}
          {cfg.display_name}.
        </p>
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <div className="mx-auto max-w-md">
          <button
            onClick={onSave}
            disabled={saving || loading || !settings}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : saved ? (
              <Check className="h-5 w-5" />
            ) : (
              <Save className="h-5 w-5" />
            )}
            {saving ? "Saving…" : saved ? "Saved" : "Save configuration"}
          </button>
          <a
            href="/"
            className="mt-2 block text-center text-[11px] text-muted-foreground hover:text-primary"
          >
            ← Back to Handshake
          </a>
        </div>
      </div>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label="Decrease"
        className="h-8 w-8 rounded-lg border border-border bg-background grid place-items-center text-muted-foreground hover:border-primary/50 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="w-12 text-center rounded-lg border border-border bg-background px-1 py-1.5 text-sm tabular-nums outline-none focus:border-primary/50"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label="Increase"
        className="h-8 w-8 rounded-lg border border-border bg-background grid place-items-center text-muted-foreground hover:border-primary/50 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
