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
import { simulateCall } from "@/lib/simulate-call.functions";
import { discoverCounterparties, setJobStage } from "@/lib/discovery.functions";
import { runEval, buildReport } from "@/lib/eval-report.functions";
import { provisionAgents } from "@/lib/agents.functions";

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
  
  const discover = useServerFn(discoverCounterparties);
  const doEval = useServerFn(runEval);
  const doReport = useServerFn(buildReport);
  const setStage = useServerFn(setJobStage);
  const provision = useServerFn(provisionAgents);

  const [phase, setPhase] = useState<Phase>("idle");
  const [round, setRound] = useState<1 | 2>(1);
  const [counterparties, setCounterparties] = useState<CounterpartyMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, CallView>>({});
  const [labels, setLabels] = useState<{ bottom_line: string; counterparty_plural: string } | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const continueRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLiveCall, setPendingLiveCall] = useState<{
    round: 1 | 2;
    dealerId: string;
  } | null>(null);
  const liveCallResolveRef = useRef<((result: {
    turns: Array<{ speaker: "caller" | "counterparty"; text: string }>;
    quote: SimQuote;
    persona: SimResult["persona"];
    caller_voice_id: string;
  }) => void) | null>(null);

  const finishLiveCall = useCallback(
    (result: {
      turns: Array<{ speaker: "caller" | "counterparty"; text: string }>;
      quote: SimQuote;
      persona: SimResult["persona"];
      caller_voice_id: string;
    }) => {
      liveCallResolveRef.current?.(result);
      liveCallResolveRef.current = null;
      setPendingLiveCall(null);
    },
    [],
  );

  // Browser TTS narrator between phases (uses default voice, no ElevenLabs cost).
  const narrate = (text: string): Promise<void> =>
    new Promise((resolve) => {
      setNarration(text);
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setTimeout(resolve, 1200);
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    });

  const waitForContinue = () =>
    new Promise<void>((resolve) => {
      setAwaitingContinue(true);
      continueRef.current = () => {
        setAwaitingContinue(false);
        continueRef.current = null;
        resolve();
      };
    });

  const continueNow = () => continueRef.current?.();

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
      a.playbackRate = 1.5;
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

      // LIVE PATH: focused call goes through the real ElevenLabs Convai agent.
      // Simulate page mounts a <LiveCallCard> when pendingLiveCall is set, and
      // calls finishLiveCall(...) when the negotiator+dealer conversation ends.
      if (focused) {
        setPendingLiveCall({ round: r, dealerId: id });
        const result = await new Promise<{
          turns: Array<{ speaker: "caller" | "counterparty"; text: string }>;
          quote: SimQuote;
          persona: SimResult["persona"];
          caller_voice_id: string;
        }>((resolve) => {
          liveCallResolveRef.current = resolve;
        });
        setView(r, id, {
          result: {
            persona: result.persona,
            caller_voice_id: result.caller_voice_id,
            turns: result.turns,
            quote: result.quote,
            from_cache: false,
          },
          turnsShown: result.turns.length,
          state: "done",
          liveBottomLine: result.quote.bottom_line ?? null,
        });
        return;
      }

      // BACKGROUND path (simulated).
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
        await new Promise((rs) => setTimeout(rs, 320));
      }
      setView(r, id, {
        state: "done",
        liveBottomLine: res.quote.bottom_line ?? null,
      });
    },
    [jobId, simulate],
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
      await narrate(
        `I found ${disc.counterparties.length} ${disc.labels.counterparty_plural} nearby. These are the ones I'm going to call for quotes.`,
      );

      // 2. Quote round — our agent calls each counterparty for a quote.
      setPhase("quoting");
      await setStage({ data: { jobId, stage: "quote_round" } });
      await narrate(`Getting quotes now. Our agent is calling ${disc.counterparties[0]?.name ?? "the first dealer"} first.`);
      await runRound(1, disc.counterparties);
      setNarration(null);

      // PAUSE — user reviews quotes before negotiation.
      await narrate("We've got the quotes from the market. Ready to negotiate when you are.");
      await waitForContinue();

      // 3. Leverage
      setPhase("leverage");
      await setStage({ data: { jobId, stage: "building_leverage" } });
      await narrate("Ranking the offers and arming the best competing quote as leverage.");

      // 4. Negotiation round
      setPhase("negotiating");
      await setStage({ data: { jobId, stage: "negotiation_round" } });
      await narrate(`Calling ${disc.counterparties[0]?.name ?? "the top dealer"} back to negotiate.`);
      await runRound(2, disc.counterparties);
      setNarration(null);

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

  const stopAudio = () => {
    audioRef.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  return {
    phase, round, counterparties, activeId, views, labels, error,
    narration, awaitingContinue, continueNow,
    pendingLiveCall, finishLiveCall,
    start, stopAudio, key,
  };
}
