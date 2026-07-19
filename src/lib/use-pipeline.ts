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
  /** Focused call: the turn currently being spoken + typed, in sync with audio. */
  typing: { index: number; text: string } | null;
};

export function usePipeline(jobId: string) {
  const simulate = useServerFn(simulateCall);
  
  const discover = useServerFn(discoverCounterparties);
  const doEval = useServerFn(runEval);
  const doReport = useServerFn(buildReport);
  const setStage = useServerFn(setJobStage);
  const synth = useServerFn(synthesizeTurn);

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


  // Browser TTS narrator between phases — prefer a female voice for "Sarah" (the assistant).
  const pickFemaleVoice = (): SpeechSynthesisVoice | null => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices?.length) return null;
    const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    const prefer = ["Samantha", "Karen", "Victoria", "Serena", "Moira", "Tessa", "Google UK English Female", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Microsoft Zira"];
    for (const name of prefer) {
      const hit = en.find((v) => v.name.includes(name));
      if (hit) return hit;
    }
    const female = en.find((v) => /female|woman|zira|aria|jenny|samantha|karen|victoria/i.test(v.name));
    return female ?? en[0] ?? voices[0];
  };

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
        u.rate = 1.02;
        u.pitch = 1.1;
        const v = pickFemaleVoice();
        if (v) u.voice = v;
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
      const prev = v[k] ?? { turnsShown: 0, state: "pending", liveBottomLine: null, typing: null };
      return { ...v, [k]: { ...prev, ...patch } };
    });

  /**
   * Play audio for one turn AND type its text on-screen in sync with the audio.
   * The typing animation runs against the audio's actual playback duration so
   * the text lands exactly when the voice finishes.
   */
  const playAndType = (
    src: string,
    text: string,
    r: 1 | 2,
    id: string,
    index: number,
    isCaller: boolean,
  ) =>
    new Promise<void>((resolve) => {
      const a = new Audio(src);
      a.playbackRate = 1.2;
      audioRef.current = a;

      let raf = 0;
      let startedAt = 0;
      let totalMs = Math.max(600, text.length * 42);
      let didFallback = false;

      const tick = () => {
        const t = Math.min(1, (performance.now() - startedAt) / totalMs);
        const chars = Math.max(1, Math.floor(t * text.length));
        setView(r, id, { typing: { index, text: text.slice(0, chars) } });
        if (t < 1) raf = requestAnimationFrame(tick);
      };

      const finish = () => {
        cancelAnimationFrame(raf);
        setView(r, id, { turnsShown: index + 1, typing: null });
        resolve();
      };

      // If the <audio> element can't play (autoplay blocked, decode error,
      // 0-duration), fall back to browser speech so the turn is always heard.
      const fallback = () => {
        if (didFallback) return;
        didFallback = true;
        cancelAnimationFrame(raf);
        speakAndType(text, r, id, index, isCaller).then(resolve);
      };

      a.onloadedmetadata = () => {
        if (isFinite(a.duration) && a.duration > 0) {
          totalMs = (a.duration / a.playbackRate) * 1000;
        }
      };
      a.onended = finish;
      a.onerror = fallback;
      startedAt = performance.now();
      raf = requestAnimationFrame(tick);
      a.play().catch(fallback);
    });


  /** Browser-TTS fallback: still type in sync with the utterance. */
  const speakAndType = (text: string, r: 1 | 2, id: string, index: number, isCaller: boolean) =>
    new Promise<void>((resolve) => {
      let raf = 0;
      let startedAt = performance.now();
      // ~180 wpm at rate 1.35 -> ~40ms/char is a reasonable fallback.
      const totalMs = Math.max(600, text.length * 45);

      const tick = () => {
        const t = Math.min(1, (performance.now() - startedAt) / totalMs);
        const chars = Math.max(1, Math.floor(t * text.length));
        setView(r, id, { typing: { index, text: text.slice(0, chars) } });
        if (t < 1) raf = requestAnimationFrame(tick);
      };

      const finish = () => {
        cancelAnimationFrame(raf);
        setView(r, id, { turnsShown: index + 1, typing: null });
        resolve();
      };

      raf = requestAnimationFrame(tick);
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        setTimeout(finish, totalMs);
        return;
      }
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.35;
        u.pitch = isCaller ? 1.0 : 0.85;
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      } catch {
        setTimeout(finish, totalMs);
      }
    });

  /** Extract any dollar figure mentioned in a turn (for the live count-down). */
  const extractMoney = (text: string): number | null => {
    const m = text.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,6})/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ""));
    return n > 1000 ? n : null;
  };

  /** Run ONE call using an ALREADY-STARTED simulate promise, so the network
   *  round-trip happens in parallel with narration instead of after it. */
  const runOne = useCallback(
    async (id: string, r: 1 | 2, focused: boolean, simPromise: Promise<SimResult>) => {
      if (focused) setActiveId(id);
      setView(r, id, { state: "on_call", turnsShown: 0, typing: null });

      const res = await simPromise;
      setView(r, id, { result: res });

      const callerVoice = res.caller_voice_id;
      const counterVoice = res.persona.voice_id;

      for (let i = 0; i < res.turns.length; i++) {
        const turn = res.turns[i];
        const money = extractMoney(turn.text);
        if (money) setView(r, id, { liveBottomLine: money });

        if (focused) {
          setView(r, id, { typing: { index: i, text: "" } });
          try {
            const voiceId = turn.speaker === "caller" ? callerVoice : counterVoice;
            const s = await synth({ data: { text: turn.text, voiceId } });
            if (s.audioBase64) {
              await playAndType(`data:${s.mime};base64,${s.audioBase64}`, turn.text, r, id, i, turn.speaker === "caller");
            } else {
              await speakAndType(turn.text, r, id, i, turn.speaker === "caller");
            }
          } catch {
            await speakAndType(turn.text, r, id, i, turn.speaker === "caller");
          }
        } else {
          setView(r, id, { turnsShown: i + 1 });
          await new Promise((rs) => setTimeout(rs, 380));
        }
      }
      setView(r, id, {
        state: "done",
        liveBottomLine: res.quote.bottom_line ?? null,
      });
    },
    [synth],
  );


  /** Run a round: prefetch ALL calls in parallel, focus first with audio. */
  const runRound = useCallback(
    async (r: 1 | 2, list: CounterpartyMeta[]) => {
      setRound(r);
      // Kick off every simulate() immediately, in parallel. This is the
      // difference between "click → wait → see text" and "click → see text".
      const promises = list.map((c) =>
        simulate({ data: { jobId, dealerId: c.id, round: r } }) as Promise<SimResult>,
      );
      const [focus, ...rest] = list;
      const bg = rest.map((c, i) => runOne(c.id, r, false, promises[i + 1]));
      await runOne(focus.id, r, true, promises[0]);
      await Promise.all(bg);
    },
    [jobId, simulate, runOne],
  );

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      // Pull the client name off the job spec so narration is personalized.
      let clientName = "Sarah";
      try {
        const { data: jrow } = await supabase
          .from("jobs").select("job_spec").eq("id", jobId).single();
        const n = (jrow?.job_spec as any)?.fields?.customer_name;
        if (typeof n === "string" && n.trim()) clientName = n.trim().split(/\s+/)[0];
      } catch { /* fall back to Sarah */ }

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
        `Hi ${clientName}, welcome to Handshake. I found ${disc.counterparties.length} ${disc.labels.counterparty_plural} nearby. These are the ones I'm going to call for quotes.`,
      );

      // 2. Quote round — our agent calls each counterparty for a quote.
      setPhase("quoting");
      await setStage({ data: { jobId, stage: "quote_round" } });
      const firstQuoteDealer = disc.counterparties[0]?.name ?? "the first dealer";
      await narrate(`Getting quotes now, ${clientName}. I'm calling ${firstQuoteDealer} first — the others are on the line in parallel.`);
      await narrate(`Listen in — Laura, my calling agent, is on the line with ${firstQuoteDealer} right now.`);
      await runRound(1, disc.counterparties);
      setNarration(null);


      // Read back a summary of ALL three quotes and pick the negotiation target.
      const quoteSummary = disc.counterparties.map((c) => {
        const v = views[key(1, c.id)];
        const bl = v?.result?.quote?.bottom_line ?? v?.liveBottomLine ?? null;
        return { name: c.name, id: c.id, bl };
      });
      const priced = quoteSummary.filter((q) => q.bl != null) as { name: string; id: string; bl: number }[];
      priced.sort((a, b) => a.bl - b.bl);
      const cheapest = priced[0];
      if (priced.length) {
        const summaryParts = priced.map((q) => `${q.name} came in at $${q.bl.toLocaleString()}`).join("; ");
        const bridge = cheapest
          ? ` The best opener is ${cheapest.name}. I'm going to call them back and squeeze harder on the fees.`
          : "";
        await narrate(`Here's what we heard, ${clientName}: ${summaryParts}.${bridge}`);
      } else {
        await narrate(`${clientName}, the quotes are in. Starting negotiations.`);
      }

      // 3. Leverage (brief — no separate wait, this feels like one flow now)
      setPhase("leverage");
      await setStage({ data: { jobId, stage: "building_leverage" } });

      // 4. Negotiation round — ONLY with the cheapest opener, so the final
      // recommendation is the dealer we actually negotiated against. Others
      // stay at their round-1 quote and are shown for comparison.
      setPhase("negotiating");
      await setStage({ data: { jobId, stage: "negotiation_round" } });
      const negoDealer = cheapest
        ? disc.counterparties.find((c) => c.id === cheapest.id) ?? disc.counterparties[0]
        : disc.counterparties[0];
      const negoTarget = negoDealer?.name ?? "the top dealer";
      await narrate(`Calling ${negoTarget} back to negotiate for you, ${clientName}. Listen in — Laura's going to squeeze every fee she can.`);
      await runRound(2, [negoDealer]);
      await narrate(`Negotiation wrapped, ${clientName}. Locking in the numbers and putting your final recommendation together now.`);

      setNarration(null);


      // 5. Eval + report — no artificial waits.
      setPhase("finalizing");
      await setStage({ data: { jobId, stage: "evaluating" } });
      await Promise.all([
        doEval({ data: { jobId } }),
        doReport({ data: { jobId } }),
      ]);
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
      running.current = false;
    }
  }, [jobId, discover, runRound, doEval, doReport, setStage, views]);

  const stopAudio = () => {
    audioRef.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  return {
    phase, round, counterparties, activeId, views, labels, error,
    narration, awaitingContinue, continueNow,
    start, stopAudio, key,
  };
}

