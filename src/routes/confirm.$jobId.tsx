import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVertical } from "@/lib/registry";
import type { JobSpec } from "@/lib/types";

export const Route = createFileRoute("/confirm/$jobId")({
  component: ConfirmPage,
});

function ConfirmPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const [spec, setSpec] = useState<JobSpec | null>(null);
  const [vertical, setVertical] = useState<string>("car_buying");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("jobs")
      .select("vertical, job_spec")
      .eq("id", jobId)
      .single()
      .then(({ data }: { data: any }) => {
        if (data) {
          setVertical(data.vertical);
          setSpec(data.job_spec as JobSpec);
        }
      });
  }, [jobId]);

  if (!spec) {
    return (
      <main className="min-h-dvh grid-bg grid place-items-center">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
      </main>
    );
  }

  const cfg = getVertical(vertical);
  const L = cfg.labels;

  const setField = (id: string, value: string) => {
    const f = cfg.spec_schema.find((s) => s.id === id);
    let v: unknown = value;
    if (f?.type === "number") v = Number(value) || 0;
    else if (f?.type === "string_list") v = value.split(",").map((s) => s.trim());
    else if (f?.type === "boolean") v = /^(y|yes|true)/i.test(value);
    setSpec({ ...spec, fields: { ...spec.fields, [id]: v } });
  };

  const display = (id: string): string => {
    const v = spec.fields[id];
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };

  // THE single interaction. This click:
  //  1. persists the confirmed spec + sets stage spec_confirmed
  //  2. is a genuine user gesture → unlocks mobile audio autoplay
  //  3. navigates to /simulate, where the pipeline auto-runs hands-free
  const confirmAndRun = async () => {
    setBusy(true);
    await supabase
      .from("jobs")
      .update({ job_spec: spec as unknown as never, stage: "spec_confirmed" })
      .eq("id", jobId);
    navigate({ to: "/simulate/$jobId", params: { jobId } });
  };

  // Show every field the interview asked about, in interview order.
  const askedFields = cfg.interview.questions.map((q) => q.field);
  const ordered = askedFields
    .map((id) => cfg.spec_schema.find((s) => s.id === id))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  return (
    <main className="min-h-dvh grid-bg pb-28">
      <div className="mx-auto max-w-md px-5 pt-8">
        <p className="text-[10px] uppercase tracking-widest text-primary font-mono">
          Step 2 · Confirm
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Does this look right?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap any field to fix it. This is the last thing you'll touch — then we call the {L.counterparty_plural}.
        </p>

        <div className="mt-6 rounded-2xl border border-border bg-surface divide-y divide-border overflow-hidden">
          {ordered.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-28 shrink-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</p>
              </div>
              {editing === f.id ? (
                <input
                  autoFocus
                  defaultValue={display(f.id) === "—" ? "" : display(f.id)}
                  onBlur={(e) => { setField(f.id, e.target.value); setEditing(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { setField(f.id, (e.target as HTMLInputElement).value); setEditing(null); }
                  }}
                  className="flex-1 bg-transparent text-sm outline-none border-b border-primary/50 py-0.5"
                />
              ) : (
                <button
                  onClick={() => setEditing(f.id)}
                  className="flex-1 flex items-center justify-between text-left group"
                >
                  <span className="text-sm">{display(f.id)}</span>
                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              )}
            </div>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground text-center">
          Benchmark for reference: fair {L.bottom_line} ≈ ${cfg.benchmark.fair_bottom_line.toLocaleString()}
        </p>
      </div>

      {/* Sticky confirm bar — the one tap */}
      <div className="fixed bottom-0 inset-x-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <div className="mx-auto max-w-md">
          <button
            onClick={confirmAndRun}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            {busy ? "Starting…" : "Confirm — Get me the best deal!"}
          </button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Sound on. From here it's hands-free.
          </p>
        </div>
      </div>
    </main>
  );
}
