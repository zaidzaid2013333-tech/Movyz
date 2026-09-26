import 'dotenv/config';
import { adminSupabase } from '../server/supabase';

async function count(table: string) {
  const { count, error } = await adminSupabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

const [movies, series, seasons, episodes, genres, jobs] = await Promise.all([
  count('movies'),
  count('series'),
  count('seasons'),
  count('episodes'),
  count('genres'),
  count('sync_jobs'),
]);

console.log(JSON.stringify({ movies, series, seasons, episodes, genres, syncJobs: jobs }, null, 2));

if (movies === 0 || series === 0 || genres === 0) {
  throw new Error('TMDB verification failed: catalog tables are still empty');
}
