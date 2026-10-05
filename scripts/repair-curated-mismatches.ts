import 'dotenv/config';

import { adminSupabase } from '../server/supabase';
import { syncSeriesByTmdbId } from '../server/tmdb';

const repairs = [
  { rank: 64, tmdbId: 253941, curatedYear: 2026 },
  { rank: 65, tmdbId: 285807, curatedYear: 2026 },
  { rank: 138, tmdbId: 124101, curatedYear: 2025 },
  { rank: 139, tmdbId: 95480, curatedYear: 2025 },
  { rank: 185, tmdbId: 78191, curatedYear: 2025 },
  { rank: 22, tmdbId: 94997, curatedYear: 2026 },
  { rank: 49, tmdbId: 62560, curatedYear: 2026 },
  { rank: 159, tmdbId: 100757, curatedYear: 2026 },
] as const;

const results: Array<Record<string, unknown>> = [];

for (const item of repairs) {
  try {
    const synced = await syncSeriesByTmdbId(item.tmdbId);
    const id = synced.id;
    const { error } = await adminSupabase
      .from('series')
      .update({
        status: 'published',
        popular: true,
        trending: item.rank <= 50,
        featured: item.rank <= 10,
        metadata: {
          curated_rank: item.rank,
          curated_year: item.curatedYear,
        },
      })
      .eq('id', id);

    if (error) throw new Error(error.message);

    results.push({ ...item, status: 'repaired', id });
  } catch (error) {
    results.push({
      ...item,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify(results, null, 2));
if (results.some((x) => x.status === 'error')) process.exitCode = 1;
