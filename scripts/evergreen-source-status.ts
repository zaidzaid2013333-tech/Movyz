import 'dotenv/config';

import { adminSupabase } from '../server/supabase';

const { count, error } = await adminSupabase
  .from('playback_source_jobs')
  .select('id', { count: 'exact', head: true })
  .in('status', ['pending', 'running']);

if (error) throw new Error('queue status failed: ' + error.message);

console.log(Math.max(0, count || 0));
