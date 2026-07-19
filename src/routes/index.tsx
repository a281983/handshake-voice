import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import * as Icons from "lucide-react";
import { listVerticals } from "@/lib/registry";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");
  const verticals = listVerticals();

  // Route a free-form "ask anything" request to the best-matching vertical.
  const routeAsk = () => {
    const t = ask.toLowerCase();
    const match =
      verticals.find((v) =>
        [v.id, v.display_name, v.labels.counterparty, ...v.spec_schema.map((s) => s.label)]
          .some((w) => t.includes(w.toLowerCase().split(" ")[0])),
      ) ?? verticals.find((v) => v.demo_ready)!;
    navigate({ to: "/interview/$vertical", params: { vertical: match.id } });
  };


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
            Stop overpaying.
            <br />
            <span className="text-primary">Get the best deal.</span>
          </h1>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="pulse-dot shrink-0" />
            <span>Voice agent that captures your requirements, makes the calls and finds the best deal for you</span>
          </div>
        </section>

        {/* Ask anything */}
        <section className="mt-8">
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-primary/50 transition">
            <Icons.Sparkles className="ml-2 h-4 w-4 text-primary shrink-0" />
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask.trim() && routeAsk()}
              placeholder="Ask anything"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 py-2"
            />
            <button
              onClick={() => ask.trim() && routeAsk()}
              className="rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 shrink-0"
            >
              <Icons.ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* Category cards */}
        <section className="mt-6">
          <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Or pick a category
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
