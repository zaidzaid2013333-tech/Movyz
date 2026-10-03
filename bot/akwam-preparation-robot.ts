import { spawn } from 'node:child_process';

type RobotMode = 'movies' | 'episodes' | 'both';

const mode = (process.env.AKWAM_ROBOT_MODE || 'both') as RobotMode;
const movieShardIndex = Number.parseInt(process.env.AKWAM_MOVIE_SHARD_INDEX || '0', 10) || 0;
const movieShardCount = Math.max(1, Number.parseInt(process.env.AKWAM_MOVIE_SHARD_COUNT || '1', 10) || 1);
const episodeShardIndex = Number.parseInt(process.env.AKWAM_EPISODE_SHARD_INDEX || '0', 10) || 0;
const episodeShardCount = Math.max(1, Number.parseInt(process.env.AKWAM_EPISODE_SHARD_COUNT || '2', 10) || 2);

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
  console.log(JSON.stringify({
    robot: 'movyz-akwam-preparation',
    mode,
    playbackDiscovery: 'background-only',
    origin: 'https://akwam.ss/',
    policy: 'prepare-store-proxy-play-native',
  }));

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
}

await main();
