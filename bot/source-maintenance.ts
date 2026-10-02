import 'dotenv/config';
import { runMaintenanceTick } from '../server/maintenance';

type JobKey = 'primary_sources' | 'secondary_sources' | 'repair_sources';

const JOBS: Array<{ key: JobKey; everyMs: number; initialDelayMs: number }> = [
  { key: 'primary_sources', everyMs: 5 * 60 * 1000, initialDelayMs: 15_000 },
  { key: 'secondary_sources', everyMs: 10 * 60 * 1000, initialDelayMs: 2 * 60 * 1000 + 20_000 },
  { key: 'repair_sources', everyMs: 15 * 60 * 1000, initialDelayMs: 4 * 60 * 1000 + 40_000 },
];

let shuttingDown = false;
let activeRuns = 0;

function log(message: string, extra?: unknown) {
  if (extra === undefined) {
    console.log('[movyz-source-bot]', new Date().toISOString(), message);
    return;
  }
  console.log('[movyz-source-bot]', new Date().toISOString(), message, JSON.stringify(extra));
}

async function run(jobKey: JobKey) {
  if (shuttingDown) return;

  activeRuns += 1;
  try {
    const result = await runMaintenanceTick(jobKey);
    log(jobKey + ' completed', result);
  } catch (error) {
    log(jobKey + ' failed', error instanceof Error ? { error: error.message } : { error: String(error) });
  } finally {
    activeRuns -= 1;
  }
}

function schedule(job: typeof JOBS[number]) {
  const timer = setTimeout(() => {
    void run(job.key);
    const interval = setInterval(() => {
      void run(job.key);
    }, job.everyMs);

    const cleanup = () => clearInterval(interval);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }, job.initialDelayMs);
 
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY');
  }

  log('standalone maintenance bot started');
  log('schedules', JOBS.map(({ key, everyMs, initialDelayMs }) => ({
    key,
    everyMinutes: everyMs / 60_000,
    initialDelayMinutes: initialDelayMs / 60_000,
  })));

  JOBS.forEach(schedule);

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('shutdown requested', { signal, activeRuns });

    const deadline = Date.now() + 30_000;
    while (activeRuns > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (activeRuns > 0) {
      log('shutdown deadline reached', { activeRuns });
    } else {
      log('shutdown complete');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  setInterval(() => {
    if (!shuttingDown) log('heartbeat', { activeRuns });
  }, 60 * 60 * 1000);
}

main().catch((error) => {
  log('fatal startup error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
