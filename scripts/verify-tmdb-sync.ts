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

const { data: publishedSeries, error: publishedSeriesError } = await adminSupabase
  .from('series')
  .select('id,tmdb_id,title_en')
  .eq('status', 'published');

if (publishedSeriesError) throw new Error('series: ' + publishedSeriesError.message);

const seasonRows: Array<{ id: string; series_id: string; season_number: number }> = [];

for (let offset = 0; ; offset += 1000) {
  const { data, error } = await adminSupabase
    .from('seasons')
    .select('id,series_id,season_number')
    .order('series_id')
    .order('season_number')
    .range(offset, offset + 999);

  if (error) throw new Error('seasons: ' + error.message);
  seasonRows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const episodeRows: Array<{ season_id: string; episode_number: number }> = [];

for (let offset = 0; ; offset += 1000) {
  const { data, error } = await adminSupabase
    .from('episodes')
    .select('season_id,episode_number')
    .order('id', { ascending: true })
    .range(offset, offset + 999);

  if (error) throw new Error('episodes: ' + error.message);
  episodeRows.push(...(data || []));
  if (!data || data.length < 1000) break;
}

const episodeCountBySeason = new Map();
for (const row of episodeRows || []) {
  const list = episodeCountBySeason.get(row.season_id) || [];
  list.push(Number(row.episode_number));
  episodeCountBySeason.set(row.season_id, list);
}

const emptySeasons = (seasonRows || []).filter((row) => !episodeCountBySeason.has(row.id));
const seriesWithoutSeasons = (publishedSeries || []).filter(
  (series) => !(seasonRows || []).some((season) => season.series_id === series.id),
);

console.log(JSON.stringify({
  movies, series, seasons, episodes, genres, syncJobs: jobs,
  publishedSeries: publishedSeries?.length || 0,
  seriesWithoutSeasons: seriesWithoutSeasons.map((x) => x.tmdb_id),
  emptySeasons: emptySeasons.map((x) => ({ seriesId: x.series_id, season: x.season_number })),
}, null, 2));

if (movies === 0 || series === 0 || genres === 0) {
  throw new Error('TMDB verification failed: catalog tables are still empty');
}
if (seriesWithoutSeasons.length) {
  throw new Error('TMDB verification failed: published series contain missing seasons');
}
