# Movyz Akwam Extraction Playbook

## Purpose
This is the persistent operating manual for the Movyz deterministic preparation robot and the Groq supervisor.
It is a context-learning layer, not model-weight fine-tuning. Every training run reads this playbook plus recent verified failures/results and writes a compact learned memory back to Supabase.

## Hard invariants
1. Allowed Akwam origin: https://akwam.ss only.
2. Discovery happens in background preparation only; playback never discovers.
3. Never store search pages, series pages, episode pages, iframes, embeds, /download pages, /link pages, HTML or JSON as playback media.
4. A candidate URL is not success. Success means a final HTTPS media URL passes deterministic media validation.
5. Preserve healthy qualities. Refresh only qualities that were actually rediscovered and validated.
6. Never invent or mutate an Akwam URL that was not observed from a verified page/tool result.
7. Never use old domains/origins, unrelated mirrors, or browser automation for playback.
8. Stop retry loops. Change strategy after a failed attempt.

## Discovery strategy
Use a staged sequence. Do not burst every route concurrently.

A) Known exact page
- Prefer a verified season URL when one is known.
- For a series, prefer /series/<id>/... pages.
- For an episode, prefer /episode/<id>/... pages.

B) Search routes
Try one route family at a time and stop as soon as credible candidates appear:
- /old/search/<encoded-query>
- /search?q=<encoded-query>
- /search?q=<encoded-query>&section=series
- /search/<encoded-query>
- site legacy query forms only as fallback.

C) Query variants
Build variants from:
- Arabic title
- English title
- original title
- TMDB alternative titles
- localized titles supplied by metadata
- transliteration/normalized Latin form
- title + year
- title + season number
- title + Arabic season ordinal
- title + Sxx
- title + SxxEyy
- title + episode number
- title + episode title
Never assume a specific language is correct; the same title may appear Arabic, English, French, transliterated Arabic, or mixed.

## Unicode and text normalization
Normalize before comparing:
- URL-decode percent encoding.
- Decode HTML entities (&amp;, &quot;, &#39;, &nbsp;).
- Decode common JS escaping (\\/, \\u0026, \\u003d, \\u003f).
- Normalize Unicode with NFKD where safe.
- Compare Arabic-Indic digits and Western digits.
- Accept Arabic season ordinals: الأول/الاول، الثاني، الثالث ... and their feminine variants where present.
- Ignore punctuation and repeated whitespace.
- Treat hyphen/underscore/space as equivalent for matching.
- Keep the original observed URL for storage; normalization is for matching only.

## Candidate scoring
Strong positive signals:
- /series/ for a series/season candidate
- /episode/ for an episode candidate
- exact title/original title/alternative title
- exact requested season
- exact requested episode
- explicit episode labels such as الحلقة 1 / Episode 1 / S01E01
- Akwam card classes and poster alt/title text
Strong negative signals:
- /old/ movie pages when preparing an episode
- search/index URLs
- wrong season
- unrelated content type
- candidate contains only generic words from the title
A season mismatch must be treated as a hard reject whenever season identity is explicit.

## Episode indexing
When a series page contains many seasons:
1. Parse each episode anchor's own visible text first.
2. Then inspect image alt/title attributes attached to that anchor.
3. Only then use a small local neighborhood as fallback.
4. Never assign a season from the first season-like string found in a large page-wide neighborhood.
5. Deduplicate by (season, episode) and keep the highest-confidence observed URL.

## Extraction layers
Inspect media in layers, from cheapest to deepest:

1. Anchor/link extraction
- href containing /download, /link, media-like extensions, or provider-specific final paths.

2. HTML media elements
- <video src=...>
- <source src=...>
- data-src, data-file, data-video, data-url, data-stream
- poster/player configuration attributes.

3. Embedded JSON/config
Search script and inline config text for keys/signals such as:
- file
- source
- sources
- src
- url
- stream
- stream_url
- hls
- dash
- playback
- video
- playlist
- manifest
Decode the extracted URL before classification.

4. JavaScript assignment/config patterns
Accept observed final-looking values from patterns like:
- file: "..."
- source: "..."
- src: "..."
- url: "..."
- sources: [...]
- JSON strings containing .m3u8/.mpd/.mp4/.webm
Do not execute arbitrary page JavaScript just to discover playback.

5. Download indirection
If an observed page exposes a /download or /link target:
- resolve that page in background preparation;
- follow only observed HTTPS links;
- extract the final media URL from the returned HTML/config;
- never persist the /download or /link page itself.

## Final-media classification
Accepted source types:
- mp4
- hls (.m3u8)
- dash (.mpd)
- webm
- direct, only when deterministic MIME/media validation proves it is a media resource.

Reject:
- iframe/embed URLs
- HTML pages
- JSON API responses
- search pages
- series/episode detail pages
- /download or /link intermediates
- challenge/captcha pages
- non-HTTPS URLs.

## Quality extraction
Accept real observed quality evidence from:
- 2160/4K
- 1440
- 1080
- 720
- 576
- 480
- 360
- 240
- explicit data-quality/data-resolution/resolution attributes.
Quality IDs may be mapped only when the site's page structure has been verified.
Never label a source 1080p merely because the title says 1080p if the actual source is unverified.

## Validation
For every candidate final media URL:
1. HTTPS check.
2. URL parse.
3. media type inference.
4. MIME/media response check.
5. Range smoke request (bytes=0-1) where supported.
6. Reject obvious HTML/challenge responses.
7. Persist only after validation succeeds.
8. Record quality/type/observed referer/expiry when available.

## Failure learning
Classify failures before retrying:
- SEARCH_EMPTY: no credible Akwam content candidates.
- WRONG_CONTENT: candidate is movie/another title/another type.
- WRONG_SEASON: explicit season mismatch.
- WRONG_EPISODE: explicit episode mismatch.
- DETAIL_EMPTY: content page has no expected episode/media structure.
- DOWNLOAD_EMPTY: no observed download/link target.
- EXTRACT_EMPTY: target exists but no media-looking URL was extracted.
- MEDIA_INVALID: extracted URL failed validation.
- QUALITY_INVALID: quality could not be reliably inferred.
- TRANSIENT: timeout/5xx/429/temporary fetch failure.

Strategy changes:
- SEARCH_EMPTY -> change title/query language/route family; do not repeat identical query.
- WRONG_CONTENT -> strengthen title/type filters.
- WRONG_SEASON/WRONG_EPISODE -> reject candidate and use exact season/episode cues.
- DETAIL_EMPTY -> use another verified series candidate or a known episode seed.
- DOWNLOAD_EMPTY -> inspect inline data/config/media tags rather than inventing a URL.
- EXTRACT_EMPTY -> inspect script/config patterns and normalized escaped URLs.
- MEDIA_INVALID -> discard that URL and try another observed quality/source.
- TRANSIENT -> bounded retry with backoff; then change strategy.
- After 2 repeated failures of the same class, record the lesson and stop repeating the same action.

## Learning loop
Each training run should ingest:
- latest Groq decisions
- latest Akwam debug traces
- recent maintenance_state entries
- recent Akwam-specific maintenance failures
- counts of validated working sources
Then produce compact lessons with:
- rule
- trigger/failure class
- preferred next action
- strategy to avoid
- confidence
The next Groq run must see those lessons before choosing an action.

## Separation of responsibilities
Deterministic code:
- fetching
- parsing
- URL normalization
- media extraction
- validation
- database writes

Groq:
- select among observed candidates
- choose a title/query variant
- classify failure
- choose the next deterministic strategy
- summarize lessons
Groq must never invent or directly persist a URL.

## Success definition
The training is considered useful only when it changes future decisions measurably:
- fewer repeated identical failures;
- better candidate selection;
- more verified final media URLs;
- no false "success" states;
- no playback-time discovery.
