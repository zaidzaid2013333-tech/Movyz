# Movyza

Movyza is now a deliberately small, catalog-first application.

## Runtime architecture

- TMDB: live catalog, search, movie/series details, seasons and episodes.
- Cloudflare: static web delivery plus a tiny same-origin TMDB proxy. The TMDB read token lives only as a Cloudflare secret.
- Supabase: authentication, profiles, watchlist, watch history and reports.
- GitHub Actions: validates and deploys the Cloudflare Worker.

There is no custom Node backend, resolver, provider registry, playback queue, Railway service, catalog sync service, or playback source database.

## Local setup

Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. For local development, set VITE_TMDB_PROXY_URL to a deployed Movyza Cloudflare URL if /tmdb is not available locally.

## Deployment

GitHub Actions deploys worker.ts with Wrangler. Configure CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SUPABASE_URL, SUPABASE_ANON_KEY, and TMDB_API_READ_ACCESS_TOKEN as repository secrets.