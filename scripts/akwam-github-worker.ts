// Movyz free GitHub Actions Akwam worker fleet runtime.
import { run } from "../workers/akwam-prefill/src/index.ts";

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const workerId =
  process.env.MOVYZ_WORKER_ID ||
  "gha-akwam-" + (process.env.GITHUB_RUN_ID || Date.now()) + "-" +
  (process.env.GITHUB_JOB || "worker") + "-" + crypto.randomUUID().slice(0, 8);

const workMinutes = Math.max(5, Math.min(350, Number(process.env.AKWAM_WORK_MINUTES || 340)));
const batchSize = Math.max(1, Math.min(100, Number(process.env.AKWAM_BATCH_SIZE || 100)));
const concurrency = Math.max(1, Math.min(4, Number(process.env.AKWAM_CONCURRENCY || 3)));
const stopAt = Date.now() + workMinutes * 60_000;
const stateKey = "akwam-github-" + workerId;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeState(patch: Record<string, unknown>) {
  try {
    await fetch(supabaseUrl!.replace(/\/+$/, "") + "/rest/v1/maintenance_state?on_conflict=job_key", {
      method: "POST",
      headers: {
        apikey: serviceRoleKey!,
        Authorization: "Bearer " + serviceRoleKey!,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        job_key: stateKey,
        updated_at: new Date().toISOString(),
        ...patch,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.warn("[heartbeat]", String(error).slice(0, 500));
  }
}

let totalProcessed = 0;
let totalSaved = 0;
let totalFailed = 0;
let cycles = 0;

await writeState({
  lease_until: new Date(stopAt).toISOString(),
  last_run_at: new Date().toISOString(),
  stats: {
    state: "started",
    executor: "github-actions",
    worker_id: workerId,
    run_id: process.env.GITHUB_RUN_ID || null,
    job: process.env.GITHUB_JOB || null,
    concurrency,
    batch_size: batchSize,
    work_minutes: workMinutes,
  },
});

while (Date.now() < stopAt) {
  cycles += 1;
  const cycleStarted = Date.now();

  try {
    const result = await run(
      {
        SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        AKWAM_BASE_URL: "https://akwam.ss",
        MAX_JOBS_PER_RUN: String(batchSize),
        PREFILL_CONCURRENCY: String(concurrency),
      },
      workerId + "-c" + cycles,
      batchSize,
    );

    totalProcessed += result.processed;
    totalSaved += result.saved;
    totalFailed += result.failed;

    console.log(JSON.stringify({
      cycle: cycles,
      processed: result.processed,
      saved: result.saved,
      failed: result.failed,
      totals: {
        processed: totalProcessed,
        saved: totalSaved,
        failed: totalFailed,
      },
      elapsed_ms: Date.now() - cycleStarted,
    }));

    await writeState({
      lease_until: new Date(stopAt).toISOString(),
      last_run_at: new Date().toISOString(),
      last_success_at: result.failed === 0 ? new Date().toISOString() : null,
      last_error:
        result.failed === 0
          ? null
          : "processed=" + result.processed + " saved=" + result.saved + " failed=" + result.failed,
      stats: {
        state: result.processed === 0 ? "idle" : result.failed === 0 ? "running" : "degraded",
        executor: "github-actions",
        worker_id: workerId,
        run_id: process.env.GITHUB_RUN_ID || null,
        cycle: cycles,
        cycle_processed: result.processed,
        cycle_saved: result.saved,
        cycle_failed: result.failed,
        total_processed: totalProcessed,
        total_saved: totalSaved,
        total_failed: totalFailed,
        concurrency,
        at: new Date().toISOString(),
      },
    });

    if (result.processed === 0) {
      await sleep(30_000);
    }
  } catch (error) {
    totalFailed += 1;
    console.error("[cycle-fatal]", String(error).slice(0, 1800));
    await writeState({
      lease_until: new Date(stopAt).toISOString(),
      last_run_at: new Date().toISOString(),
      last_success_at: null,
      last_error: String(error).slice(0, 1800),
      stats: {
        state: "degraded",
        executor: "github-actions",
        worker_id: workerId,
        total_processed: totalProcessed,
        total_saved: totalSaved,
        total_failed: totalFailed,
        at: new Date().toISOString(),
      },
    });
    await sleep(15_000);
  }
}

await writeState({
  lease_until: new Date(Date.now() + 15 * 60_000).toISOString(),
  last_run_at: new Date().toISOString(),
  last_success_at: new Date().toISOString(),
  last_error: null,
  stats: {
    state: "stopped",
    executor: "github-actions",
    worker_id: workerId,
    run_id: process.env.GITHUB_RUN_ID || null,
    cycles,
    total_processed: totalProcessed,
    total_saved: totalSaved,
    total_failed: totalFailed,
    at: new Date().toISOString(),
  },
});

console.log(JSON.stringify({
  workerId,
  cycles,
  processed: totalProcessed,
  saved: totalSaved,
  failed: totalFailed,
  state: "stopped_after_time_slice",
}));
