import { createServerFn } from "@tanstack/react-start";

export const createJob = createServerFn({ method: "POST" })
  .inputValidator((data: { vertical: string; spec: unknown }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("jobs")
      .insert({ vertical: data.vertical, job_spec: data.spec as never, stage: "intake" })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "insert failed");
    return { id: row.id as string };
  });

export const confirmJobSpec = createServerFn({ method: "POST" })
  .inputValidator((data: { jobId: string; spec: unknown }) => data)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("jobs")
      .update({ job_spec: data.spec as never, stage: "spec_confirmed" })
      .eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
