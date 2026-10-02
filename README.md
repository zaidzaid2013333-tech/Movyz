# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                     -> TMDB metadata sync

TMDB is used for catalog metadata only.

## Playback

The production playback path is:

1. The on-demand playback endpoint tries the ArProv-inspired provider/extractor layer first (Akwam, Cima4U, CimaClub).
2. Existing DoodStream and Re3Arabi providers remain as fallbacks.
3. Providers return normalized HTTPS MP4/HLS/DASH/WebM sources; the player consumes the same `PlaybackSource` contract.
4. Movyz never proxies video bytes through the user-facing API.
5. ArProv/CloudStream code is not embedded wholesale; the useful provider/extractor patterns are reimplemented in TypeScript for Workers.

The retired playback maintenance bot, queue prewarm workflow, and scheduled source cron are disabled.

## Authentication and roles

Supabase Auth handles credentials and sessions. Roles are stored in public.profiles as USER, ADMIN, or OWNER.

## Local development

1. Copy .env.example to .env.
2. Create the Supabase project and run the database setup.
3. Fill Supabase and TMDB credentials.
4. Start the API with npm run server:dev.
5. Start Vite with npm run dev.

## Production rules

- Never commit .env files or secrets.
- Never ship mock catalog data.
- Never trust a client-supplied role.
- Keep TMDB metadata-only.
- Keep playback restricted to direct Re3Arabi links.
- Never proxy or embed a separate playback provider from the WatchPage.
