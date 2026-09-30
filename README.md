# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                     -> TMDB metadata sync

TMDB is used for catalog metadata. Playback does not go through a Watch Source API or server-side playback resolver.

## Playback

The production playback path is intentionally simple:

1. The browser loads the published movie/series metadata from the Movyz API.
2. VideoPlayer builds the VidCore URL directly from the TMDB ID.
3. Movyz renders that URL as a direct HTTPS iframe.
4. For series, the season and episode are included directly in the VidCore URL.

There is no client-side getWatchSources() call, no playback-source resolver, and no /api/v1/watch/:mediaType/:tmdbId playback endpoint.

Playback remains external; video files are not hosted by the frontend.

## Authentication and roles

Supabase Auth handles credentials and sessions. Roles are stored in public.profiles as USER, ADMIN, or OWNER.
A database trigger creates a profile automatically when a new Auth user is created.

## Local development

1. Copy .env.example to .env.
2. Create the Supabase project and run supabase/MOVYZ_FULL_SETUP.sql.
3. Fill Supabase and TMDB credentials.
4. Start the API with npm run server:dev.
5. Start Vite with npm run dev.

## Production rules

- Never commit .env files or secrets.
- Never ship mock catalog data.
- Never trust a client-supplied role.
- Keep TMDB metadata-only.
- Keep playback as a direct VidCore iframe in the frontend.
