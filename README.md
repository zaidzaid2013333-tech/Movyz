# Movyza

Movyza is a lightweight Arabic-first movie and series catalog.

## Runtime architecture

- **TMDB** — live catalog, search, movie/series details and season/episode metadata.
- **Cloudflare Workers** — static web delivery and a minimal same-origin `/tmdb/*` proxy. The TMDB read token stays in a Cloudflare secret.
- **Supabase** — authentication, profiles, watchlist and watch history.
- **GitHub Actions** — CI and Cloudflare deployment only.

There is no Node/Express backend, Railway resolver, Akwam worker, provider registry, playback resolver, playback queue, or playback-source database.

Playback is intentionally disabled in this catalog-only reset.

## Local setup

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_TMDB_PROXY_URL` (defaults to `/tmdb`).

For deployed Cloudflare, configure `TMDB_API_READ_ACCESS_TOKEN` as a Worker secret.

## Deployment

GitHub Actions validates TypeScript, runs the catalog smoke test, builds the Vite app, and deploys the Cloudflare Worker.
