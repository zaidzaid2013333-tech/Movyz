## Verified live-site fingerprint (2026-10-04)
The current `https://akwam.ss` structure was checked against live indexed pages before updating the worker.

### Canonical content layers
1. **Movie detail:** `/movie/<id>/<slug>`
   - The current movie detail page exposes one or more quality rows such as 1080p/720p/480p and separate **مشاهدة** / **تحميل** actions.
2. **Series detail:** `/series/<id>/<slug>`
   - The series page lists episode links and can contain hundreds of episodes.
3. **Episode detail:** `/episode/<id>/<slug>/الحلقة-<n>`
   - The episode page exposes the available qualities and separate **مشاهدة** / **تحميل** actions.
4. **Watch page:** `/watch/<watch-id>/<episode-id>/<slug>`
   - A watch page is an intermediate player page. The final media is inside its player HTML/config (for the observed current site, a final MP4 is exposed through the player/source layer).
5. **Final media:** the URL observed inside the watch/download result is the only playable artifact. Validate it before storing it.

Examples verified from the live site include the current One Piece series and episode 1168 pages, and current movie pages such as Interstellar. The site also still exposes legacy `/old/` pages; those are historical pages, not the canonical current catalog path, and must not win candidate selection. citeturn333770search0turn333770search1turn298131search0

### Current canonical-host and link-resolution rules
- Start from the configured Akwam entrypoint `https://ak.sv`. Accept observed canonical redirects/absolute links on `ak.sv`, `akwam.ss`, and `akwam.it` (including `www` variants). These are the same Akwam route family; do not reject a valid content page only because the current canonical host changed.
- The current CloudStream Akwam extractor independently confirms the current search endpoint as `/search?q=<query>`, content cards under `div.entry-box`, and Akwam quality/download handling. The worker should use the current DOM signals rather than generic guessing. 
- For a movie/episode detail page, identify each quality block and prefer its **تحميل** link. The deterministic current route is:
  `detail page -> /download/... -> download page -> div.btn-loader > a -> final media URL`.
- If a quality row exposes a `/link/...` action instead of `/download/...`, reconstruct the current Akwam `/download...` target only from the observed link and content path; never fabricate IDs.
- Only after the download path is unavailable should the worker fall back to the **مشاهدة** / `/watch/` path.
- A final `btn-loader > a` href can be extensionless. Treat it as `direct` initially and let media validation prove whether it is actually video.

### Deterministic route
For **episodes**, the worker must follow:
`TMDB metadata -> Akwam /series candidate -> exact /episode/ link -> /watch/ or /download/ target -> final media -> validation -> Supabase`

For **movies**:
`TMDB metadata -> Akwam /movie candidate -> /watch/ or /download/ target -> final media -> validation -> Supabase`

Never jump directly from a search result to a guessed media URL.

### Candidate identity rules
- For an episode job, accept only a current `/series/` candidate whose title/slug matches the requested title strongly.
- For a movie job, accept only a current `/movie/` candidate whose title/slug matches strongly.
- The URL slug is a first-class title signal because Akwam action anchors can contain generic labels such as **مشاهدة** rather than the content title.
- Year is a tie-breaker only after title identity is established. A matching year must never rescue an unrelated title.
- Never accept `/old/` candidates as the canonical content source.
- Normalize Arabic letters/digits, URL-decode, decode HTML entities, and compare title + slug before selecting a candidate.

### Episode rules
- Prefer the exact observed `/episode/` href from the series page.
- Match the requested episode number in both link text and URL path.
- Treat decimal specials (for example `1168.5`) as different from integer episode `1168`.
- Season identity is a secondary confirmation when explicit; never infer a season from a large page-wide neighborhood.
- After finding the exact episode, fetch that episode page and only then inspect its watch/download actions.

### Extraction rules
- On movie/episode detail pages, rank **/watch/** targets first, then **/download/**, then **/link/**.
- On watch pages, inspect `<video>`, `<source>`, player/config values, and observed media-looking URLs.
- Accept observed `.m3u8`, `.mp4`, `.mpd`, `.webm`, or a non-extension URL only when response validation proves it is media.
- Never store an iframe, watch page, download page, episode page, or HTML/JSON response as a playback source.
- Preserve an observed Akwam watch-page URL only as validation referer metadata when required; the stored playback URL remains the final media URL.

### Validation rules
- Final URL must be HTTPS.
- Use a bounded Range request and inspect only a small prefix.
- Reject HTML/challenge/captcha/Cloudflare responses.
- HLS must expose `#EXTM3U`.
- DASH must expose an MPD/XML manifest.
- WebM must have WebM MIME/signature.
- MP4/direct must have a video/octet-stream MIME or a valid MP4 `ftyp` signature.
- Never mark a job successful until at least one final media URL passes validation and is written to `playback_sources`.

# Movyz Akwam Extraction Playbook

## Purpose
This is the persistent operating manual for the Movyz HTTP-only Akwam resolver and its optional maintenance/training tooling.
It is a context-learning layer, not model-weight fine-tuning. Training/maintenance may use this playbook plus recent verified failures/results, but Groq and browser automation are never part of the live playback path.

## Hard invariants
1. Allowed Akwam origin: https://akwam.ss only.
2. Discovery happens in the background prefill worker only. Live playback is DB-only: it reads already validated prepared sources and never performs source discovery.
3. Store only the validated final media URL in Supabase playback_sources. Search pages, series pages, episode pages, iframes, embeds, /download pages, /link pages, HTML or JSON are never playback media.
4. A candidate URL is not success. Success means a final HTTPS media URL passes deterministic media validation.
5. Preserve healthy qualities. Refresh only qualities that were actually rediscovered and validated.
6. Never invent or mutate an Akwam URL that was not observed from a verified page/tool result.
7. Never use old domains/origins, unrelated mirrors, or browser automation for playback or source discovery.
8. Stop retry loops. Change strategy after a failed attempt.

## Discovery strategy
Use a bounded staged sequence. Stay below the request/subrequest budget of the Worker; do not burst every route concurrently.

A) Known exact page
- For a series, prefer /series/<id>/<slug> pages.
- For an episode, use the exact /episode/<id>/<slug>/الحلقة-<n> href found on the matching series page.
- For a movie, use /movie/<id>/<slug> pages.

B) Search routes
Try one route family at a time and stop as soon as credible candidates appear:
- /old/search/<encoded-query>
- /search?q=<encoded-query>
- legacy site query forms only as fallback.

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
7. Return/cache temporarily only after validation succeeds; do not persist the Akwam media URL to playback_sources.
8. Record quality/type/observed referer/expiry in ephemeral runtime state when available.

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
- temporary cache + signed redirect creation
- non-URL health/maintenance metadata

Groq:
- select among observed candidates
- choose a title/query variant
- classify failure
- choose the next deterministic strategy
- summarize lessons
Groq must never invent, fetch, or directly persist a playback URL. Groq is not called on the live playback path.

## Success definition
The training is considered useful only when it changes future decisions measurably:
- fewer repeated identical failures;
- better candidate selection;
- more verified final media URLs;
- no false "success" states;
- bounded on-demand discovery at playback time;
- no video proxying by Movyz;
- no Browser Run dependency;
- no permanent Akwam media URL storage.
