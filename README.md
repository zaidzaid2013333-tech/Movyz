# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                     -> TMDB metadata sync
                     -> provider registry -> playback sources

TMDB is used for catalog metadata. Playback URLs are resolved server-side by registered providers and exposed to the Movyza player through the Movyz API.

## Playback

The current production playback path:
1. The player asks `/api/v1/playback/sources` for the movie or episode UUID.
2. Movyz reuses a valid cached source when available.
3. If no valid cache exists, the provider registry resolves an enabled provider.
4. The current built-in provider is ezvidAPI, with provider discovery and source normalization on the server.
5. The player supports HLS and MP4, source switching, and automatic failover when another returned source is available.

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
