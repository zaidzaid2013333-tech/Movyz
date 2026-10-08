package com.movyza.app.player

import com.movyza.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
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

        val endpoint = buildString {
            append(base)
            append("/api/v1/playback/resolve?tmdb_id=")
            append(request.tmdbId)
            append("&media_type=")
            append(request.mediaType)
            if (request.mediaType == "series") {
                append("&season=")
                append(request.season.coerceAtLeast(1))
                append("&episode=")
                append(request.episode.coerceAtLeast(1))
            }
        }

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

            val unique = candidates
                .filter { isPlayable(it.url) }
                .distinctBy { normalizeUrl(it.url) }
                .sortedWith(compareBy<PlaybackCandidate> { qualityRank(it.quality) }.thenBy { it.url.length })

            if (unique.isEmpty()) throw IOException("No direct playback source was returned")
            unique
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

    private fun isPlayable(url: String): Boolean {
        val lower = url.lowercase()
        if (!isHttpUrl(url)) return false
        if (lower.contains("/embed/") || lower.contains("iframe") || lower.contains("player.movyza")) return false
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return false
        return lower.contains(".mp4") ||
            lower.contains(".webm") ||
            lower.contains(".m3u8") ||
            lower.contains(".mpd") ||
            lower.contains(".mkv") ||
            lower.contains(".mov") ||
            lower.contains(".ts") ||
            lower.contains("manifest")
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
