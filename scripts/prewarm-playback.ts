import { adminSupabase } from '../server/supabase';
import { resolvePlaybackSources } from '../server/providers/resolver';
import { registerBuiltInProviders } from '../server/providers/bootstrap';

registerBuiltInProviders();

const limit = Math.min(Math.max(Number(process.env.PLAYBACK_LIMIT || 20), 1), 100);

const { data: movies, error } = await adminSupabase
  .from('movies')
  .select('id,tmdb_id,title_ar,title_en')
  .eq('status', 'published')
  .not('tmdb_id', 'is', null)
  .order('vote_count', { ascending: false })
  .limit(limit);

if (error) throw new Error('Failed to load movies: ' + error.message);

let resolvedCount = 0;
for (const movie of movies || []) {
  try {
    const sources = await resolvePlaybackSources('movie', movie.id);
    console.log(JSON.stringify({
      id: movie.id,
      tmdbId: movie.tmdb_id,
      title: movie.title_en || movie.title_ar,
      sourceCount: sources.length,
      providers: sources.map((s: any) => s.provider),
    }));
    if (sources.length) resolvedCount++;
  } catch (error) {
    console.log(JSON.stringify({
      id: movie.id,
      tmdbId: movie.tmdb_id,
      title: movie.title_en || movie.title_ar,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

console.log(JSON.stringify({ scanned: (movies || []).length, resolvedMovies: resolvedCount }));
