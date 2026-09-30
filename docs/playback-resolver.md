# External playback resolver

Movyz can resolve a playback source without proxying video traffic through the Movyz Worker.

Set the GitHub Actions secret:

`PLAYBACK_RESOLVER_URL`

The value must be an HTTPS endpoint you are authorized to use. Movyz sends:

- `type`: `movie` or `series`
- `tmdb_id`
- `season` when applicable
- `episode` when applicable
- `episode_tmdb_id` when available

The resolver may also be configured as a URL template using placeholders such as `{{type}}`, `{{tmdbId}}`, `{{season}}`, and `{{episode}}`.

The endpoint should return JSON containing one or more HTTPS playback URLs. Common keys accepted by the existing provider parser include `url`, `stream_url`, `streamUrl`, `video_url`, `hls_url`, `m3u8`, `file`, `source`, `src`, `sources`, and `streams`.

The response is normalized into Movyz playback sources and only the small resolver response passes through the Worker. Video bytes are loaded by the user's browser from the returned source URL.

No resolver URL is bundled into the frontend, and the API rejects playback resolution when the secret is not configured.
