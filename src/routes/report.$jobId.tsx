import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Trophy, ShieldCheck, ShieldAlert, ChevronDown, Loader2, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVertical } from "@/lib/registry";
import type { Report, Quote } from "@/lib/types";

export const Route = createFileRoute("/report/$jobId")({
  component: ReportPage,
});

function ReportPage() {
  const { jobId } = Route.useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [vertical, setVertical] = useState("car_buying");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("jobs").select("vertical, report").eq("id", jobId).single().then(({ data }: { data: any }) => {
      if (data) { setVertical(data.vertical); setReport(data.report as Report); }
    });
    supabase.from("quotes").select("*").eq("job_id", jobId).then(({ data }: { data: any }) => {
      if (data) setQuotes(data as unknown as Quote[]);
    });
  }, [jobId]);

  // Narrate the final recommendation once, when data lands.
  const spokenRef = useRef(false);
  useEffect(() => {
    if (spokenRef.current || !report || !report.recommended || quotes.length === 0) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    spokenRef.current = true;
    const cfg = getVertical(vertical);
    const L = cfg.labels;
    const top = report.ranked[0];
    const winner = report.recommended.dealer_name;
    const finalPrice = top?.final_bottom_line ?? 0;
    const r1 = quotes.find((q) => q.dealer_id === report.recommended!.dealer_id && q.round === 1);
    const opening = r1?.bottom_line ?? null;
    const savedVs = report.recommended.savings_vs_highest;
    const drop = opening != null ? opening - finalPrice : 0;
    const parts: string[] = [
      `Alright Sarah, here's your final deal. The recommended ${L.counterparty} is ${winner}, at a ${L.bottom_line} of $${finalPrice.toLocaleString()}.`,
    ];
    if (drop > 0 && opening != null) {
      parts.push(`We got them from an opening quote of $${opening.toLocaleString()} down to $${finalPrice.toLocaleString()}, saving you $${drop.toLocaleString()} in the negotiation round.`);
    }
    if (savedVs > 0) {
      parts.push(`That's $${savedVs.toLocaleString()} less than the highest quote we received from the market.`);
    }
    parts.push(`Every number in the final price is itemized and traced back to the call transcript, so nothing was bluffed.`);
    const utter = new SpeechSynthesisUtterance(parts.join(" "));
    utter.rate = 1.02;
    utter.pitch = 1.1;
    try {
      const voices = window.speechSynthesis.getVoices();
      const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
      const preferred = ["Samantha", "Karen", "Victoria", "Serena", "Google UK English Female", "Microsoft Aria", "Microsoft Jenny", "Microsoft Zira"];
      const pick = preferred.map((n) => en.find((v) => v.name.includes(n))).find(Boolean)
        ?? en.find((v) => /female|zira|aria|jenny|samantha/i.test(v.name));
      if (pick) utter.voice = pick;
    } catch { /* noop */ }
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(utter); } catch { /* noop */ }
    return () => { try { window.speechSynthesis.cancel(); } catch { /* noop */ } };
  }, [report, quotes, vertical]);


  if (!report) {
    return (
      <main className="min-h-dvh grid-bg grid place-items-center">
        <div className="text-center">
          <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto" />
          <p className="mt-3 text-sm text-muted-foreground">Building your report…</p>
        </div>
      </main>
    );
  }

  const cfg = getVertical(vertical);
  const L = cfg.labels;
  const r1 = (id: string) => quotes.find((q) => q.dealer_id === id && q.round === 1);
  const r2 = (id: string) => quotes.find((q) => q.dealer_id === id && q.round === 2);

  return (
    <main className="min-h-dvh grid-bg pb-16">
      <div className="mx-auto max-w-md px-5 pt-8">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-primary font-mono">Your deal</p>
          {/* Eval badge */}
          {report.eval.passed ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-success bg-success/10 border border-success/30 px-2 py-1 rounded-full">
              <ShieldCheck className="h-3 w-3" /> Verified — no bluffed numbers
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-warning bg-warning/10 border border-warning/30 px-2 py-1 rounded-full">
              <ShieldAlert className="h-3 w-3" /> Review flagged
            </span>
          )}
        </div>

        {/* Recommended */}
        {report.recommended && (
          <div className="mt-4 rounded-2xl border border-primary/40 bg-primary/5 p-5">
            <div className="flex items-center gap-2 text-primary text-[11px] font-mono uppercase tracking-wider">
              <Trophy className="h-3.5 w-3.5" /> Recommended
            </div>
            <h1 className="mt-2 text-2xl font-semibold">{report.recommended.dealer_name}</h1>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">
                ${report.ranked[0]?.final_bottom_line.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">{L.bottom_line}</span>
            </div>
            {report.recommended.savings_vs_highest > 0 && (
              <p className="mt-2 inline-flex items-center gap-1 text-sm text-success">
                <TrendingDown className="h-4 w-4" />
                ${report.recommended.savings_vs_highest.toLocaleString()} less than the highest quote
              </p>
            )}
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              {report.recommended.reason}
            </p>
          </div>
        )}

        {/* Red flags */}
        {report.red_flags.length > 0 && (
          <div className="mt-4 space-y-2">
            {report.red_flags.map((f, i) => (
              <div key={i} className="rounded-xl border border-warning/40 bg-warning/5 p-3">
                <p className="text-[11px] font-mono uppercase tracking-wide text-warning flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" /> {f.flag}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
              </div>
            ))}
          </div>
        )}

        {/* Ranked list with before/after + itemized fees */}
        <div className="mt-6">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            All {L.counterparty_plural} · before vs after
          </p>
          <div className="space-y-3">
            {report.ranked.map((entry) => {
              const before = r1(entry.dealer_id)?.bottom_line ?? null;
              const after = entry.final_bottom_line;
              const drop = before != null ? before - after : 0;
              const q2 = r2(entry.dealer_id);
              const isOpen = open === entry.dealer_id;
              return (
                <div key={entry.dealer_id} className="rounded-2xl border border-border bg-surface overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : entry.dealer_id)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                  >
                    <div className={`h-7 w-7 rounded-full grid place-items-center text-xs font-semibold shrink-0 ${entry.rank === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      {entry.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{entry.dealer_name}</p>
                      {drop > 0 && (
                        <p className="text-[11px] text-success">
                          ${before!.toLocaleString()} → ${after.toLocaleString()} · saved ${drop.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <span className="text-base font-semibold tabular-nums shrink-0">${after.toLocaleString()}</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition ${isOpen ? "rotate-180" : ""}`} />
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                      {/* Itemized fees */}
                      {q2?.line_items && q2.line_items.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Itemized</p>
                          <div className="space-y-1">
                            {q2.line_items.map((li, i) => (
                              <div key={i} className="flex justify-between text-[13px]">
                                <span className="text-muted-foreground">{li.label}</span>
                                <span className="tabular-nums">${li.amount.toLocaleString()}</span>
                              </div>
                            ))}
                            <div className="flex justify-between text-[13px] font-semibold border-t border-border pt-1 mt-1">
                              <span>{L.bottom_line}</span>
                              <span className="tabular-nums">${after.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Transcript */}
                      {q2?.transcript && (
                        <details>
                          <summary className="text-[11px] text-primary cursor-pointer">View call transcript</summary>
                          <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto">
                            {q2.transcript}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Eval detail */}
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Independent quality check
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(report.eval.checks).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-[12px]">
                {v ? <ShieldCheck className="h-3.5 w-3.5 text-success" /> : <ShieldAlert className="h-3.5 w-3.5 text-warning" />}
                <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>

        <a
          href="/"
          className="mt-6 block text-center text-sm text-primary hover:underline"
        >
          Start another
        </a>
      </div>
    </main>
  );
}
