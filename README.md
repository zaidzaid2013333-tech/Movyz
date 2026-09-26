# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                     -> TMDB metadata sync
                     -> provider registry -> playback sources

TMDB is used for catalog metadata. Playback URLs are resolved server-side by registered providers and exposed to the Movyza player through the Movyz API.

## Playback

The current production playback path:
1. The player asks `/api/v1/watch/:mediaType/:tmdbId` for direct movie/series playback.
2. Watch playback reads only valid cached rows from `playback_sources`.
3. Sources are filtered to HTTPS HLS, MP4, or DASH URLs and only active/working rows are returned.
4. The legacy provider resolver remains available separately for source management and compatibility.

Playback sources are external URLs; video files are not hosted by the frontend.

## Authentication and roles

Supabase Auth handles credentials and sessions. Roles are stored in `public.profiles` as USER, ADMIN, or OWNER.
A database trigger creates a profile automatically when a new Auth user is created.

## Local development

1. Copy `.env.example` to `.env`.
2. Create the Supabase project and run `supabase/MOVYZ_FULL_SETUP.sql`.
3. Fill Supabase and TMDB credentials.
4. Start the API with `npm run server:dev`.
5. Start Vite with `npm run dev`.

## Production rules

- Never commit `.env` files or secrets.
- Never ship mock catalog data.
- Never trust a client-supplied role.
- Keep TMDB metadata-only.
- Keep playback provider configuration server-side.
