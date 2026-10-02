# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                     -> TMDB metadata sync

TMDB is used for catalog metadata only.

## Playback

The production playback path is:

1. Re3Arabi is the only playback-source API/provider used by Movyz.
2. Re3Arabi returns direct HTTPS media links such as MP4/HLS/DASH/WebM.
3. Those direct links are stored in `playback_sources` and served by the Movyz API.
4. WatchPage consumes the stored direct links; it does not call a runtime playback resolver.
5. Movyz never proxies video bytes through the user-facing API.

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
