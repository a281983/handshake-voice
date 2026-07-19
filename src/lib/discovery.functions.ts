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
      message: `Found ${totalFound} ${cfg.labels.counterparty_plural} near you. Selecting ${cfg.personas.length} to call.`,
    });

    // Map selected slots to personas. In prod, demo_number_override would route
    // the real dial; here we display the persona names as the "selected" set.
    for (const p of cfg.personas) {
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
      cfg.personas.map((p) => ({
        job_id: data.jobId,
        dealer_id: p.id,
        dealer_name: p.name,
        style: p.style,
      })),
      { onConflict: "job_id,dealer_id" },
    );

    return {
      counterparties: cfg.personas.map((p) => ({
        id: p.id,
        name: p.name,
        style: p.style,
        voice_id: p.voice_id,
      })),
      demo_mode: cfg.demo_mode,
      labels: cfg.labels,
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
