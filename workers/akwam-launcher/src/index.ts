type Env = { SUPABASE_SERVICE_ROLE_KEY: string };

export default {
  async fetch(_request: Request, _env: Env) {
    return Response.json({
      ok: true,
      service: "movyz-akwam-launcher",
      status: "disabled",
      reason: "central-prefill-orchestrator",
    });
  },

  async scheduled(_event: unknown, _env: Env, _ctx: { waitUntil(promise: Promise<unknown>): void }) {
    // Legacy launcher intentionally performs no work.
    // The central prefill worker owns scheduling and fan-out now.
  },
};
