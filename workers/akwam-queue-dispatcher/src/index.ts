type QueueBinding = {
  send(message: unknown): Promise<void>;
  sendBatch(messages: Array<{ body: unknown }>): Promise<void>;
};

type Env = {
  FILL_QUEUE: QueueBinding;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

async function hasReadyJob(env: Env, contentType: "movie" | "episode") {
  const now = new Date().toISOString();
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const params = new URLSearchParams({
    select: "id",
    status: "eq.pending",
    content_type: `eq.${contentType}`,
    available_at: `lte.${now}`,
    order: "priority.desc,available_at.asc,created_at.asc",
    limit: "1",
  });

  const response = await fetch(
    `${base}/rest/v1/playback_source_jobs?${params.toString()}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0;
}



async function writeState(env: Env, patch: Record<string, unknown>) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  try {
    await fetch(`${base}/rest/v1/maintenance_state?on_conflict=job_key`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        job_key: "akwam-queue-dispatcher",
        updated_at: new Date().toISOString(),
        ...patch,
      }),
    });
  } catch (error) {
    console.error("[akwam-queue-dispatcher-state]", String(error));
  }
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({
      ok: true,
      service: "movyz-akwam-queue-dispatcher",
      mode: "queue-producer",
      strategy: "movies-first",
    });
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      const movieReady = await hasReadyJob(env, "movie");
      const contentType = movieReady ? "movie" : (await hasReadyJob(env, "episode") ? "episode" : null);

      if (!contentType) {
        await writeState(env, {
          last_run_at: new Date().toISOString(),
          stats: { state: "idle", executor: "cloudflare-queue-dispatcher" },
        });
        console.log("[akwam-queue-dispatcher] no ready jobs");
        return;
      }

      // Two queue messages/minute stay below the current Workers Free
      // Queues 10,000 operations/day allowance while each message fans out
      // into 24 isolated Worker invocations through a service binding.
      const messages = [
        { body: { kind: "claim", contentType, fanout: 4 } },
      ];

      await env.FILL_QUEUE.sendBatch(messages);
      await writeState(env, {
        last_run_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error: null,
        stats: {
          state: "queued",
          executor: "cloudflare-queue-dispatcher",
          content_type: contentType,
          messages: messages.length,
          fanout: 24,
        },
      });
      console.log(
        `[akwam-queue-dispatcher] queued=2 contentType=${contentType} fanout=24`,
      );
    } catch (error) {
      await writeState(env, {
        last_run_at: new Date().toISOString(),
        last_success_at: null,
        last_error: String(error).slice(0, 1800),
        stats: { state: "failed", executor: "cloudflare-queue-dispatcher" },
      });
      console.error("[akwam-queue-dispatcher]", String(error));
    }
  },
};
