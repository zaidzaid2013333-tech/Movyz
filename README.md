# MOVYZ

Arabic-first movie and series platform.

## Architecture

Browser UI -> Movyz API -> Supabase/PostgreSQL
                         -> TMDB metadata sync
                         -> VidLux embedded playback

TMDB remains the catalog and metadata source. Video playback is handled by the YapGrid embed player using the stored TMDB id; the Movyz backend does not resolve MovieBox, H5, Render, HLS, DASH, MP4, or provider playback URLs.

## Playback

VidLux is used for both movies and TV episodes:

- Movies: `https://vidlux.xyz/embed/movie/{tmdb_id}`
- TV: `https://vidlux.xyz/embed/tv/{tmdb_id}/{season}/{episode}`
- VidLux provides multiple streaming sources with automatic fallback.
- The player supports multi-language subtitles, including Arabic according to the provider's published feature description.
- Ads/source behavior is controlled by VidLux; its published community listing claims minimal popup ads, but this is not an official SLA and must be monitored in production.
- No server parameter is fabricated in our code; source switching is left to the provider's player.

## Local development

1. Copy .env.example to .env.
2. Create the Supabase project and run `supabase/MOVYZ_FULL_SETUP.sql`. If you already ran the older setup successfully, run `supabase/migrations/202609260004_pre_sync_hardening.sql` once instead.
3. Fill Supabase server/browser credentials.
4. Start the API with `npm run server:dev`.
5. Start Vite with `npm run dev`.

Vite proxies /api and /health to the API on localhost:8787.

## Authentication

Supabase Auth handles passwords and sessions. Public roles are USER, ADMIN and OWNER. The role is stored in public.profiles and is never accepted from the browser.

After creating the trusted owner account, bootstrap it once from the Supabase SQL editor:

```sql
update public.profiles set role = 'OWNER' where id = '<AUTH_USER_UUID>';
```

## TMDB

TMDB is used for metadata only. Add `TMDB_API_READ_ACCESS_TOKEN` to the server environment. The admin sync endpoint imports localized catalog metadata and season metadata.

TMDB does not provide the playback itself. Movyza passes the title's public TMDB id to YapGrid for embedded playback.

## Production rules

- Never commit .env files or secrets.
- Never ship mock catalog data as production data.
- Never trust a client-supplied role.
- Keep TMDB as metadata-only.
