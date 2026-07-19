// LiveCallCard — mounts the useLiveCall hook for the focused call, drives it,
// and when the negotiator finishes it hands the transcript+quote back to the
// pipeline via onFinish(...). Also renders the live transcript inline so the
// user hears + sees the real ElevenLabs Convai dealer agent talking.

import { useEffect, useRef } from "react";
import { User, Store, Volume2, Phone } from "lucide-react";
import { ConversationProvider } from "@elevenlabs/react";
import { useLiveCall } from "@/lib/use-live-call";
import type { CounterpartyMeta, SimResult, SimQuote } from "@/lib/use-pipeline";

// Rough persona placeholder used while the live call is running. We only need
// name/style/voice_id fields on the SimResult that the pipeline stores.
function personaFromMeta(c: CounterpartyMeta): SimResult["persona"] {
  return {
    id: c.id,
    name: c.name,
    style: c.style,
    voice_id: (c as unknown as { voice_id?: string }).voice_id ?? "cgSgspJ2msm6clMCkdW9",
  };
}

type LiveCallCardProps = {
  jobId: string;
  round: 1 | 2;
  counterparty: CounterpartyMeta;
  bottomLabel: string;
  onFinish: (result: {
    turns: Array<{ speaker: "caller" | "counterparty"; text: string }>;
    quote: SimQuote;
    persona: SimResult["persona"];
    caller_voice_id: string;
  }) => void;
  onFail: () => void;
};

export function LiveCallCard(props: LiveCallCardProps) {
  return (
    <ConversationProvider>
      <LiveCallCardInner {...props} />
    </ConversationProvider>
  );
}

function LiveCallCardInner(props: LiveCallCardProps) {
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const call = useLiveCall({
    jobId: props.jobId,
    dealerId: props.counterparty.id,
    round: props.round,
    onDone: (quote, liveTranscript) => {
      // Convert live transcript speakers into the pipeline's shape.
      const turns = liveTranscript.map((t) => ({
        speaker: (t.speaker === "negotiator" ? "caller" : "counterparty") as "caller" | "counterparty",
        text: t.text,
      }));
      props.onFinish({
        turns,
        quote: quote as SimQuote,
        persona: personaFromMeta(props.counterparty),
        caller_voice_id: call.callerVoiceId ?? "cgSgspJ2msm6clMCkdW9",
      });
    },
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void call.start();
    return () => { void call.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [call.transcript.length]);

  useEffect(() => {
    if (call.state === "error") props.onFail();
  }, [call.state, props]);

  return (
    <div className="rounded-2xl border border-primary/60 glow-ring p-4 bg-surface">
      <div className="flex items-center gap-3">
        <div className="shrink-0 h-10 w-10 rounded-full grid place-items-center bg-primary/20">
          <Store className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate text-sm">{props.counterparty.name}</p>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground truncate">
            <span>
              {props.round === 1 ? "Quote call" : "Negotiation"} · live · {props.counterparty.style.replace(/_/g, " ")}
            </span>
            {props.counterparty.phone && (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal text-[11px] text-foreground/70">
                <Phone className="h-3 w-3" /> {props.counterparty.phone}
              </span>
            )}
          </div>
        </div>
        {call.liveBottomLine != null ? (
          <div className="text-right shrink-0">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{props.bottomLabel}</p>
            <p className={`text-base font-semibold tabular-nums ${props.round === 2 ? "text-success" : ""}`}>
              ${call.liveBottomLine.toLocaleString()}
            </p>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-primary text-xs">
            <Volume2 className="h-3 w-3 animate-pulse" />
            {call.state === "connecting" ? "connecting" : call.state === "live" ? "live" : call.state}
          </span>
        )}
      </div>

      {call.error && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {call.error}
        </div>
      )}

      <div ref={scrollRef} className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
        {call.transcript.map((t, i) => (
          <div
            key={i}
            className={`flex gap-2 text-sm ${t.speaker === "negotiator" ? "" : "flex-row-reverse text-right"}`}
          >
            <div className={`h-6 w-6 shrink-0 rounded-full grid place-items-center ${t.speaker === "negotiator" ? "bg-primary/15 text-primary" : "bg-muted"}`}>
              {t.speaker === "negotiator" ? <User className="h-3 w-3" /> : <Store className="h-3 w-3" />}
            </div>
            <div className={`rounded-2xl px-3 py-1.5 max-w-[85%] text-[13px] leading-snug ${t.speaker === "negotiator" ? "bg-primary/10" : "bg-muted"}`}>
              {t.text}
            </div>
          </div>
        ))}
        {call.transcript.length === 0 && (
          <p className="text-[11px] text-muted-foreground">Dialing the dealer…</p>
        )}
      </div>
    </div>
  );
}
