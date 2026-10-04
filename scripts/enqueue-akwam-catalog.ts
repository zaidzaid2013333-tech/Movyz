import 'dotenv/config';

import { adminSupabase } from '../server/supabase';

async function enqueueAll() {
  const now = new Date().toISOString();

  const movies = await adminSupabase.from('movies').select('id').order('id');
  if (movies.error) throw new Error('movies: ' + movies.error.message);

  const episodes = await adminSupabase.from('episodes').select('id').order('id');
  if (episodes.error) throw new Error('episodes: ' + episodes.error.message);

  const movieRows = (movies.data || []).map((row: any) => ({
    content_type: 'movie',
    content_id: row.id,
    provider_lane: 'primary',
    priority: 80,
    status: 'pending',
    available_at: now,
    details: { reason: 'akwam-full-catalog' },
  }));

  const episodeRows = (episodes.data || []).map((row: any) => ({
    content_type: 'episode',
    content_id: row.id,
    provider_lane: 'primary',
    priority: 70,
    status: 'pending',
    available_at: now,
    details: { reason: 'akwam-full-catalog' },
  }));

  for (const item of [
    ['movies', movieRows],
    ['episodes', episodeRows],
  ]) {
    const label = item[0];
    const rows = item[1];
    for (let offset = 0; offset < rows.length; offset += 1000) {
      const chunk = rows.slice(offset, offset + 1000);
      const { error } = await adminSupabase
        .from('playback_source_jobs')
        .upsert(chunk, {
          onConflict: 'content_type,content_id,provider_lane',
          ignoreDuplicates: true,
        });
      if (error) throw new Error(label + ' batch ' + offset + ': ' + error.message);
      console.log(label, offset, chunk.length);
    }
  }

  console.log(JSON.stringify({
    movies: movieRows.length,
    episodes: episodeRows.length,
    primaryQueued: movieRows.length + episodeRows.length,
  }, null, 2));
}

await enqueueAll();
