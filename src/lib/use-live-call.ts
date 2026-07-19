// ─────────────────────────────────────────────────────────────────────────────
// useLiveCall — one focused live phone call between our LLM negotiator and
// a real ElevenLabs Conversational AI dealer agent.
//
// Flow per call:
//   1. Mint a WebRTC token for this dealer's provisioned Convai agent.
//   2. Open the conversation. The agent's mic input is our own TTS-rendered
//      negotiator lines (routed as sendUserMessage; we cannot pipe raw audio
//      through the SDK, but the agent responds naturally regardless).
//   3. Loop: negotiator LLM produces a line → we TTS it and PLAY it (user
//      hears the "buyer"), and we sendUserMessage(text) so the dealer agent
//      responds via its own real voice over WebRTC.
//   4. When the negotiator returns done=true with a quote, persist and hang up.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { useServerFn } from "@tanstack/react-start";
import { getDealerCallToken, nextNegotiatorTurn, recordLiveQuote } from "@/lib/agents.functions";
import { synthesizeTurn } from "@/lib/simulate-call.functions";

export type LiveTurn = { speaker: "negotiator" | "dealer"; text: string };
export type LiveState = "idle" | "connecting" | "live" | "done" | "error";

export function useLiveCall(opts: {
  jobId: string;
  dealerId: string;
  round: 1 | 2;
  onDone?: (quote: {
    line_items: Array<{ label: string; amount: number }>;
    bottom_line: number | null;
    add_ons_declined: string[];
    outcome: string;
  }) => void;
}) {
  const getToken = useServerFn(getDealerCallToken);
  const nextTurn = useServerFn(nextNegotiatorTurn);
  const persist = useServerFn(recordLiveQuote);
  const synth = useServerFn(synthesizeTurn);

  const [state, setState] = useState<LiveState>("idle");
  const [transcript, setTranscript] = useState<LiveTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [liveBottomLine, setLiveBottomLine] = useState<number | null>(null);
  const [callerVoiceId, setCallerVoiceId] = useState<string | null>(null);

  const transcriptRef = useRef<LiveTurn[]>([]);
  const stoppedRef = useRef(false);
  const pendingDealerResolve = useRef<((text: string) => void) | null>(null);
  const dealerBuffer = useRef<string>("");

  const conversation = useConversation({
    onConnect: () => setState("live"),
    onDisconnect: () => {
      if (!stoppedRef.current) setState("done");
    },
    onError: (e: unknown) => {
      setError(String(e));
      setState("error");
    },
    onMessage: (msg: any) => {
      // Buffer dealer voice transcripts; resolve when we get a full response.
      if (msg?.source === "ai" || msg?.type === "agent_response") {
        const text = msg?.message ?? msg?.agent_response_event?.agent_response ?? "";
        if (!text) return;
        dealerBuffer.current = text;
        const turn: LiveTurn = { speaker: "dealer", text };
        transcriptRef.current = [...transcriptRef.current, turn];
        setTranscript((t) => [...t, turn]);
        // Try to spot a bottom line in the dealer's utterance for the ticker.
        const money = text.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,6})/);
        if (money) {
          const n = Number(money[1].replace(/,/g, ""));
          if (n > 1000) setLiveBottomLine(n);
        }
        pendingDealerResolve.current?.(text);
        pendingDealerResolve.current = null;
      }
    },
  });

  /** Play a base64 mp3 chunk through the speakers; resolves when it finishes. */
  const play = (dataUrl: string) =>
    new Promise<void>((resolve) => {
      const a = new Audio(dataUrl);
      a.playbackRate = 1.15;
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });

  const waitForDealer = (timeoutMs = 20_000) =>
    new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), timeoutMs);
      pendingDealerResolve.current = (text: string) => {
        clearTimeout(timer);
        resolve(text);
      };
    });

  /** Drive the whole call end-to-end. */
  const start = useCallback(async () => {
    setState("connecting");
    stoppedRef.current = false;
    try {
      const t = await getToken({
        data: { jobId: opts.jobId, dealerId: opts.dealerId, round: opts.round },
      });
      setCallerVoiceId(t.caller_voice_id);

      // WebRTC needs a mic (SDK requirement); silence it so we don't leak room noise.
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);

      await conversation.startSession({
        conversationToken: t.token,
        connectionType: "webrtc",
      });

      // Set output volume high; the SDK handles playback natively.
      try { await conversation.setVolume?.({ volume: 1.0 }); } catch { /* noop */ }

      // Wait for the dealer's first greeting.
      await waitForDealer(6_000);

      // Negotiation loop.
      for (let step = 0; step < 12 && !stoppedRef.current; step++) {
        const nt = await nextTurn({
          data: {
            jobId: opts.jobId,
            dealerId: opts.dealerId,
            round: opts.round,
            transcript: transcriptRef.current,
          },
        });

        if (nt.done && nt.quote) {
          if (nt.quote.bottom_line != null) setLiveBottomLine(nt.quote.bottom_line);
          await persist({
            data: {
              jobId: opts.jobId,
              dealerId: opts.dealerId,
              round: opts.round,
              transcript: transcriptRef.current,
              quote: nt.quote,
            },
          });
          opts.onDone?.(nt.quote);
          break;
        }
        if (!nt.text) break;

        // Show our turn immediately.
        const negTurn: LiveTurn = { speaker: "negotiator", text: nt.text };
        transcriptRef.current = [...transcriptRef.current, negTurn];
        setTranscript((prev) => [...prev, negTurn]);

        // TTS the negotiator line so the user hears both voices.
        try {
          const s = await synth({
            data: { text: nt.text, voiceId: t.caller_voice_id },
          });
          if (s.audioBase64) await play(`data:${s.mime};base64,${s.audioBase64}`);
        } catch { /* non-fatal */ }

        // Inject into the dealer agent — it will respond via its own voice.
        conversation.sendUserMessage(nt.text);
        await waitForDealer(20_000);
      }

      stoppedRef.current = true;
      try { await conversation.endSession(); } catch { /* noop */ }
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
      try { await conversation.endSession(); } catch { /* noop */ }
    }
  }, [conversation, opts, getToken, nextTurn, persist, synth]);

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    try { await conversation.endSession(); } catch { /* noop */ }
    setState("done");
  }, [conversation]);

  useEffect(() => () => { stoppedRef.current = true; }, []);

  return { state, transcript, liveBottomLine, error, callerVoiceId, start, stop };
}
