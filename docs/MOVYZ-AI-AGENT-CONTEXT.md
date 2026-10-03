# Movyz — Persistent Development Context
Updated: 2026-10-03

## Project
- Repo: zaidzaid2013333-tech/Movyz
- Production Worker/site: https://movyz-api.sameranede.workers.dev/
- Supabase project: btrjguegbmusijsyylwl
- Architecture: UI -> Movyz API -> Supabase/TMDB/provider preparation -> Playback Proxy -> native player.
- Arabic-first RTL, modern/dark, mobile 320px-4K.
- TMDB is metadata only.
- Goal: low-cost, prepared playback sources, no Browser Run during user playback.

## Mandatory playback architecture
PREPARE ONCE -> VALIDATE -> STORE -> PROXY AT PLAYBACK -> NATIVE PLAYER -> 2:00 WARMUP -> FAILOVER ONLY TO PREPARED SOURCES.

Never:
- discover sources during playback
- use Browser Run for playback
- expose raw Akwam URLs to the browser
- store iframe/embed/intermediate HTML as media
- delete healthy qualities when another quality fails
- use old Akwam origins
- treat HTML/JSON as video
- loop quality switching endlessly

Akwam rules:
- allowed origin: https://akwam.ss only
- stored URL must be final HTTPS media
- source types: mp4/hls/dash/webm/direct
- qualities: real 1080p/720p/480p/360p
- all Akwam playback goes through playback proxy
- validation includes HTTPS, MIME/media checks and Range smoke (bytes=0-1)
- preserve healthy qualities while refreshing one quality

## Robot
Files:
- bot/akwam-preparation-robot.ts
- .github/workflows/akwam-preparation-robot.yml
- scripts/prepare-arprov-sources.ts
- scripts/prepare-arprov-episodes-fast.ts
- scripts/validate-prepared-source.ts
- server/providers/arprov-akwam.ts
- bot/groq-akwam-agent.ts
- scripts/debug-breaking-bad-akwam.ts

Robot workflow:
- GitHub Actions
- movie shards: 4
- episode shards: 2
- Node 22
- scheduled twice daily
- Groq agent runs after normal lanes
- GROQ_MODEL=openai/gpt-oss-120b
- GROQ_API_KEY is a GitHub Actions secret; never expose it
- current design: deterministic workers do execution; Groq is compact decision/reasoning brain only.

## Groq Agent design
- deterministic preflight first
- if failure, search real Akwam series candidates
- Groq receives only compact failure context + candidate URLs
- Groq returns JSON: candidateUrl, titleVariant, retryQuery, reason
- Groq must never invent URLs
- Agent only chooses from verified candidate URLs
- deterministic resolver/validator performs execution and storage
- Agent records success only when a prepared source was actually saved
- Supabase state key: akwam-groq-agent

Important Groq issue:
- Free-tier GPT-OSS 120B hit the observed 8K TPM limit when a tool-heavy prompt was too large.
- Fixed by reducing payload and refactoring Groq to decision-only JSON instead of a full tool-calling loop.

## Akwam parser debugging
Current live Akwam structure was confirmed from GitHub Runner:
- search form: https://akwam.ss/search?q=...
- current search result can contain direct series links such as /series/59/breaking-bad-الموسم-الاول
- Breaking Bad S01 page: https://akwam.ss/series/59/breaking-bad-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85-%D8%A7%D9%84%D8%A7%D9%88%D9%84
- page status 200, about 85KB
- S01 page contains episode links: /episode/607/pilot, /episode/608/cats-in-the-bag, /episode/609/and-the-bags-in-the-river, /episode/610/cancer-man, /episode/611/gray-matter, /episode/612/crazy-handful-of-nothin, /episode/613/a-no-rough-stuff-type-deal-الاخيرة
- episode anchors use class text-white and visible text like: حلقة 1 : مسلسل Breaking Bad الموسم الاول Pilot
- there are 14 episode-path occurrences because duplicate anchors/pictures exist.

Root parser bug discovered:
- the series page contains links to other seasons near the top.
- previous indexEpisodeCandidates() used a wide neighborhood and could parse the wrong season first.
- this caused season mismatch / empty episode index.
- latest fix: parse the episode anchor own text / image alt first; only use neighborhood as fallback.
- provider parser fix commits: 1b62c834361b781c1ff80e94c7effdbe0b194f2c and later 45512fd2aa69d8cd9937ea56060dd74dab9d78b4.
- workflow was updated to trigger when server/providers/arprov-akwam.ts changes.
- workflow search order was updated to prioritize live /search?q with section=series.

## Breaking Bad current verified state
- TMDB 1396
- S01 has 7 episodes
- latest verified source-count check had 0 working Akwam sources for E01-E07.
- Therefore Breaking Bad S01 is NOT yet confirmed prepared.
- Do not repeat the old 7/7 success claim; it was disproven by later Supabase evidence.
- A newer series-page inspection confirmed the actual episode links exist on the S01 page.
- A fresh successful 7/7 Supabase verification is still required after the latest parser fix.

## Workflow behavior
- workflow concurrency: cancel-in-progress=true
- rapid pushes can cancel previous runs
- latest observed runs before this context save included failures from stale hay, missing episode indexing, and Groq oversized prompts; these were subsequently addressed in code.
- GitHub job success alone is not enough; confirm actual Supabase source rows.

## Database historical snapshot
- movies: 338
- series: 110
- seasons: 1240
- episodes: 108,297
- providers: 11
- playback_sources: 349 historical
- working Akwam sources: 297
- valid prepared Akwam sources: 297
- prepared movies: 121
- prepared episodes: 21
- forbidden-source-URL rows: 0
- Reconfirm counts before presenting as current.

## Interstellar reference
- Interstellar was the reference success pattern: prepared final source -> proxy -> native MP4 -> 2:00 warmup -> prepared-source failover.
- These playback mitigations should be shared across movies and episodes.

## Next steps
1. Verify the latest workflow run after the final parser fix.
2. Check Groq/agent output.
3. Query Supabase for Akwam working sources, Breaking Bad S01 E01-E07 source counts, and maintenance_state for akwam-groq-agent and akwam-debug-breaking-bad.
4. If still zero, inspect the current season-page index function against the confirmed live HTML structure.
5. Do not redesign playback; fix discovery/preparation only.
6. Once one episode is truly prepared, validate all 7 and then scale to other series.