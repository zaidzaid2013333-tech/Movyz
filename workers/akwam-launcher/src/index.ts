type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type Env = {
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const TARGET = "https://movyz-akwam-prefill.sameranede.workers.dev/";
const BATCHES_PER_TICK = 15; // 15 single-job executions per launcher tick

async function dispatch(env: Env) {
  const requests = Array.from({ length: BATCHES_PER_TICK }, () =>
    fetch(TARGET, {
      method: "POST",
      headers: {
        "x-movyz-prefill-key": env.SUPABASE_SERVICE_ROLE_KEY,
        "x-movyz-prefill-mode": "batch",
      },
    })
  );

  const settled = await Promise.allSettled(requests);
  return {
    launched: settled.length,
    accepted: settled.filter((r) => r.status === "fulfilled").length,
  };
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "POST" && request.headers.get("x-movyz-prefill-launcher-key") === env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ ok: true, ...(await dispatch(env)) });
    }
    return Response.json({ ok: true, service: "movyz-akwam-launcher" });
  },

  async scheduled(_event: unknown, env: Env, ctx: ExecutionContextLike) {
    ctx.waitUntil(dispatch(env).catch((error) => console.error(String(error))));
  },
};
