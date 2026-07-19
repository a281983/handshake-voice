import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, PhoneCall, Search, Scale, ClipboardCheck, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVertical } from "@/lib/registry";
import type { Stage } from "@/lib/types";

export const Route = createFileRoute("/tracker/$jobId")({
  component: TrackerPage,
});

type Event = {
  id: string; stage: string; dealer_id: string | null;
  status: string; message: string | null; ts: string;
};

const STAGES: { key: Stage; label: string; Icon: typeof Search }[] = [
  { key: "discovering", label: "Discovering sellers", Icon: Search },
  { key: "quote_round", label: "Quote calls", Icon: PhoneCall },
  { key: "building_leverage", label: "Building leverage", Icon: Scale },
  { key: "negotiation_round", label: "Negotiation calls", Icon: PhoneCall },
  { key: "evaluating", label: "Quality check", Icon: ClipboardCheck },
  { key: "report_ready", label: "Report", Icon: FileText },
];

// A pure-Realtime view of the same job — useful as a second screen or when the
// pipeline is driven elsewhere. Subscribes to jobs.stage + call_events.
function TrackerPage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("intake");
  const [vertical, setVertical] = useState("car_buying");
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    supabase.from("jobs").select("stage, vertical").eq("id", jobId).single().then(({ data }: { data: any }) => {
      if (data) { setStage(data.stage as Stage); setVertical(data.vertical); }
    });
    supabase.from("call_events").select("*").eq("job_id", jobId).order("ts").then(({ data }: { data: any }) => {
      if (data) setEvents(data as Event[]);
    });

    const ch = supabase
      .channel(`job-${jobId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
        (payload: any) => {
          const s = (payload.new as { stage: Stage }).stage;
          setStage(s);
          if (s === "report_ready") {
            setTimeout(() => navigate({ to: "/report/$jobId", params: { jobId } }), 1200);
          }
        })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "call_events", filter: `job_id=eq.${jobId}` },
        (payload: any) => setEvents((prev) => [...prev, payload.new as Event]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [jobId, navigate]);

  const cfg = getVertical(vertical);
  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const isDone = (i: number) => stageIndex > i || stage === "report_ready";
  const isActive = (i: number) => stageIndex === i && stage !== "report_ready";

  return (
    <main className="min-h-dvh grid-bg">
      <div className="mx-auto max-w-md px-5 py-8 sm:max-w-3xl">
        <div className="flex items-center gap-2 text-xs">
          <span className="pulse-dot" />
          <span className="text-primary font-mono uppercase tracking-widest">Live · {stage.replace(/_/g, " ")}</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold">Working your deal.</h1>

        <div className="mt-8 grid sm:grid-cols-[240px_1fr] gap-6">
          {/* Stepper */}
          <ol className="space-y-1">
            {STAGES.map((s, i) => {
              const done = isDone(i);
              const active = isActive(i);
              return (
                <li key={s.key} className="relative">
                  {i < STAGES.length - 1 && (
                    <div className={`absolute left-[15px] top-8 h-full w-px ${done ? "bg-primary" : "bg-border"}`} />
                  )}
                  <div className="flex items-start gap-3 py-2">
                    <div className={`relative h-8 w-8 rounded-full border grid place-items-center flex-shrink-0 ${
                      done ? "bg-primary border-primary text-primary-foreground"
                        : active ? "border-primary text-primary bg-primary/10 glow-ring"
                        : "border-border text-muted-foreground bg-surface"}`}>
                      {done ? <CheckCircle2 className="h-4 w-4" />
                        : active ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Circle className="h-3 w-3" />}
                    </div>
                    <p className={`pt-1.5 text-sm font-medium ${active || done ? "text-foreground" : "text-muted-foreground"}`}>
                      {s.label}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Event log */}
          <div className="rounded-2xl border border-border bg-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Activity</p>
              <p className="text-xs text-muted-foreground">{events.length} events</p>
            </div>
            <ul className="max-h-[440px] overflow-y-auto divide-y divide-border">
              {events.slice().reverse().map((e) => (
                <li key={e.id} className="px-4 py-3 text-sm flex items-start gap-3">
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                    e.status === "done" ? "bg-success" : e.status === "in_progress" ? "bg-primary" : "bg-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{e.message ?? e.stage.replace(/_/g, " ")}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">
                      {e.stage} · {new Date(e.ts).toLocaleTimeString()}
                    </p>
                  </div>
                </li>
              ))}
              {events.length === 0 && (
                <li className="px-4 py-6 text-sm text-muted-foreground text-center">Waiting for first event…</li>
              )}
            </ul>
          </div>
        </div>

        <p className="mt-6 text-[11px] text-muted-foreground/60 font-mono">
          {cfg.demo_mode.enabled ? cfg.demo_mode.note : ""}
        </p>
      </div>
    </main>
  );
}
