import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Upload, ArrowRight, Loader2, Keyboard } from "lucide-react";
import { getVertical } from "@/lib/registry";
import { createJob } from "@/lib/jobs.functions";

export const Route = createFileRoute("/interview/$vertical")({
  component: InterviewPage,
});

function InterviewPage() {
  const { vertical } = Route.useParams();
  const navigate = useNavigate();
  const cfg = getVertical(vertical);
  const L = cfg.labels;

  const questions = cfg.interview.questions;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [showType, setShowType] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalRef = useRef<string>("");
  const stepRef = useRef(step);
  const answersRef = useRef(answers);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  const supportsSpeech =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));
  const supportsTTS = typeof window !== "undefined" && "speechSynthesis" in window;

  const current = questions[step];

  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  };

  const pickFemaleVoice = (): SpeechSynthesisVoice | null => {
    if (!supportsTTS) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices?.length) return null;
    const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    const prefer = ["Samantha", "Karen", "Victoria", "Serena", "Google UK English Female", "Microsoft Aria", "Microsoft Jenny", "Microsoft Zira"];
    for (const n of prefer) { const hit = en.find((v) => v.name.includes(n)); if (hit) return hit; }
    return en.find((v) => /female|zira|aria|jenny|samantha/i.test(v.name)) ?? en[0] ?? voices[0];
  };

  const speak = (text: string): Promise<void> =>
    new Promise((resolve) => {
      if (!supportsTTS) return resolve();
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.02;
        u.pitch = 1.1;
        const v = pickFemaleVoice();
        if (v) u.voice = v;
        u.onstart = () => setSpeaking(true);
        u.onend = () => { setSpeaking(false); resolve(); };
        u.onerror = () => { setSpeaking(false); resolve(); };
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    });

  const startRecognition = () => {
    if (!supportsSpeech) {
      setMicError("Voice input isn't supported in this browser — please type instead.");
      return;
    }
    try {
      const Ctor: any =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      finalRef.current = "";
      rec.onresult = (e: any) => {
        let interim = "";
        let final = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (final) finalRef.current = (finalRef.current + " " + final).trim();
        setDraft((finalRef.current + " " + interim).trim());
      };
      rec.onerror = (e: any) => {
        setListening(false);
        const err = e?.error ?? "unknown";
        if (err === "no-speech") return;
        setMicError(
          err === "not-allowed" || err === "service-not-allowed"
            ? "Microphone permission was blocked. Enable it in your browser."
            : `Mic error: ${err}`,
        );
      };
      rec.onend = () => {
        setListening(false);
        const finalText = finalRef.current.trim();
        if (voiceModeRef.current && finalText) {
          setTimeout(() => advanceWith(finalText), 100);
        }
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch (err: any) {
      setMicError(`Couldn't start mic: ${err?.message ?? err}`);
      setListening(false);
    }
  };

  const askAndListen = async (idx: number) => {
    const q = questions[idx];
    if (!q) return;
    setDraft("");
    finalRef.current = "";
    const prompt = idx === 0 ? `Hi Sarah, welcome to Handshake. ${q.ask}` : q.ask;
    await speak(prompt);
    setTimeout(() => startRecognition(), 60);
  };

  const beginVoiceInterview = async () => {
    setMicError(null);
    setVoiceMode(true);
    voiceModeRef.current = true;
    await askAndListen(stepRef.current);
  };

  const advanceWith = (text: string) => {
    const q = questions[stepRef.current];
    if (!q) return;
    const next = { ...answersRef.current, [q.field]: text };
    setAnswers(next);
    answersRef.current = next;
    setDraft("");
    finalRef.current = "";
    if (stepRef.current + 1 < questions.length) {
      const nextIdx = stepRef.current + 1;
      setStep(nextIdx);
      stepRef.current = nextIdx;
      if (voiceModeRef.current) setTimeout(() => askAndListen(nextIdx), 150);
    } else {
      void submitSpec(next);
    }
  };

  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch {}
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const submitSpec = async (finalAnswers: Record<string, string>) => {
    setBusy(true);
    const fields: Record<string, unknown> = {};
    for (const f of cfg.spec_schema) {
      if (f.default !== undefined) fields[f.id] = f.default;
    }
    for (const [k, v] of Object.entries(finalAnswers)) {
      const f = cfg.spec_schema.find((s) => s.id === k);
      if (!f) { fields[k] = v; continue; }
      if (f.type === "number") { const n = Number(String(v).replace(/[^\d.]/g, "")); fields[k] = Number.isFinite(n) && n > 0 ? n : fields[k]; }
      else if (f.type === "string_list") fields[k] = v.split(",").map((s) => s.trim());
      else if (f.type === "boolean") fields[k] = /^(y|yes|true)/i.test(v);
      else fields[k] = v;
    }
    if (fields.make && typeof fields.make === "string" && (fields.make as string).includes(" ") && !finalAnswers.model) {
      const [mk, ...rest] = (fields.make as string).split(" ");
      fields.make = mk;
      if (rest.length) fields.model = rest.join(" ");
    }

    const spec = { vertical: cfg.id, fields };
    try {
      const { id } = await createJob({ data: { vertical: cfg.id, spec } });
      navigate({ to: "/confirm/$jobId", params: { jobId: id } });
    } catch {
      setBusy(false);
    }
  };

  const answerCurrent = () => {
    if (!draft.trim()) return;
    advanceWith(draft.trim());
  };

  const onOrbClick = () => {
    if (listening) { stopListening(); return; }
    if (speaking) {
      if (typeof window !== "undefined") window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    if (!voiceMode) void beginVoiceInterview();
    else void askAndListen(stepRef.current);
  };

  return (
    <main className="min-h-dvh grid-bg grid place-items-center px-5">
      <div className="w-full max-w-md">
        <p className="text-[10px] uppercase tracking-widest text-primary font-mono text-center">
          Step 1 · Quick interview
        </p>

        <div className="mt-3 flex items-center justify-center gap-1.5">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`h-1 w-8 rounded-full ${i < step ? "bg-primary" : i === step ? "bg-primary/50" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={onOrbClick}
            aria-label={listening ? "Stop listening" : speaking ? "Stop speaking" : "Start voice interview"}
            className={`relative h-24 w-24 rounded-full grid place-items-center glow-ring transition ${
              listening || speaking
                ? "bg-primary text-primary-foreground border border-primary"
                : "bg-primary/10 border border-primary/30 hover:bg-primary/20"
            }`}
          >
            {listening ? <MicOff className="h-8 w-8" /> : <Mic className={`h-8 w-8 ${speaking || listening ? "" : "text-primary"}`} />}
            {(listening || speaking) && (
              <span className="absolute inset-0 rounded-full border border-primary/40 animate-ping" />
            )}
          </button>
        </div>
        <p className="mt-3 text-xs text-center text-muted-foreground">
          {listening ? "Listening…" : speaking ? "Speaking…" : voiceMode ? "Tap to repeat the question" : "Tap the mic to start the interview"}
        </p>
        {micError && (
          <p className="mt-2 text-xs text-destructive text-center">{micError}</p>
        )}

        <h1 className="mt-8 text-2xl font-semibold text-center leading-tight">
          {busy ? "Building your spec…" : current.ask}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground text-center">
          {busy ? "One second." : voiceMode ? "Just answer out loud." : "Say it or type it."}
        </p>

        {!busy && (showType || !voiceMode) && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-primary/50">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && answerCurrent()}
              placeholder={cfg.spec_schema.find((s) => s.id === current.field)?.placeholder ?? "Type your answer"}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 py-2 px-2"
            />
            <button
              onClick={answerCurrent}
              className="rounded-xl bg-primary px-3.5 py-2 text-primary-foreground hover:opacity-90"
            >
              {step + 1 < questions.length ? <ArrowRight className="h-4 w-4" /> : "Done"}
            </button>
          </div>
        )}

        {!busy && voiceMode && !showType && (
          <button
            onClick={() => setShowType(true)}
            className="mt-4 mx-auto flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition"
          >
            <Keyboard className="h-3.5 w-3.5" /> Prefer to type?
          </button>
        )}

        {busy && (
          <div className="mt-6 flex justify-center">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          </div>
        )}

        {!busy && step === 0 && !voiceMode && (
          <label className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface/50 p-3 text-xs text-muted-foreground hover:border-primary/40 cursor-pointer transition">
            <Upload className="h-4 w-4" />
            Or upload a listing / photo — same {L.quote_noun}
            <input type="file" accept="image/*" className="hidden" />
          </label>
        )}
      </div>
    </main>
  );
}
