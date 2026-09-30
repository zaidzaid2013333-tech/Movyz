# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                     -> TMDB metadata sync

TMDB is used for catalog metadata. Playback does not go through a Watch Source API or server-side playback resolver.

## Playback

The production playback path is:

1. The browser loads published movie/series metadata from the Movyz API.
2. WatchPage requests `/api/v1/playback/resolve` with the TMDB ID and, for series, season/episode.
3. Movyz resolves Akwam playback through OmegaTech and returns external HTTPS media URLs.
4. WatchPage accepts only the `omegatech-akwam` provider and plays returned MP4/HLS media directly in the browser.
5. Video bytes are never proxied or stored by Movyz.

There is no VidCore URL generation and no VidCore iframe in the production WatchPage.

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
- Keep playback routed through OmegaTech/Akwam and played directly in the browser; never generate or embed VidCore URLs.
