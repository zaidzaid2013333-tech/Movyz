# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                         -> TMDB metadata sync
                         -> provider adapters
                         -> normalized playback sources

The frontend never talks directly to TMDB or provider implementations.

## Local development

1. Copy .env.example to .env.
2. Create the Supabase project and apply supabase/migrations/202609250001_initial_movyz_schema.sql.
3. Fill Supabase server/browser credentials.
4. Start the API with npm run server:dev.
5. Start Vite with npm run dev.

Vite proxies /api and /health to the API on localhost:8787.

## Authentication

Supabase Auth handles passwords and sessions. Public roles are USER, ADMIN and OWNER. The role is stored in public.profiles and is never accepted from the browser.

After creating the trusted owner account, bootstrap it once from the Supabase SQL editor:

update public.profiles set role = 'OWNER' where id = '<AUTH_USER_UUID>';

## TMDB

TMDB is used for metadata only. Add TMDB_API_READ_ACCESS_TOKEN to the server environment. The admin sync endpoint then imports localized catalog metadata and season metadata.

Video playback URLs are not supplied by TMDB.

## CI

GitHub Actions runs TypeScript validation and the Vite production build on pushes and pull requests.

## Production rules

- Never commit .env files or secrets.
- Never ship mock catalog data as production data.
- Never trust a client-supplied role.
- Do not use sample video URLs as production fallbacks.
- Provider adapters must return normalized HLS, MP4 or DASH sources and expose health/failure status.
