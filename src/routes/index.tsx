import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { listVerticals } from "@/lib/registry";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

const ROTATE_WORDS = ["overpaying", "negotiating", "researching"];

function LandingPage() {
  const navigate = useNavigate();
  const verticals = listVerticals();

  // Type / hold / erase / next — infinite loop between the three verbs.
  const [wordIdx, setWordIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "holding" | "erasing">("typing");

  useEffect(() => {
    const word = ROTATE_WORDS[wordIdx];
    if (phase === "typing") {
      if (typed.length < word.length) {
        const t = setTimeout(() => setTyped(word.slice(0, typed.length + 1)), 75);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setPhase("holding"), 900);
      return () => clearTimeout(t);
    }
    if (phase === "holding") {
      const t = setTimeout(() => setPhase("erasing"), 600);
      return () => clearTimeout(t);
    }
    // erasing
    if (typed.length > 0) {
      const t = setTimeout(() => setTyped(typed.slice(0, -1)), 40);
      return () => clearTimeout(t);
    }
    setWordIdx((i) => (i + 1) % ROTATE_WORDS.length);
    setPhase("typing");
  }, [typed, phase, wordIdx]);

  return (
    <main className="min-h-dvh grid-bg">
      <div className="mx-auto max-w-md px-5 pt-10 pb-16 sm:max-w-3xl">
        {/* Header */}
        <header className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/30 grid place-items-center">
            <Icons.Handshake className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold tracking-tight">Handshake</span>
        </header>

        {/* Hero */}
        <section className="mt-24 sm:mt-32">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Stop{" "}
            <span className="text-primary">
              {typed}
              <span className="inline-block w-[2px] h-[0.9em] align-middle bg-primary ml-1 animate-pulse" />
            </span>
            .
            <br />
            Get the best deal.
          </h1>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="pulse-dot shrink-0" />
            <span>Voice agent that searches the market and negotiates the best deal</span>
          </div>
        </section>

        {/* Category cards */}
        <section className="mt-10">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Choose a category
          </p>
          <div className="grid grid-cols-2 gap-3">
            {verticals.map((v) => {
              const Icon = (Icons as Record<string, any>)[v.icon] ?? Icons.Circle;
              return (
                <button
                  key={v.id}
                  disabled={!v.demo_ready}
                  onClick={() =>
                    navigate({ to: "/interview/$vertical", params: { vertical: v.id } })
                  }
                  className={`group relative text-left rounded-2xl border p-4 transition ${
                    v.demo_ready
                      ? "border-border bg-surface hover:border-primary/50 hover:bg-surface-2"
                      : "border-border/60 bg-surface/50 opacity-70"
                  }`}
                >
                  <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 grid place-items-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold leading-snug">{v.display_name}</h3>
                  {!v.demo_ready && (
                    <span className="absolute top-3 right-3 text-[9px] font-mono uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      soon
                    </span>
                  )}
                  {v.demo_ready && (
                    <span className="absolute top-3 right-3 text-[9px] font-mono uppercase tracking-wide text-primary/90">
                      ready
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <footer className="mt-14 text-[11px] text-muted-foreground/60 border-t border-border pt-5">
          16,851 tiny dealers will never adopt quoting software. Every one answers the phone.
        </footer>
      </div>
    </main>
  );
}
