import { run } from "../workers/akwam-prefill/src/index.ts";

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  AKWAM_BASE_URL: "https://akwam.ss",
  MAX_JOBS_PER_RUN: process.env.MAX_JOBS_PER_RUN || "50",
  PREFILL_CONCURRENCY: process.env.PREFILL_CONCURRENCY || "8",
};

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase runner secrets");
}

// GitHub Actions is the trusted Akwam fetch environment; keep playback DB-only.
// Smoke priority is controlled in Supabase, not in the runner.
const workerId = `gha-prefill-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`;
const result = await run(env, workerId);
console.log(JSON.stringify(result));
