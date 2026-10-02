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
const failedEpisodeIds = Array.isArray(details.failedEpisodeIds)
  ? details.failedEpisodeIds.filter((id): id is string => typeof id === 'string')
  : [];

let remaining = 0;

if (!cursor) {
  const { count, error } = await adminSupabase
    .from('episodes')
    .select('id', { count: 'exact', head: true });

  if (error) throw new Error('Unable to count episodes: ' + error.message);
  remaining = Math.max(0, count || 0);
} else {
  const { count, error } = await adminSupabase
    .from('episodes')
    .select('id', { count: 'exact', head: true })
    .gt('id', cursor);

  if (error) throw new Error('Unable to count remaining episodes: ' + error.message);
  remaining = Math.max(0, count || 0);
}

// Force one more retry pass whenever the latest batch recorded failures.
if (failedEpisodeIds.length) remaining = Math.max(remaining, 1);

console.log(remaining);
