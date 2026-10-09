package com.movyza.app.player

import com.movyza.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs

data class PlaybackRequest(
    val tmdbId: Int,
    val mediaType: String,
    val season: Int = 0,
    val episode: Int = 0,
)

data class PlaybackSubtitle(
    val url: String,
    val language: String = "",
    val label: String = "",
    val mimeType: String = "",
    val isDefault: Boolean = false,
    val isForced: Boolean = false,
)

enum class PlaybackProvider { VIDLINK, BROKER, DIRECT }

data class PlaybackCandidate(
    val url: String,
    val quality: Int = 0,
    val format: String = "",
    val headers: Map<String, String> = emptyMap(),
    val subtitles: List<PlaybackSubtitle> = emptyList(),
    val provider: PlaybackProvider = PlaybackProvider.BROKER,
)

object MovyzaPlaybackRepository {
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(18, TimeUnit.SECONDS)
        .callTimeout(22, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun resolve(request: PlaybackRequest): List<PlaybackCandidate> = withContext(Dispatchers.IO) {
        if (request.tmdbId <= 0) throw IOException("A valid TMDB ID is required")

        val vidLinkResult = runCatching { resolveFromVidLink(request) }
        val vidLinkCandidates = vidLinkResult.getOrNull().orEmpty()
        // Start playback as soon as VidLink resolves. Do not make the user wait
        // for a second provider's timeout before opening a valid first source.
        if (vidLinkCandidates.isNotEmpty()) return@withContext vidLinkCandidates

        val brokerResult = runCatching { fetchCandidates(buildBrokerEndpoint(request)) }
        val brokerCandidates = brokerResult.getOrNull().orEmpty()
        if (brokerCandidates.isNotEmpty()) return@withContext brokerCandidates

        val vidLinkReason = vidLinkResult.exceptionOrNull()?.message ?: "no playable stream returned"
        val brokerReason = brokerResult.exceptionOrNull()?.message ?: "no playable stream returned"
        throw IOException("VidLink: $vidLinkReason. Playback broker: $brokerReason")
    }

    suspend fun resolveBrokerFallback(
        request: PlaybackRequest,
        excludedUrls: Set<String> = emptySet(),
    ): List<PlaybackCandidate> = withContext(Dispatchers.IO) {
        val excluded = excludedUrls.map(::normalizeUrl).toSet()
        val candidates = fetchCandidates(buildBrokerEndpoint(request))
            .filterNot { normalizeUrl(it.url) in excluded }
        if (candidates.isEmpty()) throw IOException("Playback broker returned no additional playable sources")
        candidates
    }

    private fun buildBrokerEndpoint(request: PlaybackRequest): String {
        val base = BuildConfig.PLAYBACK_API_BASE.trim().trimEnd('/')
        if (base.isBlank()) throw IOException("Playback API is not configured")

        val isSeries = request.mediaType.equals("series", ignoreCase = true) ||
            request.mediaType.equals("tv", ignoreCase = true)
        return buildString {
            append(base)
            append("/api/v1/playback/resolve?tmdb_id=")
            append(request.tmdbId)
            append("&media_type=")
            append(if (isSeries) "series" else "movie")
            if (isSeries) {
                append("&season=")
                append(request.season.coerceAtLeast(1))
                append("&episode=")
                append(request.episode.coerceAtLeast(1))
            }
        }
    }

    private fun fetchCandidates(endpoint: String): List<PlaybackCandidate> {
        client.newCall(
            Request.Builder()
                .url(endpoint)
                .header("Accept", "application/json")
                .header("X-Movyza-Client", "native-android")
                .build()
        ).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("Playback resolver " + response.code)

            val root = runCatching { JSONObject(body) }.getOrElse {
                throw IOException("Playback resolver returned invalid JSON")
            }

            val candidates = mutableListOf<PlaybackCandidate>()
            collectCandidates(root, 0, emptyMap(), emptyList(), candidates)

            return candidates
                .map { candidate ->
                    val (cleanUrl, embeddedHeaders) = extractEmbeddedHeaders(candidate.url)
                    candidate.copy(
                        url = cleanUrl,
                        headers = mergeHeaders(candidate.headers, embeddedHeaders),
                        provider = PlaybackProvider.BROKER,
                    )
                }
                .filter { isPlayableOrDeclaredFormat(it.url, it.format) }
                .distinctBy { normalizeUrl(it.url) }
                .sortedWith(compareBy<PlaybackCandidate> { qualityRank(it.quality) }.thenBy { it.url.length })
        }
    }

    private fun resolveFromVidLink(request: PlaybackRequest): List<PlaybackCandidate> {
        val encodedRequest = "https://enc-dec.app/api/enc-vidlink?text=" +
            URLEncoder.encode(request.tmdbId.toString(), "UTF-8")

        val encodedId = client.newCall(
            Request.Builder()
                .url(encodedRequest)
                .header("Accept", "application/json")
                .header("User-Agent", VIDLINK_USER_AGENT)
                .build()
        ).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("VidLink encode " + response.code)
            runCatching { JSONObject(body).optString("result") }
                .getOrElse { throw IOException("VidLink encode returned invalid JSON") }
                .trim()
        }

        if (encodedId.isBlank()) throw IOException("VidLink encode returned no ID")

        val isSeries = request.mediaType.equals("series", ignoreCase = true) ||
            request.mediaType.equals("tv", ignoreCase = true)
        val endpoint = if (isSeries) {
            "https://vidlink.pro/api/b/tv/$encodedId/" +
                request.season.coerceAtLeast(1) + "/" +
                request.episode.coerceAtLeast(1)
        } else {
            "https://vidlink.pro/api/b/movie/$encodedId"
        }

        client.newCall(
            Request.Builder()
                .url(endpoint)
                .header("Accept", "application/json, application/vnd.apple.mpegurl, application/dash+xml;q=0.9, */*;q=0.8")
                .header("Referer", "https://vidlink.pro/")
                .header("Origin", "https://vidlink.pro")
                .header("User-Agent", VIDLINK_USER_AGENT)
                .build()
        ).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("VidLink API " + response.code)

            val responseUrl = response.request.url.toString()
            val contentType = response.header("Content-Type").orEmpty().lowercase(Locale.US)
            val bodyStart = body.removePrefix("\uFEFF").trimStart()
            val requestHeaders = mapOf(
                "Referer" to "https://vidlink.pro/",
                "Origin" to "https://vidlink.pro",
                "User-Agent" to VIDLINK_USER_AGENT
            )

            // VidLink's public API has been observed to return the HLS playlist
            // itself for some IDs, rather than the JSON shape below. Treat it as
            // a Media3 manifest, not as JSON or an iframe.
            if (contentType.contains("mpegurl") || bodyStart.startsWith("#EXTM3U")) {
                return listOf(
                    PlaybackCandidate(
                        url = responseUrl,
                        quality = 0,
                        format = "application/x-mpegURL",
                        headers = requestHeaders,
                        provider = PlaybackProvider.VIDLINK,
                    )
                )
            }
            if (contentType.contains("dash+xml") ||
                (contentType.contains("xml") && bodyStart.contains("<MPD", ignoreCase = true))
            ) {
                return listOf(
                    PlaybackCandidate(
                        url = responseUrl,
                        quality = 0,
                        format = "application/dash+xml",
                        headers = requestHeaders,
                        provider = PlaybackProvider.VIDLINK,
                    )
                )
            }

            // Some deployments return a direct media URL as plain text.
            val plainUrl = bodyStart.lineSequence().firstOrNull()?.trim().orEmpty()
            if (isHttpUrl(plainUrl) && plainUrl == bodyStart.trim()) {
                val (cleanUrl, embeddedHeaders) = extractEmbeddedHeaders(plainUrl)
                val inferredFormat = inferFormatFromUrl(cleanUrl)
                if (isPlayableOrDeclaredFormat(cleanUrl, inferredFormat)) {
                    return listOf(
                        PlaybackCandidate(
                            url = cleanUrl,
                            format = inferredFormat,
                            headers = mergeHeaders(requestHeaders, embeddedHeaders),
                            provider = PlaybackProvider.VIDLINK,
                        )
                    )
                }
            }

            val root = runCatching { JSONObject(body) }.getOrElse {
                throw IOException(
                    "VidLink API returned neither JSON nor a recognized media manifest " +
                        "(content-type: ${contentType.ifBlank { "unknown" }})"
                )
            }
            val stream = root.optJSONObject("stream")
                ?: root.optJSONObject("data")?.optJSONObject("stream")
                ?: root.optJSONObject("result")?.optJSONObject("stream")
                ?: root.optJSONObject("data")
                ?: root.optJSONObject("result")
                ?: root
            val qualities = stream.optJSONObject("qualities")
            val candidates = mutableListOf<PlaybackCandidate>()
            if (qualities != null) {
                val keys = qualities.keys()
                while (keys.hasNext()) {
                    val qualityKey = keys.next()
                    val rawEntry = qualities.opt(qualityKey)
                    val entry = rawEntry as? JSONObject
                    val rawUrl = entry?.optString("url")?.trim()
                        ?.takeIf { it.isNotBlank() }
                        ?: (rawEntry as? String).orEmpty().trim()
                    if (rawUrl.isBlank()) continue

                    // Some VidLink URLs have no extension and identify their
                    // container only through the API's type field.
                    val declaredFormat = entry?.optString("type").orEmpty()
                        .ifBlank {
                            firstString(stream, "type", "format", "mime", "mime_type").orEmpty()
                        }
                    val (url, embeddedHeaders) = extractEmbeddedHeaders(rawUrl)
                    if (!isPlayableOrDeclaredFormat(url, declaredFormat)) continue

                    candidates += PlaybackCandidate(
                        url = url,
                        quality = parseQuality(qualityKey) ?: 0,
                        // Never guess that an extensionless URL is HLS. Use
                        // only the API-declared type or an identifiable path suffix.
                        format = declaredFormat.ifBlank { inferFormatFromUrl(url) },
                        headers = mergeHeaders(
                            requestHeaders,
                            entry?.let { parseHeaders(it.opt("headers")) } ?: emptyMap(),
                            embeddedHeaders
                        ),
                        subtitles = entry?.let { collectSubtitleTracks(it) }.orEmpty().ifEmpty {
                            collectSubtitleTracks(stream)
                        },
                        provider = PlaybackProvider.VIDLINK,
                    )
                }
            }

            // Some responses expose only one master HLS playlist instead of a
            // qualities object. Use it as an explicit HLS Media3 source.
            val rawPlaylist = stream.optString("playlist").trim()
            if (rawPlaylist.isNotBlank() && isHttpUrl(rawPlaylist)) {
                val (playlist, embeddedHeaders) = extractEmbeddedHeaders(rawPlaylist)
                if (isHttpUrl(playlist) &&
                    !playlist.contains("/embed/", ignoreCase = true) &&
                    !playlist.contains("iframe", ignoreCase = true) &&
                    !playlist.contains("player.movyza", ignoreCase = true)
                ) {
                    candidates += PlaybackCandidate(
                        url = playlist,
                        quality = 0,
                        format = "application/x-mpegURL",
                        headers = mergeHeaders(
                            mapOf(
                                "Referer" to "https://vidlink.pro/",
                                "Origin" to "https://vidlink.pro",
                                "User-Agent" to VIDLINK_USER_AGENT
                            ),
                            embeddedHeaders
                        ),
                        subtitles = collectSubtitleTracks(stream),
                        provider = PlaybackProvider.VIDLINK,
                    )
                }
            }

            // Tolerate alternate JSON layouts (e.g. root.url or data.sources)
            // instead of hard-failing when VidLink changes its response wrapper.
            if (candidates.isEmpty()) {
                val genericCandidates = mutableListOf<PlaybackCandidate>()
                collectCandidates(root, 0, emptyMap(), emptyList(), genericCandidates)
                genericCandidates.forEach { candidate ->
                    val (cleanUrl, embeddedHeaders) = extractEmbeddedHeaders(candidate.url)
                    val inferredFormat = candidate.format.ifBlank { inferFormatFromUrl(cleanUrl) }
                    if (isPlayableOrDeclaredFormat(cleanUrl, inferredFormat)) {
                        candidates += candidate.copy(
                            url = cleanUrl,
                            format = inferredFormat,
                            headers = mergeHeaders(requestHeaders, candidate.headers, embeddedHeaders),
                            subtitles = candidate.subtitles.ifEmpty { collectSubtitleTracks(stream) },
                            provider = PlaybackProvider.VIDLINK,
                        )
                    }
                }
            }

            if (candidates.isEmpty()) throw IOException("VidLink returned no playable stream URL")
            return candidates
                .distinctBy { normalizeUrl(it.url) }
                .sortedWith(compareBy<PlaybackCandidate> { qualityRank(it.quality) }.thenBy { it.url.length })
        }
    }

    private fun collectCandidates(
        node: Any?,
        inheritedQuality: Int,
        inheritedHeaders: Map<String, String>,
        inheritedSubtitles: List<PlaybackSubtitle>,
        out: MutableList<PlaybackCandidate>,
        inheritedFormat: String = "",
    ) {
        when (node) {
            is JSONObject -> {
                val quality = parseQuality(node.opt("quality"))
                    ?: parseQuality(node.opt("resolution"))
                    ?: node.optInt("height", 0).takeIf { it > 0 }
                    ?: inheritedQuality

                val headers = mergeHeaders(inheritedHeaders, parseHeaders(node.opt("headers")))
                val localFormat = firstString(node, "format", "mime", "mime_type", "type")
                    .orEmpty()
                    .ifBlank { inheritedFormat }
                val localSubtitles = collectSubtitleTracks(node)
                val subtitles = if (localSubtitles.isNotEmpty()) localSubtitles else inheritedSubtitles

                val url = firstString(
                    node,
                    "url", "stream_url", "streamUrl",
                    "playback_url", "playbackUrl",
                    "source_url", "sourceUrl",
                    "file", "src"
                )

                if (!url.isNullOrBlank()) {
                    out += PlaybackCandidate(
                        url = url.trim(),
                        quality = quality,
                        format = localFormat,
                        headers = headers,
                        subtitles = subtitles
                    )
                }

                val keys = node.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    if (key in SKIPPED_MEDIA_KEYS) continue
                    collectCandidates(
                        node.opt(key),
                        parseQuality(key) ?: quality,
                        headers,
                        subtitles,
                        out,
                        localFormat,
                    )
                }
            }

            is JSONArray -> {
                for (index in 0 until node.length()) {
                    collectCandidates(
                        node.opt(index),
                        inheritedQuality,
                        inheritedHeaders,
                        inheritedSubtitles,
                        out,
                        inheritedFormat,
                    )
                }
            }
        }
    }

    private fun collectSubtitleTracks(node: JSONObject): List<PlaybackSubtitle> {
        val result = mutableListOf<PlaybackSubtitle>()

        SUBTITLE_KEYS.forEach { key ->
            collectSubtitleNodes(
                node.opt(key),
                inheritedLanguage = "",
                inheritedLabel = "",
                out = result
            )
        }

        val directUrl = firstString(
            node,
            "subtitle_url", "subtitleUrl",
            "sub_file", "subFile"
        )
        if (!directUrl.isNullOrBlank()) {
            result += PlaybackSubtitle(
                url = directUrl.trim(),
                language = firstString(node, "subtitle_language", "subtitleLanguage", "sub_lang").orEmpty(),
                label = firstString(node, "subtitle_label", "subtitleLabel", "sub_label").orEmpty(),
                mimeType = firstString(node, "subtitle_mime", "subtitleMime").orEmpty(),
            )
        }

        return result
            .filter { isHttpUrl(it.url) }
            .distinctBy { normalizeUrl(it.url) + "|" + it.language + "|" + it.label }
    }

    private fun collectSubtitleNodes(
        value: Any?,
        inheritedLanguage: String,
        inheritedLabel: String,
        out: MutableList<PlaybackSubtitle>,
    ) {
        when (value) {
            is String -> {
                if (isHttpUrl(value)) {
                    out += PlaybackSubtitle(
                        url = value.trim(),
                        language = inheritedLanguage,
                        label = inheritedLabel
                    )
                }
            }

            is JSONArray -> {
                for (index in 0 until value.length()) {
                    collectSubtitleNodes(
                        value.opt(index),
                        inheritedLanguage,
                        inheritedLabel,
                        out
                    )
                }
            }

            is JSONObject -> {
                val language = firstString(
                    value,
                    "language", "lang", "locale", "srclang", "track_language"
                ).orEmpty().ifBlank { inheritedLanguage }

                val label = firstString(
                    value,
                    "label", "name", "title"
                ).orEmpty().ifBlank { inheritedLabel }

                val url = firstString(
                    value,
                    "url", "file", "src", "subtitle_url", "subtitleUrl",
                    "sub_file", "subFile"
                )

                if (!url.isNullOrBlank() && isHttpUrl(url)) {
                    out += PlaybackSubtitle(
                        url = url.trim(),
                        language = language,
                        label = label,
                        mimeType = firstString(
                            value,
                            "mime", "mime_type", "mimeType", "content_type", "format"
                        ).orEmpty(),
                        isDefault = value.optBoolean("default", false)
                            || value.optBoolean("is_default", false),
                        isForced = value.optBoolean("forced", false)
                            || value.optBoolean("is_forced", false),
                    )
                }

                val keys = value.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    if (key in SUBTITLE_NODE_KEYS) continue
                    val childLanguage =
                        if (language.isNotBlank()) language
                        else key.takeIf(::looksLikeLanguageCode).orEmpty()
                    collectSubtitleNodes(
                        value.opt(key),
                        childLanguage,
                        label,
                        out
                    )
                }
            }
        }
    }

    private fun firstString(obj: JSONObject, vararg keys: String): String? {
        for (key in keys) {
            val value = obj.opt(key)
            if (value is String && value.isNotBlank()) return value
        }
        return null
    }

    private fun parseHeaders(value: Any?): Map<String, String> {
        val parsed = when (value) {
            is JSONObject -> value
            is String -> runCatching { JSONObject(value) }.getOrNull() ?: return emptyMap()
            else -> return emptyMap()
        }
        val result = linkedMapOf<String, String>()
        val keys = parsed.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val valueText = parsed.optString(key)
            if (valueText.isNotBlank()) result[key] = valueText
        }
        return result
    }

    private fun parseQuality(value: Any?): Int? {
        when (value) {
            is Number -> return value.toInt().takeIf { it > 0 }
            is String -> {
                if (value.equals("4k", ignoreCase = true)) return 2160
                Regex("(2160|1440|1080|720|576|480|360|240)")
                    .find(value)
                    ?.groupValues
                    ?.getOrNull(1)
                    ?.toIntOrNull()
                    ?.let { return it }
            }
        }
        return null
    }

    private fun extractEmbeddedHeaders(rawUrl: String): Pair<String, Map<String, String>> {
        return runCatching<Pair<String, Map<String, String>>> {
            val uri = android.net.Uri.parse(rawUrl)
            val encodedHeaders = uri.getQueryParameter("headers")
            if (encodedHeaders.isNullOrBlank()) return@runCatching rawUrl to emptyMap()

            // Do not strip a source's header payload unless it was parsed.
            // On malformed/double-encoded JSON the raw URL may still be usable
            // by the upstream player, while silently deleting it breaks auth.
            val parsedResult = runCatching { JSONObject(encodedHeaders) }
            if (parsedResult.isFailure) return@runCatching rawUrl to emptyMap()
            val parsed = parsedResult.getOrThrow()
            val headers = linkedMapOf<String, String>()
            val keys = parsed.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = parsed.optString(key).trim()
                if (key.isNotBlank() && value.isNotBlank()) headers[key] = value
            }
            val cleanUrl = uri.buildUpon().clearQuery().apply {
                uri.queryParameterNames
                    .filterNot { it.equals("headers", ignoreCase = true) }
                    .forEach { name ->
                        uri.getQueryParameters(name).forEach { value -> appendQueryParameter(name, value) }
                    }
            }.build().toString()
            cleanUrl to headers
        }.getOrElse { rawUrl to emptyMap() }
    }

    private fun mergeHeaders(vararg sources: Map<String, String>): Map<String, String> {
        val merged = linkedMapOf<String, String>()
        sources.forEach { source ->
            source.forEach { (key, value) ->
                if (key.isBlank() || value.isBlank()) return@forEach
                val oldKey = merged.keys.firstOrNull { it.equals(key, ignoreCase = true) }
                if (oldKey != null) merged.remove(oldKey)
                merged[key] = value
            }
        }
        return merged
    }

    private fun inferFormatFromUrl(url: String): String {
        val path = url.lowercase(Locale.US).substringBefore("?").substringBefore("#")
        return when {
            path.endsWith(".m3u8") -> "application/x-mpegURL"
            path.endsWith(".mpd") -> "application/dash+xml"
            path.endsWith(".mp4") || path.endsWith(".m4v") -> "video/mp4"
            path.endsWith(".webm") -> "video/webm"
            path.endsWith(".ts") -> "video/mp2t"
            else -> ""
        }
    }

    private fun isPlayable(url: String): Boolean {
        val lower = url.lowercase()
        val path = lower.substringBefore("?").substringBefore("#")
        if (!isHttpUrl(url)) return false
        if (lower.contains("/embed/") || lower.contains("iframe") || lower.contains("player.movyza")) return false
        if (path.endsWith(".html") || path.endsWith(".htm")) return false
        return path.contains(".mp4") ||
            path.contains(".webm") ||
            path.contains(".m3u8") ||
            path.contains(".mpd") ||
            path.contains(".mkv") ||
            path.contains(".mov") ||
            path.contains(".ts") ||
            lower.contains("manifest")
    }

    private fun isPlayableOrDeclaredFormat(url: String, format: String): Boolean {
        if (isPlayable(url)) return true
        if (!isHttpUrl(url)) return false
        val lowerUrl = url.lowercase()
        val path = lowerUrl.substringBefore("?").substringBefore("#")
        if (lowerUrl.contains("/embed/") || lowerUrl.contains("iframe") ||
            lowerUrl.contains("player.movyza") || path.endsWith(".html") || path.endsWith(".htm")
        ) return false
        val type = format.trim().lowercase()
        return type.contains("mp4") ||
            type.contains("webm") ||
            type.contains("m3u8") ||
            type.contains("mpegurl") ||
            type.contains("hls") ||
            type.contains("mpd") ||
            type.contains("dash") ||
            type.contains("mp2t") ||
            type.contains("video/")
    }

    private fun isHttpUrl(url: String): Boolean {
        val lower = url.lowercase()
        return lower.startsWith("http://") || lower.startsWith("https://")
    }

    private fun normalizeUrl(url: String): String = url.substringBefore("#").trim()

    private fun qualityRank(quality: Int): Int {
        if (quality <= 0) return 100
        val preferred = listOf(720, 1080, 576, 480, 360, 1440, 2160)
        val index = preferred.indexOf(quality)
        return if (index >= 0) index else 30 + abs(quality - 720)
    }

    private fun looksLikeLanguageCode(value: String): Boolean =
        value.length in 2..5 && value.all { it.isLetter() || it == '-' || it == '_' }

    private const val VIDLINK_USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"

    private val SUBTITLE_KEYS = setOf(
        "subtitles", "subtitle_tracks", "subtitleTracks",
        "captions", "caption_tracks", "captionTracks",
        "text_tracks", "textTracks", "subtitle"
    )

    private val SUBTITLE_NODE_KEYS = setOf(
        "url", "file", "src",
        "subtitle_url", "subtitleUrl",
        "sub_file", "subFile",
        "language", "lang", "locale", "srclang", "track_language",
        "label", "name", "title",
        "mime", "mime_type", "mimeType", "content_type", "format",
        "default", "is_default", "forced", "is_forced"
    )

    private val SKIPPED_MEDIA_KEYS = SUBTITLE_KEYS + setOf(
        "subtitle_url", "subtitleUrl",
        "sub_file", "subFile"
    )
}
