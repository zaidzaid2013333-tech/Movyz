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

data class PlaybackCandidate(
    val url: String,
    val quality: Int = 0,
    val format: String = "",
    val headers: Map<String, String> = emptyMap(),
    val subtitles: List<PlaybackSubtitle> = emptyList(),
)

object MovyzaPlaybackRepository {
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(18, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    suspend fun resolve(request: PlaybackRequest): List<PlaybackCandidate> = withContext(Dispatchers.IO) {
        val base = BuildConfig.PLAYBACK_API_BASE.trim().trimEnd('/')
        if (base.isBlank()) throw IOException("Playback API is not configured")

        val isSeries = request.mediaType.equals("series", ignoreCase = true) ||
            request.mediaType.equals("tv", ignoreCase = true)
        val endpoint = buildString {
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

        // Preserve VidLink's quality order, but keep broker sources behind it as
        // real failover candidates. This also lets the player recover when an
        // API URL is returned but the upstream CDN refuses to serve it.
        val vidLinkCandidates = runCatching { resolveFromVidLink(request) }.getOrNull().orEmpty()
        val brokerCandidates = runCatching { fetchCandidates(endpoint) }.getOrNull().orEmpty()
        val candidates = (vidLinkCandidates + brokerCandidates)
            .distinctBy { normalizeUrl(it.url) }
        if (candidates.isNotEmpty()) return@withContext candidates

        throw IOException("VidLink and playback broker returned no playable source")
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
                request.episode.coerceAtLeast(1) + "?multiLang=0"
        } else {
            "https://vidlink.pro/api/b/movie/$encodedId?multiLang=0"
        }

        client.newCall(
            Request.Builder()
                .url(endpoint)
                .header("Accept", "application/json")
                .header("Referer", "https://vidlink.pro/")
                .header("Origin", "https://vidlink.pro")
                .header("User-Agent", VIDLINK_USER_AGENT)
                .build()
        ).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("VidLink API " + response.code)

            val root = runCatching { JSONObject(body) }.getOrElse {
                throw IOException("VidLink API returned invalid JSON")
            }
            val stream = root.optJSONObject("stream")
                ?: throw IOException("VidLink returned no stream object")
            val qualities = stream.optJSONObject("qualities")
            val candidates = mutableListOf<PlaybackCandidate>()
            if (qualities != null) {
                val keys = qualities.keys()
                while (keys.hasNext()) {
                    val qualityKey = keys.next()
                    val entry = qualities.optJSONObject(qualityKey) ?: continue
                    val rawUrl = entry.optString("url").trim()
                    if (rawUrl.isBlank()) continue

                    // Some VidLink URLs have no extension and identify their
                    // container only through the API's type field.
                    val declaredFormat = entry.optString("type")
                    val (url, embeddedHeaders) = extractEmbeddedHeaders(rawUrl)
                    if (!isPlayableOrDeclaredFormat(url, declaredFormat)) continue

                    candidates += PlaybackCandidate(
                        url = url,
                        quality = parseQuality(qualityKey) ?: 0,
                        format = declaredFormat.ifBlank {
                            if (url.substringBefore("?").endsWith(".mp4", true)) "video/mp4"
                            else "application/x-mpegURL"
                        },
                        headers = mapOf(
                            "Referer" to "https://vidlink.pro/",
                            "Origin" to "https://vidlink.pro",
                            "User-Agent" to VIDLINK_USER_AGENT
                        ) + embeddedHeaders,
                        subtitles = collectSubtitleTracks(entry).ifEmpty {
                            collectSubtitleTracks(stream)
                        }
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
                        headers = mapOf(
                            "Referer" to "https://vidlink.pro/",
                            "Origin" to "https://vidlink.pro",
                            "User-Agent" to VIDLINK_USER_AGENT
                        ) + embeddedHeaders,
                        subtitles = collectSubtitleTracks(stream)
                    )
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
    ) {
        when (node) {
            is JSONObject -> {
                val quality = parseQuality(node.opt("quality"))
                    ?: parseQuality(node.opt("resolution"))
                    ?: node.optInt("height", 0).takeIf { it > 0 }
                    ?: inheritedQuality

                val headers = inheritedHeaders + parseHeaders(node.opt("headers"))
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
                        format = firstString(node, "format", "mime", "mime_type", "type").orEmpty(),
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
                        quality,
                        headers,
                        subtitles,
                        out
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
                        out
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
        if (value !is JSONObject) return emptyMap()
        val result = linkedMapOf<String, String>()
        val keys = value.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val valueText = value.optString(key)
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

            val parsed = runCatching { JSONObject(encodedHeaders) }
                .getOrElse { JSONObject() }
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
