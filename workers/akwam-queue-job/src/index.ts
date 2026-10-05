import { run } from "../../akwam-prefill/src/index";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  AKWAM_BASE_URL: string;
  MAX_JOBS_PER_RUN: string;
  PREFILL_CONCURRENCY?: string;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({
        ok: true,
        service: "movyz-akwam-job",
        mode: "queue-service",
      });
    }

    try {
      const workerId = `queue-job-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const result = await run(env, workerId, 1);
      return Response.json({
        ok: true,
        executor: "cloudflare-queue-job",
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[akwam-queue-job]", message);
      return Response.json(
        { ok: false, service: "movyz-akwam-job", error: message.slice(0, 1800) },
        { status: 500 },
      );
    }
  },
};
