type Env = {
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const TARGET = "https://movyz-akwam-prefill.sameranede.workers.dev/";

async function dispatch(env: Env) {
  const response = await fetch(TARGET, {
    method: "POST",
    headers: {
      "x-movyz-prefill-key": env.SUPABASE_SERVICE_ROLE_KEY,
      "x-movyz-prefill-mode": "fanout",
    },
  });
  return { status: response.status };
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "POST" && request.headers.get("x-movyz-prefill-launcher-key") === env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({ ok: true, ...(await dispatch(env)) });
    }
    return Response.json({ ok: true, service: "movyz-akwam-launcher" });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatch(env).catch((error) => console.error(String(error))));
  },
};
