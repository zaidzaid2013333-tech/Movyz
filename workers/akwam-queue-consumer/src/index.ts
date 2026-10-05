type JobService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  JOB_WORKER: JobService;
};

type QueueMessage = {
  body: {
    kind?: string;
    fanout?: number;
  };
  retry(options?: { delaySeconds?: number }): void;
};

type QueueBatch = {
  messages: QueueMessage[];
};

const DEFAULT_FANOUT = 4;

export default {
  async fetch(): Promise<Response> {
    return Response.json({
      ok: true,
      service: "movyz-akwam-queue-consumer",
      mode: "queue-consumer",
    });
  },

  async queue(batch: QueueBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const fanout = Math.max(
        1,
        Math.min(48, Number(message.body?.fanout || DEFAULT_FANOUT)),
      );

      const calls = await Promise.allSettled(
        Array.from({ length: fanout }, (_, index) =>
          env.JOB_WORKER.fetch("https://movyz-akwam-job/run", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-movyz-queue-index": String(index),
            },
          }),
        ),
      );

      const failed = calls.filter(
        (result) =>
          result.status === "rejected" ||
          (result.status === "fulfilled" && !result.value.ok),
      ).length;

      if (failed > 0) {
        console.error(
          `[akwam-queue-consumer] fanout=${fanout} failed=${failed}`,
        );
        message.retry({ delaySeconds: Math.min(300, 30 * Math.max(1, failed)) });
      } else {
        console.log(
          `[akwam-queue-consumer] fanout=${fanout} dispatched=${calls.length}`,
        );
      }
    }
  },
};
