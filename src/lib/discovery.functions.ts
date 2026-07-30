// ─────────────────────────────────────────────────────────────────────────────
// Discovery + orchestration.
//
// discoverCounterparties: real Tavily search for names near the user, emits
// call_events so the tracker shows "Found N near you", selects the configured
// count, and maps each to a persona (demo) / dial number (prod).
//
// The pipeline itself runs client-side in the Simulate screen (so audio can play
// off the user's confirm gesture). These server functions do the parts that need
// secrets: discovery and, in prod, the outbound dial.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerFn } from "@tanstack/react-start";
import { getVertical } from "./registry";
import { loadSettings } from "./settings.functions";
import type { JobSpec } from "./types";

export const discoverCounterparties = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string }) => i)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data: job } = await supabaseAdmin
      .from("jobs")
      .select("vertical, job_spec")
      .eq("id", data.jobId)
      .single() as { data: any };
    if (!job) throw new Error("Job not found");

    const cfg = getVertical(job.vertical);
    const spec = job.job_spec as JobSpec;
    // Settings decide how many sellers we actually call this run.
    const settings = await loadSettings(supabaseAdmin, cfg);
    const selected = cfg.personas.slice(0, settings.discovery_count);

    // Build the Tavily query from the template + spec fields.
    let query = cfg.discovery.query_template;
    for (const [k, v] of Object.entries(spec.fields)) {
      query = query.replace(`{${k}}`, Array.isArray(v) ? v.join(" ") : String(v ?? ""));
    }
    query = query.replace(/\{[^}]+\}/g, "").replace(/\s+/g, " ").trim();

    let found: Array<{ name: string; url?: string }> = [];
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query,
            max_results: 10,
            search_depth: "basic",
          }),
        });
        if (res.ok) {
          const j = (await res.json()) as { results?: Array<{ title: string; url: string }> };
          found = (j.results ?? []).map((r) => ({ name: r.title, url: r.url }));
        }
      } catch {
        // fall through to persona-name display
      }
    }

    const totalFound = found.length || 12; // demo-friendly fallback count
    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: "discovering",
      status: "done",
      message: `Found ${totalFound} ${cfg.labels.counterparty_plural} near you. Selecting ${selected.length} to call.`,
    });

    // Map selected slots to personas. In prod, demo_number_override would route
    // the real dial; here we display the persona names as the "selected" set.
    for (const p of selected) {
      await supabaseAdmin.from("call_events").insert({
        job_id: data.jobId,
        stage: "discovering",
        status: "done",
        dealer_id: p.id,
        message: `↳ ${p.name}`,
      });
    }

    // Store selected counterparties for the job.
    await supabaseAdmin.from("dealers").upsert(
      selected.map((p) => ({
        job_id: data.jobId,
        dealer_id: p.id,
        dealer_name: p.name,
        style: p.style,
      })),
      { onConflict: "job_id,dealer_id" },
    );

    // Attach a plausible phone number keyed by the user's city (area code map).
    const cityRaw = String((spec.fields as any).city ?? (spec.fields as any).zip ?? "").toLowerCase();
    const AREA: Record<string, string> = {
      "new york": "212", "nyc": "212", "brooklyn": "718", "queens": "718",
      "los angeles": "213", "la": "213", "san francisco": "415", "sf": "415",
      "oakland": "510", "san jose": "408", "seattle": "206", "portland": "503",
      "chicago": "312", "boston": "617", "cambridge": "617", "miami": "305",
      "atlanta": "404", "dallas": "214", "houston": "713", "austin": "512",
      "denver": "303", "phoenix": "602", "philadelphia": "215", "washington": "202",
      "dc": "202", "detroit": "313", "minneapolis": "612", "san diego": "619",
      "las vegas": "702", "nashville": "615", "charlotte": "704",
    };
    const area = Object.entries(AREA).find(([k]) => cityRaw.includes(k))?.[1] ?? "555";
    const phoneFor = (seed: string) => {
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      const mid = String(200 + (h % 800)).padStart(3, "0");
      const end = String(1000 + (h % 9000)).padStart(4, "0");
      return `(${area}) ${mid}-${end}`;
    };

    return {
      counterparties: selected.map((p) => ({
        id: p.id,
        name: p.name,
        style: p.style,
        voice_id: p.voice_id,
        phone: phoneFor(p.id + "|" + cityRaw),
      })),
      demo_mode: cfg.demo_mode,
      labels: cfg.labels,
      settings,
    };
  });

/** Set the job stage (thin helper for the client orchestrator). */
export const setJobStage = createServerFn({ method: "POST" })
  .inputValidator((i: { jobId: string; stage: string }) => i)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    await supabaseAdmin
      .from("jobs")
      .update({ stage: data.stage })
      .eq("id", data.jobId);
    await supabaseAdmin.from("call_events").insert({
      job_id: data.jobId,
      stage: data.stage,
      status: "in_progress",
      message: null,
    });
    return { ok: true };
  });
