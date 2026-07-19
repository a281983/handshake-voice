import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, User, Store, Search, Handshake, Scale, ClipboardCheck, Phone, ChevronDown, ChevronUp } from "lucide-react";
import { usePipeline, type Phase } from "@/lib/use-pipeline";

export const Route = createFileRoute("/simulate/$jobId")({
  component: SimulatePage,
});

const PHASE_META: Record<Phase, { text: string; sub: string; Icon: typeof Search }> = {
  idle:        { text: "Getting ready",        sub: "—",               Icon: Search },
  discovering: { text: "Finding sellers near you", sub: "Discovery",   Icon: Search },
  quoting:     { text: "Getting quotes",       sub: "Round 1 of 2",    Icon: Store },
  leverage:    { text: "Building leverage",    sub: "Ranking offers",  Icon: Scale },
  negotiating: { text: "Negotiating",          sub: "Round 2 of 2",    Icon: Handshake },
  finalizing:  { text: "Checking the numbers", sub: "Independent eval",Icon: ClipboardCheck },
  done:        { text: "Done",                 sub: "Complete",        Icon: ClipboardCheck },
  error:       { text: "Something went wrong", sub: "—",               Icon: Search },
};

function SimulatePage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const p = usePipeline(jobId);
  const startedRef = useRef(false);

  // Auto-run once, off the confirm gesture that brought us here (audio unlocked).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void p.start();
    return () => p.stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When finished, glide to the report.
  useEffect(() => {
    if (p.phase === "done") {
      const t = setTimeout(
        () => navigate({ to: "/report/$jobId", params: { jobId } }),
        1400,
      );
      return () => clearTimeout(t);
    }
  }, [p.phase, jobId, navigate]);

  const meta = PHASE_META[p.phase];
  const MetaIcon = meta.Icon;
  const busy = ["discovering", "quoting", "leverage", "negotiating", "finalizing"].includes(p.phase);
  const bottomLabel = p.labels?.bottom_line ?? "out-the-door price";

  return (
    <main className="min-h-dvh grid-bg pb-16">
      <div className="mx-auto max-w-md px-4 pt-6">
        {/* Sticky status header */}
        <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-background/90 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`h-9 w-9 rounded-full grid place-items-center ${p.phase === "error" ? "bg-destructive/15" : "bg-primary/15"}`}>
              {busy ? <Loader2 className="h-4 w-4 text-primary animate-spin" />
                : <MetaIcon className={`h-4 w-4 ${p.phase === "error" ? "text-destructive" : "text-primary"}`} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{meta.text}</p>
              <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">{meta.sub}</p>
            </div>
            <span className="pulse-dot" />
          </div>
          {/* Progress bar */}
          <div className="mt-2 flex items-center gap-1">
            {(["discovering", "quoting", "leverage", "negotiating", "finalizing"] as Phase[]).map((ph, i, arr) => {
              const order = arr.indexOf(p.phase);
              const done = order > i || p.phase === "done";
              const active = order === i;
              return (
                <div key={ph} className="flex-1">
                  <div className={`h-1 rounded-full transition ${done ? "bg-primary" : active ? "bg-primary/50" : "bg-border"}`} />
                </div>
              );
            })}
          </div>
        </div>

        {p.error && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {p.error}
          </div>
        )}

        {p.phase === "leverage" && (
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm text-primary/90">
            Ranking the quotes and arming the best competing offer as leverage…
          </div>
        )}

        {/* Counterparty call cards */}
        <div className="mt-5 space-y-4">
          {p.counterparties.map((c) => {
            const k = p.key(p.round, c.id);
            const view = p.views[k];
            const res = view?.result;
            const shown = view?.turnsShown ?? 0;
            const state = view?.state ?? "pending";
            const isFocus = p.activeId === c.id && (p.phase === "quoting" || p.phase === "negotiating");
            const live = view?.liveBottomLine;

            return (
              <div
                key={c.id}
                className={`rounded-2xl border bg-surface p-4 transition ${isFocus ? "border-primary/60 glow-ring" : "border-border"}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full grid place-items-center ${isFocus ? "bg-primary/20" : "bg-primary/10"}`}>
                    <Store className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">
                      {p.round === 1 ? "Quote call" : "Negotiation"} · {c.style.replace(/_/g, " ")}
                    </p>
                  </div>
                  {/* Live bottom line (counts as concessions land) */}
                  {live != null && (
                    <div className="text-right shrink-0">
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{bottomLabel}</p>
                      <p className={`text-base font-semibold tabular-nums ${p.round === 2 ? "text-success" : ""}`}>
                        ${live.toLocaleString()}
                      </p>
                    </div>
                  )}
                  {live == null && (
                    <div className="text-xs shrink-0">
                      {state === "on_call" ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Volume2 className="h-3 w-3 animate-pulse" /> live
                        </span>
                      ) : state === "done" ? <span className="text-success">✓</span>
                        : <span className="text-muted-foreground">waiting</span>}
                    </div>
                  )}
                </div>

                {/* Transcript, revealed turn by turn */}
                {res && shown > 0 && (
                  <div className="mt-3 space-y-2">
                    {res.turns.slice(0, shown).map((t, i) => (
                      <div
                        key={i}
                        className={`flex gap-2 text-sm ${t.speaker === "caller" ? "" : "flex-row-reverse text-right"}`}
                      >
                        <div className={`h-6 w-6 shrink-0 rounded-full grid place-items-center ${t.speaker === "caller" ? "bg-primary/15 text-primary" : "bg-muted"}`}>
                          {t.speaker === "caller" ? <User className="h-3 w-3" /> : <Store className="h-3 w-3" />}
                        </div>
                        <div className={`rounded-2xl px-3 py-1.5 max-w-[85%] text-[13px] leading-snug ${t.speaker === "caller" ? "bg-primary/10" : "bg-muted"}`}>
                          {t.text}
                        </div>
                      </div>
                    ))}
                    {res.from_cache && (
                      <p className="text-[10px] text-muted-foreground/70 font-mono text-center pt-1">replayed from cache</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {p.counterparties.length === 0 && (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <Loader2 className="h-5 w-5 text-primary animate-spin mx-auto" />
              <p className="mt-3 text-sm text-muted-foreground">Finding sellers near you…</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
