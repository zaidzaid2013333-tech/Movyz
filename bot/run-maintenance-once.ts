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

  const failures: string[] = [];

  for (const jobKey of JOBS) {
    try {
      log('starting ' + jobKey);
      const result = await runMaintenanceTick(jobKey);
      log('finished ' + jobKey, result);

      if ('error' in result && result.error) {
        failures.push(jobKey + ': ' + result.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(jobKey + ': ' + message);
      log('job exception ' + jobKey, { error: message });
    }
  }

  if (failures.length) {
    throw new Error('Maintenance cycle completed with failures: ' + failures.join(' | '));
  }
}

main().catch((error) => {
  log('fatal cycle error', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
