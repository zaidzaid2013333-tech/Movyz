# Movyz provider contract

Movyz keeps playback-provider integrations behind a small adapter contract. The frontend never calls a provider directly.

## External playback API adapter

Set:

- `MOVYZA_EXTERNAL_PROVIDER_URL`
- `MOVYZA_EXTERNAL_PROVIDER_TOKEN` (optional)

The adapter calls:

- `GET /health`
- `GET /resolve?type=movie&tmdbId=123`
- `GET /resolve?type=episode&tmdbId=123&season=1&episode=2`

The resolve response must be:

```json
{
  "sources": [
    {
      "url": "https://example.com/video.m3u8",
      "type": "hls",
      "quality": "1080p",
      "language": "ar",
      "label": "Primary",
      "providerReference": "optional-id",
      "expiresAt": "2026-12-31T23:59:59.000Z"
    }
  ]
}
```

Only HTTPS URLs and HLS/MP4/DASH are accepted by the server resolver. Configure only providers and media sources that you are authorized to use.
