import 'dotenv/config';
import { runMaintenanceTick } from '../server/maintenance';

type JobKey = 'primary_sources' | 'secondary_sources' | 'repair_sources';

const JOBS: JobKey[] = ['primary_sources', 'secondary_sources', 'repair_sources'];

function log(message: string, extra?: unknown) {
  if (extra === undefined) {
    console.log('[movyz-source-cycle]', new Date().toISOString(), message);
    return;
  }
  console.log('[movyz-source-cycle]', new Date().toISOString(), message, JSON.stringify(extra));
}

async function main() {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error('Missing ' + missing.join(', '));
  }

  for (const jobKey of JOBS) {
    log('starting ' + jobKey);
    const result = await runMaintenanceTick(jobKey);
    log('finished ' + jobKey, result);

    if ('error' in result && result.error) {
      throw new Error(jobKey + ': ' + result.error);
    }
  }
}

main().catch((error) => {
  log('fatal cycle error', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
