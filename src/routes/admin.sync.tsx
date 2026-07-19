import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { syncElevenLabsAgents } from "@/lib/agent-sync.functions";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

type SyncResult = {
  ok?: boolean;
  vertical?: string;
  agents?: unknown[];
  log?: string[];
};

export const Route = createFileRoute("/admin/sync")({
  component: SyncPage,
});

function SyncPage() {
  const sync = useServerFn(syncElevenLabsAgents);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await sync();
      setResult(r as SyncResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid-bg">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-xs uppercase tracking-widest text-primary font-mono">
          Admin · Config sync
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Push config to ElevenLabs</h1>
        <p className="mt-3 text-muted-foreground max-w-xl">
          Reads <code className="font-mono text-xs">config/car_buying.json</code>{" "}
          and PATCHes every agent's prompt, first message, voice, LLM, and client
          tools into the ElevenLabs dashboard. Nothing is configured by hand.
        </p>

        <button
          onClick={run}
          disabled={busy}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Syncing…" : "Sync agents now"}
        </button>

        {error && (
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}

        {result != null && (
          <div className="mt-6 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-primary">
              <CheckCircle2 className="h-4 w-4" />
              Sync complete
            </div>
            <pre className="mt-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
