// ─────────────────────────────────────────────────────────────────────────────
// usePipeline — the hands-free orchestrator.
//
// Runs on the Simulate screen, kicked off once by the confirm gesture (which also
// unlocks audio). Drives: discover → quote round (parallel, one in focus) →
// leverage → negotiation round (parallel, one in focus) → eval → report. Writes
// stages so the tracker (a separate subscriber) animates in lockstep. No taps
// after the initial gesture.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { simulateCall, synthesizeTurn } from "@/lib/simulate-call.functions";
import { discoverCounterparties, setJobStage } from "@/lib/discovery.functions";
import { runEval, buildReport } from "@/lib/eval-report.functions";

export type Turn = { speaker: "caller" | "counterparty"; text: string };
export type SimQuote = {
  line_items: Array<{ label: string; amount: number }>;
  bottom_line: number | null;
  add_ons_declined: string[];
  outcome: string;
};
export type SimResult = {
  persona: { id: string; name: string; style: string; voice_id: string };
  caller_voice_id: string;
  turns: Turn[];
  quote: SimQuote;
  from_cache: boolean;
};
export type Phase =
  | "idle" | "discovering" | "quoting" | "leverage"
  | "negotiating" | "finalizing" | "done" | "error";

export type CounterpartyMeta = { id: string; name: string; style: string; voice_id: string; phone?: string };

/** Per-call live state the UI renders. */
export type CallView = {
  turnsShown: number;
  result?: SimResult;
  state: "pending" | "on_call" | "done";
  /** Live bottom line as it changes turn-to-turn (the count-down effect). */
  liveBottomLine: number | null;
};

export function usePipeline(jobId: string) {
  const simulate = useServerFn(simulateCall);
  const synth = useServerFn(synthesizeTurn);
  const discover = useServerFn(discoverCounterparties);
  const doEval = useServerFn(runEval);
  const doReport = useServerFn(buildReport);
  const setStage = useServerFn(setJobStage);

  const [phase, setPhase] = useState<Phase>("idle");
  const [round, setRound] = useState<1 | 2>(1);
  const [counterparties, setCounterparties] = useState<CounterpartyMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, CallView>>({});
  const [labels, setLabels] = useState<{ bottom_line: string; counterparty_plural: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const running = useRef(false);

  const key = (r: 1 | 2, id: string) => `${r}:${id}`;

  const setView = (r: 1 | 2, id: string, patch: Partial<CallView>) =>
    setViews((v) => {
      const k = key(r, id);
      const prev = v[k] ?? { turnsShown: 0, state: "pending", liveBottomLine: null };
      return { ...v, [k]: { ...prev, ...patch } };
    });

  const play = (src: string) =>
    new Promise<void>((resolve) => {
      const a = new Audio(src);
      audioRef.current = a;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });

  /** Extract any dollar figure mentioned in a turn (for the live count-down). */
  const extractMoney = (text: string): number | null => {
    const m = text.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,6})/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ""));
    return n > 1000 ? n : null;
  };

  /** Run ONE call: fetch the sim, then reveal + speak each turn in sequence. */
  const runOne = useCallback(
    async (id: string, r: 1 | 2, focused: boolean) => {
      if (focused) setActiveId(id);
      setView(r, id, { state: "on_call", turnsShown: 0 });

      const res = (await simulate({
        data: { jobId, dealerId: id, round: r },
      })) as SimResult;
      setView(r, id, { result: res });

      for (let i = 0; i < res.turns.length; i++) {
        const turn = res.turns[i];
        const money = extractMoney(turn.text);
        setView(r, id, {
          turnsShown: i + 1,
          ...(money ? { liveBottomLine: money } : {}),
        });
        // Only the focused call plays audio (background calls stream silently).
        if (focused) {
          try {
            const { audioBase64, mime } = (await synth({
              data: {
                text: turn.text,
                voiceId: turn.speaker === "caller" ? res.caller_voice_id : res.persona.voice_id,
              },
            })) as { audioBase64: string | null; mime: string };
            if (audioBase64) await play(`data:${mime};base64,${audioBase64}`);
            else await new Promise((rs) => setTimeout(rs, 500));
          } catch {
            await new Promise((rs) => setTimeout(rs, 500));
          }
        } else {
          // Background pacing so cards animate without audio.
          await new Promise((rs) => setTimeout(rs, 320));
        }
      }
      setView(r, id, {
        state: "done",
        liveBottomLine: res.quote.bottom_line ?? null,
      });
    },
    [jobId, simulate, synth],
  );

  /** Run a round: focus the first counterparty (audio), others in background. */
  const runRound = useCallback(
    async (r: 1 | 2, list: CounterpartyMeta[]) => {
      setRound(r);
      // Background calls start immediately; the focused one is awaited so audio
      // plays in order. All genuinely run.
      const [focus, ...rest] = list;
      const bg = rest.map((c) => runOne(c.id, r, false));
      await runOne(focus.id, r, true);
      await Promise.all(bg);
    },
    [runOne],
  );

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      // 1. Discover
      setPhase("discovering");
      await setStage({ data: { jobId, stage: "discovering" } });
      const disc = (await discover({ data: { jobId } })) as {
        counterparties: CounterpartyMeta[];
        labels: { bottom_line: string; counterparty_plural: string };
      };
      setCounterparties(disc.counterparties);
      setLabels(disc.labels);
      await new Promise((r) => setTimeout(r, 900));

      // 2. Quote round
      setPhase("quoting");
      await setStage({ data: { jobId, stage: "quote_round" } });
      await runRound(1, disc.counterparties);

      // 3. Leverage
      setPhase("leverage");
      await setStage({ data: { jobId, stage: "building_leverage" } });
      await new Promise((r) => setTimeout(r, 1100));

      // 4. Negotiation round
      setPhase("negotiating");
      await setStage({ data: { jobId, stage: "negotiation_round" } });
      await runRound(2, disc.counterparties);

      // 5. Eval + report
      setPhase("finalizing");
      await setStage({ data: { jobId, stage: "evaluating" } });
      await doEval({ data: { jobId } });
      await doReport({ data: { jobId } });
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
      running.current = false;
    }
  }, [jobId, discover, runRound, doEval, doReport, setStage]);

  const stopAudio = () => audioRef.current?.pause();

  return {
    phase, round, counterparties, activeId, views, labels, error,
    start, stopAudio, key,
  };
}
