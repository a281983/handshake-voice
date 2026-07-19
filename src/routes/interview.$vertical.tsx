import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Upload, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getVertical } from "@/lib/registry";

export const Route = createFileRoute("/interview/$vertical")({
  component: InterviewPage,
});

// The interview is intentionally short (≤4 questions) to fit the ~15s demo.
// Live ElevenLabs voice wires here via the React SDK; this component also works
// as a rapid tap/type flow so the flow is never blocked by voice setup.
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
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const supportsSpeech =
    typeof window !== "undefined" &&
    (("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));

  const current = questions[step];

  const stopListening = () => {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  };

  const startListening = () => {
    setMicError(null);
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
      rec.onresult = (e: any) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        setDraft(text.trim());
      };
      rec.onerror = (e: any) => {
        setListening(false);
        const err = e?.error ?? "unknown";
        setMicError(
          err === "not-allowed" || err === "service-not-allowed"
            ? "Microphone permission was blocked. Enable it in your browser."
            : err === "no-speech"
            ? "Didn't catch that — try again."
            : `Mic error: ${err}`,
        );
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch (err: any) {
      setMicError(`Couldn't start mic: ${err?.message ?? err}`);
      setListening(false);
    }
  };

  useEffect(() => () => stopListening(), []);


  const submitSpec = async (finalAnswers: Record<string, string>) => {
    setBusy(true);
    // Start from config defaults, overlay the interview answers.
    const fields: Record<string, unknown> = {};
    for (const f of cfg.spec_schema) {
      if (f.default !== undefined) fields[f.id] = f.default;
    }
    for (const [k, v] of Object.entries(finalAnswers)) {
      const f = cfg.spec_schema.find((s) => s.id === k);
      if (!f) { fields[k] = v; continue; }
      if (f.type === "number") fields[k] = Number(v) || fields[k];
      else if (f.type === "string_list") fields[k] = v.split(",").map((s) => s.trim());
      else if (f.type === "boolean") fields[k] = /^(y|yes|true)/i.test(v);
      else fields[k] = v;
    }
    // Special-case: "make and model" answered together.
    if (fields.make && typeof fields.make === "string" && (fields.make as string).includes(" ") && !finalAnswers.model) {
      const [mk, ...rest] = (fields.make as string).split(" ");
      fields.make = mk;
      if (rest.length) fields.model = rest.join(" ");
    }

    const spec = { vertical: cfg.id, fields };
    const { data, error } = await supabase
      .from("jobs")
      .insert({ vertical: cfg.id, job_spec: spec as unknown as never, stage: "intake" })
      .select("id")
      .single();
    if (error || !data) { setBusy(false); return; }
    navigate({ to: "/confirm/$jobId", params: { jobId: data.id } });
  };

  const answerCurrent = () => {
    if (!draft.trim()) return;
    const next = { ...answers, [current.field]: draft.trim() };
    setAnswers(next);
    setDraft("");
    if (step + 1 < questions.length) setStep(step + 1);
    else void submitSpec(next);
  };

  return (
    <main className="min-h-dvh grid-bg grid place-items-center px-5">
      <div className="w-full max-w-md">
        <p className="text-[10px] uppercase tracking-widest text-primary font-mono text-center">
          Step 1 · Quick interview
        </p>

        {/* Progress */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`h-1 w-8 rounded-full ${i < step ? "bg-primary" : i === step ? "bg-primary/50" : "bg-border"}`}
            />
          ))}
        </div>

        {/* Voice orb (decorative + live-SDK mount point) */}
        <div className="mt-8 flex justify-center">
          <div className="relative h-24 w-24 rounded-full bg-primary/10 border border-primary/30 grid place-items-center glow-ring">
            <Mic className="h-8 w-8 text-primary" />
            <span className="absolute inset-0 rounded-full border border-primary/20 animate-ping" />
          </div>
        </div>

        {/* Current question */}
        <h1 className="mt-8 text-2xl font-semibold text-center leading-tight">
          {busy ? "Building your spec…" : current.ask}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground text-center">
          {busy ? "One second." : `Say it or type it — quick answers work best.`}
        </p>

        {!busy && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-primary/50">
            <input
              autoFocus
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

        {busy && (
          <div className="mt-6 flex justify-center">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
          </div>
        )}

        {/* Upload alternative */}
        {!busy && step === 0 && (
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
