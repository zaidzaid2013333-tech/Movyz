import 'dotenv/config';

import { adminSupabase } from '../server/supabase';

const nowIso = new Date().toISOString();
const staleCutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();

const [pending, running] = await Promise.all([
  adminSupabase
    .from('playback_source_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lte('available_at', nowIso),
  adminSupabase
    .from('playback_source_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'running')
    .lt('locked_at', staleCutoff),
]);

if (pending.error) throw new Error('pending queue status failed: ' + pending.error.message);
if (running.error) throw new Error('running queue status failed: ' + running.error.message);

console.log(Math.max(0, (pending.count || 0) + (running.count || 0)));
