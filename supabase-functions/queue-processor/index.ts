// supabase/functions/queue-processor/index.ts
// Pulls pending jobs from the `jobs` table and processes them in small
// parallel batches. Triggered on a schedule (pg_cron or an external cron
// hitting this URL) rather than per-upload — this is what lets the app
// absorb 1000 receipts/24h without the browser making 1000 direct calls.
//
// Deploy: supabase functions deploy queue-processor
// Schedule (Supabase SQL editor, using pg_cron + pg_net):
//   select cron.schedule('process-wisurel-queue', '*/1 * * * *', $$
//     select net.http_post(
//       url := 'https://YOUR_PROJECT.functions.supabase.co/queue-processor',
//       headers := '{"Content-Type":"application/json"}'::jsonb
//     );
//   $$);
// That runs every minute; each run claims and processes a batch, so at
// 5 files/batch/minute you comfortably clear 1000+ files across 24h with
// headroom for retries.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isDuplicateRow } from "../_shared/dedupe.ts";

const BATCH_SIZE = 5; // parallel files per run — tune to your Anthropic rate limit tier
const MODEL_API_KEY = Deno.env.get("MODEL_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // Claim a batch atomically: mark them 'running' so a second overlapping
  // cron tick doesn't grab the same rows.
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", 3)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!jobs || jobs.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { "content-type": "application/json" } });
  }

  const ids = jobs.map((j: any) => j.id);
  await supabase.from("jobs").update({ status: "running", started_at: new Date().toISOString() }).in("id", ids);

  const results = await Promise.allSettled(jobs.map((job: any) => processJob(supabase, job)));

  results.forEach((r, i) => {
    const job = jobs[i];
    if (r.status === "fulfilled") {
      supabase.from("jobs").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", job.id).then(() => {});
    } else {
      supabase
        .from("jobs")
        .update({
          status: job.attempts + 1 >= job.max_attempts ? "failed" : "pending",
          attempts: job.attempts + 1,
          error: String(r.reason).slice(0, 500),
        })
        .eq("id", job.id)
        .then(() => {});
    }
  });

  return new Response(
    JSON.stringify({ processed: jobs.length, ok: results.filter((r) => r.status === "fulfilled").length }),
    { headers: { "content-type": "application/json" } }
  );
});

async function processJob(supabase: any, job: any) {
  if (job.type === "process_file") {
    const { data: file } = await supabase.from("files").select("*").eq("id", job.file_id).single();

    // ---- Exact-duplicate check: same file content already processed? ----
    // Catches the same photo/PDF uploaded twice (from different devices, a
    // retried upload, etc.) before spending an AI call on it at all.
    if (file.content_hash) {
      const { data: sameHash } = await supabase
        .from("files")
        .select("id, original_name")
        .eq("org_id", file.org_id)
        .eq("content_hash", file.content_hash)
        .eq("status", "done")
        .neq("id", file.id)
        .limit(1)
        .maybeSingle();
      if (sameHash) {
        await supabase.from("files").update({ status: "duplicate" }).eq("id", file.id);
        return; // job still marked "done" by the caller — this is a handled outcome, not a failure
      }
    }

    await supabase.from("files").update({ status: "processing" }).eq("id", file.id);

    const { data: signed } = await supabase.storage.from("wisurel-files").createSignedUrl(file.storage_path, 60);
    const fileRes = await fetch(signed.signedUrl);
    const buf = await fileRes.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const isImage = (file.mime_type || "").startsWith("image/");

    const system = `Extract all transactions from this document as a JSON array:
[{"date":"DD/MM/YYYY","description":"","amount":0.00,"type":"debit or credit","category":"","reference":""}]
Return [] if no transactions are present.`;
    const content = [
      isImage
        ? { type: "image", source: { type: "base64", media_type: file.mime_type, data: b64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: "Extract all transactions." },
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": MODEL_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, system, messages: [{ role: "user", content }] }),
    });
    const data = await res.json();
    const text = (data.content?.map((c: any) => c.text || "").join("\n") ?? "[]").replace(/```json|```/g, "").trim();
    const rows = JSON.parse(text);

    let insertedCount = 0;
    let dupSkipped = 0;

    if (job.project_id) {
      // Use the branch this job was queued against (a specific batch, e.g.
      // "Receipts – September 2026"); fall back to the trunk branch for
      // older jobs queued before per-branch queuing existed.
      let branchId = job.branch_id;
      if (!branchId) {
        const { data: trunk } = await supabase
          .from("project_branches")
          .select("id")
          .eq("project_id", job.project_id)
          .eq("is_trunk", true)
          .single();
        branchId = trunk?.id;
      }

      if (branchId && rows.length) {
        // ---- Fuzzy duplicate check: same date+amount+similar description
        // already in this project's ledger? A different photo of the same
        // receipt, or the same transaction entered twice, gets skipped here. ----
        const { data: existingRows } = await supabase
          .from("workflow_rows")
          .select("data")
          .eq("branch_id", branchId)
          .eq("sheet_name", "Transactions");

        const pool = [...(existingRows ?? [])];
        const freshRows: any[] = [];
        for (const r of rows) {
          if (isDuplicateRow(r, pool)) {
            dupSkipped++;
          } else {
            freshRows.push(r);
            pool.push({ data: r }); // also catch duplicates within this same file's extracted rows
          }
        }

        if (freshRows.length) {
          await supabase.from("workflow_rows").insert(
            freshRows.map((r: any) => ({ branch_id: branchId, sheet_name: "Transactions", data: r, source_file_id: file.id }))
          );
          insertedCount = freshRows.length;
        }
      }
    }

    await supabase.from("files").update({ status: "done" }).eq("id", file.id);
    if (dupSkipped) {
      console.log(`File ${file.id}: inserted ${insertedCount}, skipped ${dupSkipped} duplicate row(s)`);
    }
  }
  // Extend here with more `job.type` branches as new automation types are added
  // (e.g. "process_daily_report" reuses the same claim/batch/retry machinery).
}
