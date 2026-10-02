import 'dotenv/config';

import { adminSupabase } from '../server/supabase';

const { data: previous, error: jobError } = await adminSupabase
  .from('sync_jobs')
  .select('details,finished_at')
  .eq('provider', 'selected-sites')
  .eq('job_type', 'playback-rebind-episodes')
  .eq('status', 'succeeded')
  .order('finished_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (jobError) throw new Error('Unable to inspect episode rebind status: ' + jobError.message);

const details = previous?.details && typeof previous.details === 'object'
  ? previous.details as Record<string, unknown>
  : {};
const cursor = typeof details.nextCursor === 'string' ? details.nextCursor : '';

if (!cursor) {
  const { count, error } = await adminSupabase
    .from('episodes')
    .select('id', { count: 'exact', head: true });

  if (error) throw new Error('Unable to count episodes: ' + error.message);
  console.log(Math.max(0, count || 0));
  process.exit(0);
}

const { count, error } = await adminSupabase
  .from('episodes')
  .select('id', { count: 'exact', head: true })
  .gt('id', cursor);

if (error) throw new Error('Unable to count remaining episodes: ' + error.message);

console.log(Math.max(0, count || 0));
