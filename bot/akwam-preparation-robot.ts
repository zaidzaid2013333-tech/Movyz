import { spawn } from 'node:child_process';
import { adminSupabase } from '../server/supabase';

type RobotMode = 'movies' | 'episodes' | 'both';
const ROBOT_VERSION = '1.0.2';

const mode = (process.env.AKWAM_ROBOT_MODE || 'both') as RobotMode;
const movieShardIndex = Number.parseInt(process.env.AKWAM_MOVIE_SHARD_INDEX || '0', 10) || 0;
const movieShardCount = Math.max(1, Number.parseInt(process.env.AKWAM_MOVIE_SHARD_COUNT || '1', 10) || 1);
const episodeShardIndex = Number.parseInt(process.env.AKWAM_EPISODE_SHARD_INDEX || '0', 10) || 0;
const episodeShardCount = Math.max(1, Number.parseInt(process.env.AKWAM_EPISODE_SHARD_COUNT || '2', 10) || 2);

const runMode = mode === 'movies' || mode === 'episodes' ? mode : 'both';
const runKey =
  `akwam-preparation-robot:${runMode}:m${movieShardIndex}:e${episodeShardIndex}`;

async function markState(values: {
  last_run_at?: string;
  last_success_at?: string | null;
  last_error?: string | null;
  stats?: Record<string, unknown>;
}) {
  const { error } = await adminSupabase.from('maintenance_state').upsert({
    job_key: runKey,
    ...values,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'job_key' });
  if (error) throw error;
}

async function currentWorkingSourceCount(contentType: 'movie' | 'episode') {
  const { count, error } = await adminSupabase
    .from('playback_sources')
    .select('id', { count: 'exact', head: true })
    .eq('provider_reference', 'akwam')
    .eq('content_type', contentType)
    .eq('is_working', true);

  if (error) return null;
  return count ?? 0;
}

function run(script: string, env: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', script],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: 'inherit',
      },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed with code=${String(code)} signal=${String(signal)}`));
    });
  });
}

async function main() {
  const startedAt = new Date().toISOString();

  console.log(JSON.stringify({
    robot: 'movyz-akwam-preparation',
    version: ROBOT_VERSION,
    mode,
    runKey,
    playbackDiscovery: 'background-only',
    origin: 'https://akwam.ss/',
    policy: 'prepare-store-proxy-play-native',
  }));

  await markState({
    last_run_at: startedAt,
    last_success_at: null,
    last_error: null,
    stats: {
      version: ROBOT_VERSION,
      mode: runMode,
      runKey,
      movieShardIndex,
      movieShardCount,
      episodeShardIndex,
      episodeShardCount,
      startedAt,
      state: 'running',
    },
  });

  if (mode === 'movies' || mode === 'both') {
    await run('scripts/prepare-arprov-sources.ts', {
      PREPARE_MODE: 'movies',
      PREPARE_ONLY_MISSING: 'true',
      PREPARE_SHARD_INDEX: String(movieShardIndex),
      PREPARE_SHARD_COUNT: String(movieShardCount),
      PREPARE_CONCURRENCY: process.env.PREPARE_CONCURRENCY || '2',
      PREPARE_LIMIT: process.env.PREPARE_LIMIT || '500',
      PREPARE_OFFSET: process.env.PREPARE_OFFSET || '0',
    });
  }

  if (mode === 'episodes' || mode === 'both') {
    await run('scripts/prepare-arprov-episodes-fast.ts', {
      PREPARE_ONLY_MISSING: 'true',
      EPISODE_SHARD_INDEX: String(episodeShardIndex),
      EPISODE_SHARD_COUNT: String(episodeShardCount),
      EPISODE_SEASON_LIMIT: process.env.EPISODE_SEASON_LIMIT || '20',
      EPISODE_CONCURRENCY: process.env.EPISODE_CONCURRENCY || '8',
      SEASON_CONCURRENCY: process.env.SEASON_CONCURRENCY || '1',
    });
  }

  const completedAt = new Date().toISOString();
  const contentType = runMode === 'episodes' ? 'episode' : 'movie';
  const sourceCount = await currentWorkingSourceCount(contentType);
  await markState({
    last_run_at: startedAt,
    last_success_at: completedAt,
    last_error: null,
    stats: {
      version: ROBOT_VERSION,
      mode: runMode,
      runKey,
      movieShardIndex,
      movieShardCount,
      episodeShardIndex,
      episodeShardCount,
      startedAt,
      completedAt,
      state: 'success',
      workingSourceCount: sourceCount,
    },
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await markState({
      last_run_at: new Date().toISOString(),
      last_success_at: null,
      last_error: message,
      stats: {
        version: ROBOT_VERSION,
        mode: runMode,
        runKey,
        movieShardIndex,
        movieShardCount,
        episodeShardIndex,
        episodeShardCount,
        state: 'failed',
      },
    });
  } catch (stateError) {
    console.error('[akwam-robot-state]', stateError);
  }
  console.error('[akwam-robot]', message);
  process.exitCode = 1;
}
