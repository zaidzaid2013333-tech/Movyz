package com.movyza.app.player

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.outlined.AspectRatio
import androidx.compose.material.icons.outlined.HighQuality
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import com.movyza.app.MainViewModel
import com.movyza.app.MovyzaColors
import com.movyza.app.MovyzaShapes
import com.movyza.app.MovyzaTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs

private enum class TrackDialog { SUBTITLES, AUDIO }
private enum class SubtitleVisualStyle { CLASSIC, GOLD, HIGH_CONTRAST }

private data class TrackOption(
    val type: Int,
    val group: Tracks.Group,
    val index: Int,
    val label: String,
    val languageTag: String
)

@UnstableApi
class MovyzaPlayerActivity : ComponentActivity() {

    companion object {
        const val EXTRA_TMDB_ID = "movyza_tmdb_id"
        const val EXTRA_MEDIA_TYPE = "movyza_media_type"
        const val EXTRA_SEASON = "movyza_season"
        const val EXTRA_EPISODE = "movyza_episode"
        const val EXTRA_SOURCE_URL = "movyza_source_url"
        const val EXTRA_TITLE = "movyza_title"
    }

    private lateinit var player: ExoPlayer
    private lateinit var trackSelector: DefaultTrackSelector
    private var sources: List<PlaybackCandidate> = emptyList()
    private var sourceIndex = 0
    private val failedSourceUrls = linkedSetOf<String>()
    private var playbackRequestGeneration = 0
    private var sourcePreparationGeneration = 0
    private var brokerFallbackAttempted = false
    private var handlingPlaybackError = false
    private var firstReady = true
    private var defaultQualityApplied = false
    private var progressJob: Job? = null
    private var startupWatchdogJob: Job? = null
    private var lastPositionSave = 0L

    private var activeSeason by mutableIntStateOf(1)
    private var activeEpisode by mutableIntStateOf(1)
    private var displayTitle by mutableStateOf("MOVYZA")

    private var position by mutableLongStateOf(0L)
    private var duration by mutableLongStateOf(0L)
    private var buffered by mutableLongStateOf(0L)
    private var playing by mutableStateOf(false)
    private var buffering by mutableStateOf(true)
    private var error by mutableStateOf<String?>(null)
    private var qualities by mutableStateOf<List<Int>>(emptyList())
    private var selectedQualityHeight by mutableIntStateOf(720)
    private var subtitleTracks by mutableStateOf<List<TrackOption>>(emptyList())
    private var audioTracks by mutableStateOf<List<TrackOption>>(emptyList())
    private var defaultSubtitleApplied = false
    private val subtitleClient = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .callTimeout(6, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    private val playerPrefs by lazy {
        getSharedPreferences("movyza_player_preferences", MODE_PRIVATE)
    }
    private var autoplayNext by mutableStateOf(true)
    private var playbackSpeed by mutableFloatStateOf(1f)
    private var subtitleVisualStyle by mutableStateOf(SubtitleVisualStyle.CLASSIC)
    private var preferredQualityHeight by mutableIntStateOf(720)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        activeSeason = intent.getIntExtra(EXTRA_SEASON, 1).coerceAtLeast(1)
        activeEpisode = intent.getIntExtra(EXTRA_EPISODE, 1).coerceAtLeast(1)
        displayTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "MOVYZA" }
        val requestedMediaType = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty()
        val isSeries = requestedMediaType.equals("series", ignoreCase = true) ||
            requestedMediaType.equals("tv", ignoreCase = true)

        autoplayNext = playerPrefs.getBoolean("autoplay_next", true)
        playbackSpeed = playerPrefs.getFloat("playback_speed", 1f).coerceIn(0.5f, 2f)
        preferredQualityHeight = playerPrefs.getInt("preferred_quality", 720).coerceAtLeast(144)
        subtitleVisualStyle = runCatching {
            SubtitleVisualStyle.valueOf(
                playerPrefs.getString("subtitle_style", SubtitleVisualStyle.CLASSIC.name)
                    ?: SubtitleVisualStyle.CLASSIC.name
            )
        }.getOrDefault(SubtitleVisualStyle.CLASSIC)

        val deviceLanguage = Locale.getDefault().language.takeIf { it.isNotBlank() } ?: "en"
        trackSelector = DefaultTrackSelector(this).apply {
            setParameters(
                buildUponParameters()
                    .setMaxVideoSize(3840, 2160)
                    .setPreferredAudioLanguage(deviceLanguage)
                    .setPreferredTextLanguage(deviceLanguage)
                    .build()
            )
        }

        player = ExoPlayer.Builder(this)
            .setTrackSelector(trackSelector)
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(15_000, 50_000, 1_500, 3_000)
                    .build()
            )
            .build()

        player.setPlaybackSpeed(playbackSpeed)
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                buffering = state == Player.STATE_BUFFERING
                duration = player.duration.coerceAtLeast(0L)
                when (state) {
                    Player.STATE_READY -> {
                        buffering = false
                        handlingPlaybackError = false
                        if (firstReady) {
                            firstReady = false
                            restoreSavedProgress()
                        }
                        refreshTracks()
                    }
                    Player.STATE_ENDED -> {
                        saveProgress(true)
                        if (isSeries && autoplayNext) playNextEpisode()
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
                if (isPlaying) {
                    sources.getOrNull(sourceIndex)?.url?.let { failedSourceUrls.remove(sourceKey(it)) }
                    startupWatchdogJob?.cancel()
                    startupWatchdogJob = null
                }
            }

            override fun onTracksChanged(tracks: Tracks) {
                refreshTracks()
            }

            override fun onPlayerError(playerError: PlaybackException) {
                // ExoPlayer can emit more than one callback for a failing
                // timeline. Serialize recovery so two coroutines cannot advance
                // sourceIndex twice or launch duplicate broker fallbacks.
                startupWatchdogJob?.cancel()
                startupWatchdogJob = null
                if (handlingPlaybackError) return
                handlingPlaybackError = true
                val failedGeneration = sourcePreparationGeneration
                lifecycleScope.launch { handlePlaybackError(playerError, failedGeneration) }
            }
        })

        setContent {
            MovyzaTheme {
                MovyzaPlayerScreen(
                    title = displayTitle,
                    isSeries = isSeries,
                    player = player,
                    position = position,
                    duration = duration,
                    buffered = buffered,
                    playing = playing,
                    buffering = buffering,
                    error = error,
                    qualities = qualities,
                    selectedQualityHeight = selectedQualityHeight,
                    subtitleTracks = subtitleTracks,
                    audioTracks = audioTracks,
                    playbackSpeed = playbackSpeed,
                    autoplayNext = autoplayNext,
                    subtitleVisualStyle = subtitleVisualStyle,
                    onClose = { finish() },
                    onSeek = { player.seekTo(it.coerceIn(0L, duration)) },
                    onTogglePlay = { if (player.isPlaying) player.pause() else player.play() },
                    onSkip = { delta -> player.seekTo((player.currentPosition + delta).coerceIn(0L, duration)) },
                    onNextEpisode = {
                        if (isSeries) playNextEpisode()
                    },
                    onQuality = { selectQuality(it) },
                    onSpeed = { speed ->
                        playbackSpeed = speed.coerceIn(0.5f, 2f)
                        playerPrefs.edit().putFloat("playback_speed", playbackSpeed).apply()
                        player.setPlaybackSpeed(playbackSpeed)
                    },
                    onAutoplayNext = { enabled ->
                        autoplayNext = enabled
                        playerPrefs.edit().putBoolean("autoplay_next", enabled).apply()
                    },
                    onSubtitleStyle = { style ->
                        subtitleVisualStyle = style
                        playerPrefs.edit().putString("subtitle_style", style.name).apply()
                    },
                    onSelectSubtitle = { selectTextTrack(it) },
                    onSelectPreferredSubtitle = { selectPreferredTextTrack() },
                    onSelectAudio = { selectAudioTrack(it) },
                    onRetry = {
                        lifecycleScope.launch { resolveAndStart() }
                    }
                )
            }
        }

        lifecycleScope.launch { resolveAndStart() }

        progressJob = lifecycleScope.launch {
            while (isActive) {
                delay(750)
                if (player.isPlaying || buffering) {
                    position = player.currentPosition.coerceAtLeast(0L)
                    duration = player.duration.coerceAtLeast(0L)
                    buffered = player.bufferedPosition.coerceAtLeast(0L)
                    if (abs(player.currentPosition - lastPositionSave) >= 5_000L) {
                        saveProgress(false)
                    }
                }
            }
        }
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        }
    }

    private fun sourceKey(url: String): String = url.trim().substringBefore("#")

    private fun currentPlaybackRequest(): PlaybackRequest = PlaybackRequest(
        tmdbId = intent.getIntExtra(EXTRA_TMDB_ID, 0),
        mediaType = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty().ifBlank { "movie" },
        season = activeSeason,
        episode = activeEpisode
    )

    private suspend fun resolveAndStart() {
        val requestGeneration = ++playbackRequestGeneration
        // Invalidate in-flight preparation/recovery and clear the old timeline
        // before resolving again; a late error from the previous item must not
        // consume a source belonging to the new request.
        sourcePreparationGeneration++
        startupWatchdogJob?.cancel()
        startupWatchdogJob = null
        handlingPlaybackError = true
        player.stop()
        player.clearMediaItems()
        sources = emptyList()
        sourceIndex = 0
        qualities = emptyList()
        subtitleTracks = emptyList()
        audioTracks = emptyList()
        error = null
        buffering = true
        brokerFallbackAttempted = false
        val directUrl = intent.getStringExtra(EXTRA_SOURCE_URL)?.trim().orEmpty()
        val resolvedSources = if (directUrl.isNotBlank()) {
            listOf(PlaybackCandidate(directUrl, provider = PlaybackProvider.DIRECT))
        } else {
            try {
                MovyzaPlaybackRepository.resolve(currentPlaybackRequest())
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                if (requestGeneration != playbackRequestGeneration) return
                buffering = false
                error = failure.message ?: "لم نتمكن من تجهيز مصدر البث المباشر."
                emptyList()
            }
        }

        // A retry/new episode may have resolved while this request was in flight.
        if (requestGeneration != playbackRequestGeneration) return
        sources = resolvedSources
        failedSourceUrls.clear()
        if (sources.isEmpty()) return

        sourceIndex = 0
        firstReady = true
        defaultQualityApplied = false
        defaultSubtitleApplied = false
        qualities = emptyList()
        subtitleTracks = emptyList()
        audioTracks = emptyList()
        prepareSource(sources.first())
    }

    private suspend fun handlePlaybackError(
        playerError: PlaybackException?,
        expectedPreparationGeneration: Int,
        fallbackErrorCode: String = "STARTUP_TIMEOUT",
    ) {
        startupWatchdogJob?.cancel()
        startupWatchdogJob = null
        if (expectedPreparationGeneration != sourcePreparationGeneration) return
        buffering = false
        val recoveryGeneration = expectedPreparationGeneration
        val errorCode = playerError?.errorCodeName ?: fallbackErrorCode
        val resumePosition = player.currentPosition.coerceAtLeast(0L)

        // Source arrays are quality-sorted, but users can manually jump to a
        // later URL (e.g. 1080p). On failure we must still try earlier, unfailed
        // candidates such as 720p, without cycling over a URL already attempted.
        sources.getOrNull(sourceIndex)?.url?.let { failedSourceUrls += sourceKey(it) }
        val nextSourceIndex = sources.indices.firstOrNull { index ->
            sourceKey(sources[index].url) !in failedSourceUrls
        }
        if (nextSourceIndex != null) {
            sourceIndex = nextSourceIndex
            prepareSource(sources[sourceIndex], resumePosition.takeIf { it > 0L })
            return
        }

        val isExplicitDirectSource = !intent.getStringExtra(EXTRA_SOURCE_URL).isNullOrBlank()
        val hasBrokerCandidates = sources.any { it.provider == PlaybackProvider.BROKER }
        if (!isExplicitDirectSource && !hasBrokerCandidates && !brokerFallbackAttempted) {
            brokerFallbackAttempted = true
            buffering = true
            val fallback = try {
                MovyzaPlaybackRepository.resolveBrokerFallback(
                    currentPlaybackRequest(),
                    sources.map { it.url }.toSet()
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (recoveryGeneration != sourcePreparationGeneration) return
                buffering = false
                error = "تعذر تشغيل مصدر VidLink (${errorCode}) ولم يتوفر بديل."
                return
            }

            if (recoveryGeneration != sourcePreparationGeneration) return
            val firstFallbackIndex = sources.size
            sources = sources + fallback
            sourceIndex = firstFallbackIndex
            prepareSource(sources[sourceIndex], resumePosition.takeIf { it > 0L })
            return
        }

        error = "تعذر تشغيل الفيديو (${errorCode}). جرّب مصدرًا آخر أو أعد المحاولة."
    }

    private suspend fun prepareSource(source: PlaybackCandidate, resumePositionMs: Long? = null) {
        val preparationGeneration = ++sourcePreparationGeneration
        // While a new source's subtitle metadata is being prepared, ignore errors
        // from the previous timeline; the new attempt owns recovery from this point.
        handlingPlaybackError = true
        startupWatchdogJob?.cancel()
        startupWatchdogJob = null
        error = null
        buffering = true
        if (source.quality > 0) selectedQualityHeight = source.quality
        subtitleTracks = emptyList()
        audioTracks = emptyList()

        val sourceUserAgent = source.headers.entries
            .firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }
            ?.value
            ?.takeIf { it.isNotBlank() }
            ?: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        // ExoPlayer must manage Range for seek requests. Also, Factory.setUserAgent
        // can override a User-Agent passed as a default request property.
        val requestHeaders = source.headers.filterKeys {
            !it.equals("User-Agent", ignoreCase = true) &&
                !it.equals("Range", ignoreCase = true)
        }
        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(12_000)
            .setReadTimeoutMs(20_000)
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent(sourceUserAgent)
            .setDefaultRequestProperties(requestHeaders)

        // Subtitle URL fetches include network I/O, so run them concurrently off
        // the main thread; avoid freezing the native player's UI during startup.
        val subtitleConfigurations = coroutineScope {
            source.subtitles.mapIndexed { index, subtitle ->
                async(Dispatchers.IO) {
                    runCatching {
                        buildPreparedSubtitleConfiguration(source, subtitle, index)
                    }.getOrNull()
                }
            }.awaitAll().filterNotNull()
        }

        // Do not let a stale preparation finish after a retry or source switch.
        if (preparationGeneration != sourcePreparationGeneration) return

        val mediaSource = try {
            val mediaItemBuilder = MediaItem.Builder()
                .setUri(source.url)
                .setTag(source)
                .setSubtitleConfigurations(subtitleConfigurations)
            mediaMimeTypeFor(source)?.let { mediaItemBuilder.setMimeType(it) }
            val mediaItem = mediaItemBuilder.build()

            DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))
                .createMediaSource(mediaItem)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (preparationGeneration != sourcePreparationGeneration) return
            handlingPlaybackError = true
            handlePlaybackError(null, preparationGeneration, "SOURCE_SETUP")
            return
        }

        try {
            // Recovery is now committed to a new MediaSource; allow a future
            // error from this new attempt to start the next failover transition.
            handlingPlaybackError = false
            if (resumePositionMs != null && resumePositionMs > 0L) {
                player.setMediaSource(mediaSource, resumePositionMs)
            } else {
                player.setMediaSource(mediaSource)
            }
            player.prepare()
            player.playWhenReady = true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (preparationGeneration != sourcePreparationGeneration) return
            handlingPlaybackError = true
            handlePlaybackError(null, preparationGeneration, "SOURCE_SETUP")
            return
        }

        // A dead manifest/CDN can leave ExoPlayer buffering forever without
        // emitting a terminal error. Give each source 25 seconds to start,
        // then route it through the same serialized failover path.
        val watchedSourceIndex = sourceIndex
        startupWatchdogJob?.cancel()
        startupWatchdogJob = lifecycleScope.launch {
            delay(25_000)
            if (preparationGeneration != sourcePreparationGeneration ||
                sourceIndex != watchedSourceIndex ||
                player.isPlaying ||
                !player.playWhenReady ||
                player.playbackState == Player.STATE_ENDED ||
                handlingPlaybackError
            ) return@launch

            handlingPlaybackError = true
            handlePlaybackError(null, preparationGeneration)
        }
    }

    private fun mediaMimeTypeFor(source: PlaybackCandidate): String? {
        val declared = source.format.trim().lowercase(Locale.US).substringBefore(";")
        val path = source.url.lowercase(Locale.US).substringBefore("?").substringBefore("#")
        return when {
            declared in setOf("hls", "m3u8", "mpegurl") ||
                declared.contains("mpegurl") ||
                path.endsWith(".m3u8") -> MimeTypes.APPLICATION_M3U8
            declared in setOf("dash", "mpd") || declared.contains("dash") ||
                declared.contains("dash+xml") || path.endsWith(".mpd") -> MimeTypes.APPLICATION_MPD
            declared.contains("mp4") || path.endsWith(".mp4") -> MimeTypes.VIDEO_MP4
            declared.contains("webm") || path.endsWith(".webm") -> MimeTypes.VIDEO_WEBM
            declared.contains("mp2t") || path.endsWith(".ts") -> MimeTypes.VIDEO_MP2T
            else -> null
        }
    }

    private suspend fun buildPreparedSubtitleConfiguration(
        source: PlaybackCandidate,
        subtitle: PlaybackSubtitle,
        index: Int
    ): MediaItem.SubtitleConfiguration? {
        val declared = subtitle.mimeType.trim().lowercase()
        val plainUrl = subtitle.url.lowercase().substringBefore("?")
        val mime = when {
            declared.contains("vtt") || plainUrl.endsWith(".vtt") -> MimeTypes.TEXT_VTT
            declared.contains("srt") || declared.contains("subrip") || plainUrl.endsWith(".srt") ->
                MimeTypes.APPLICATION_SUBRIP
            declared.contains("ssa") || declared.contains("ass") ||
                plainUrl.endsWith(".ass") || plainUrl.endsWith(".ssa") -> MimeTypes.TEXT_SSA
            else -> MimeTypes.TEXT_VTT
        }

        val cacheDir = File(cacheDir, "movyza_subtitles").apply { mkdirs() }
        val extension = when (mime) {
            MimeTypes.APPLICATION_SUBRIP -> "srt"
            MimeTypes.TEXT_SSA -> "ass"
            else -> "vtt"
        }
        val cacheFile = File(cacheDir, "subtitle_${Integer.toUnsignedString(subtitle.url.hashCode())}_$index.$extension")

        // Reuse a previously normalized subtitle when switching quality/source;
        // otherwise every switch re-downloads the same subtitle and delays video.
        val cachedText = if (cacheFile.isFile && cacheFile.length() > 0L) {
            runCatching { cacheFile.readText(Charsets.UTF_8) }
                .getOrNull()
                ?.takeIf { it.isNotBlank() }
        } else {
            null
        }
        val normalizedText = cachedText ?: runCatching {
            val requestBuilder = Request.Builder()
                .url(subtitle.url)
                .header("Accept", "text/vtt,text/plain,text/*,application/*;q=0.8")
                .header("User-Agent", "Movyza/2.0 Android")
            source.headers.forEach { (key, value) ->
                if (key.equals("Range", ignoreCase = true)) return@forEach
                requestBuilder.header(key, value)
            }

            subtitleClient.newCall(requestBuilder.build()).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val text = response.body?.string().orEmpty()
                if (text.isBlank()) null else normalizeSubtitleForMovyza(text, mime)
            }
        }.getOrNull()

        if (!normalizedText.isNullOrBlank()) {
            if (cachedText == null) cacheFile.writeText(normalizedText, Charsets.UTF_8)
            Uri.fromFile(cacheFile)
        } else {
            runCatching { Uri.parse(subtitle.url) }.getOrNull()
        }?.let { uri ->
            return MediaItem.SubtitleConfiguration.Builder(uri)
                .setMimeType(mime)
                .setLanguage(subtitle.language.ifBlank { null })
                .setLabel(subtitle.label.ifBlank { languageDisplayName(subtitle.language) })
                .setSelectionFlags(
                    (if (subtitle.isDefault) C.SELECTION_FLAG_DEFAULT else 0) or
                        (if (subtitle.language.isNotBlank()) C.SELECTION_FLAG_AUTOSELECT else 0) or
                        (if (subtitle.isForced) C.SELECTION_FLAG_FORCED else 0)
                )
                .setRoleFlags(0)
                .build()
        }

        return null
    }

    private fun normalizeSubtitleForMovyza(text: String, mime: String): String {
        val normalized = text
            .replace("\r\n", "\n")
            .replace("\r", "\n")

        if (mime == MimeTypes.TEXT_SSA) {
            // ASS/SSA Dialogue records are structured records, not plain cue text.
            // In particular, \N is a format-level line-break control. Replacing it
            // with a real newline can split/corrupt the Dialogue record before the
            // SSA decoder parses it, so preserve the original event structure.
            return normalized
        }

        val lines = normalized.split("\n")
        val out = StringBuilder(normalized.length + 64)
        var insideCueText = false

        lines.forEachIndexed { index, line ->
            val trimmed = line.trim()
            if (trimmed.isBlank()) {
                insideCueText = false
                out.append(line)
            } else if (trimmed.contains("-->")) {
                insideCueText = true
                out.append(line)
            } else if (insideCueText) {
                out.append(normalizeDialogueLine(line))
            } else {
                out.append(line)
            }

            if (index != lines.lastIndex) out.append('\n')
        }

        return out.toString()
    }

    private fun normalizeDialogueLine(line: String): String {
        val trimmed = line.trim()
        if (trimmed.isBlank()) return line

        // Common subtitle convention: multiple speakers in one cue are separated
        // by a spaced hyphen/en dash/em dash. Render each speaker as its own line
        // and make the dialogue markers consistent with hard-sub styling.
        val withoutLeadingMarker = trimmed.replaceFirst(Regex("^[-–—]\\s+"), "")
        val hasLeadingMarker = withoutLeadingMarker != trimmed
        val segments = Regex("\\s+[-–—]\\s+")
            .split(withoutLeadingMarker)
            .map { it.trim() }
            .filter { it.isNotEmpty() }

        if (segments.size > 1) {
            return segments.joinToString("\n") { "- $it" }
        }

        return if (hasLeadingMarker) "- $withoutLeadingMarker" else line
    }

    private fun refreshTracks() {
        val trackHeights = buildList {
            player.currentTracks.groups
                .filter { it.type == C.TRACK_TYPE_VIDEO }
                .forEach { group ->
                    for (index in 0 until group.length) {
                        val format = group.getTrackFormat(index)
                        if (group.isTrackSupported(index) && format.height > 0) add(format.height)
                    }
                }
        }
        val sourceHeights = sources.map { it.quality }.filter { it > 0 }
        val heights = (trackHeights + sourceHeights).distinct().sortedDescending()

        // VidLink may expose each quality as a separate URL rather than as
        // variants in one HLS master playlist. Include both kinds in the menu.
        qualities = heights
        subtitleTracks = buildTrackOptions(C.TRACK_TYPE_TEXT)
        audioTracks = buildTrackOptions(C.TRACK_TYPE_AUDIO)

        if (!defaultQualityApplied && heights.isNotEmpty()) {
            defaultQualityApplied = true
            val preferred = heights.minByOrNull { abs(it - preferredQualityHeight) } ?: heights.first()
            selectQuality(preferred, persist = false)
        }

        if (!defaultSubtitleApplied && subtitleTracks.isNotEmpty()) {
            defaultSubtitleApplied = true
            selectPreferredTextTrack()
        }
    }

    private fun buildTrackOptions(type: Int): List<TrackOption> = buildList {
        player.currentTracks.groups
            .filter { it.type == type }
            .forEach { group ->
                for (index in 0 until group.length) {
                    if (!group.isTrackSupported(index)) continue
                    val format = group.getTrackFormat(index)
                    val language = format.language.orEmpty()
                    val label = format.label?.toString().orEmpty()
                        .ifBlank { languageDisplayName(language).ifBlank { "Track " + (index + 1) } }
                    add(
                        TrackOption(
                            type = type,
                            group = group,
                            index = index,
                            label = label,
                            languageTag = language
                        )
                    )
                }
            }
    }

    private fun selectTextTrack(option: TrackOption?) {
        val preferred = option ?: subtitleTracks.firstOrNull()
        if (preferred == null) return

        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(
                TrackSelectionOverride(preferred.group.mediaTrackGroup, preferred.index)
            )
            .build()
    }

    private fun selectPreferredTextTrack() {
        if (subtitleTracks.isEmpty()) return
        val preferredLanguage = Locale.getDefault().language
        val preferred = subtitleTracks.firstOrNull {
            normalizedLanguage(it.languageTag) == preferredLanguage
        } ?: subtitleTracks.firstOrNull {
            it.languageTag.isBlank()
        } ?: subtitleTracks.first()
        selectTextTrack(preferred)
    }

    private fun selectAudioTrack(option: TrackOption) {
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, false)
            .setOverrideForType(
                TrackSelectionOverride(option.group.mediaTrackGroup, option.index)
            )
            .build()
    }

    private fun normalizedLanguage(language: String): String {
        val code = language.trim().lowercase()
            .substringBefore('-')
            .substringBefore('_')

        return when (code) {
            "eng" -> "en"
            "ara" -> "ar"
            "fra", "fre" -> "fr"
            "deu", "ger" -> "de"
            "spa" -> "es"
            "ita" -> "it"
            "por" -> "pt"
            "rus" -> "ru"
            "tur" -> "tr"
            "hin" -> "hi"
            "jpn" -> "ja"
            "kor" -> "ko"
            "zho", "chi" -> "zh"
            "nld", "dut" -> "nl"
            "swe" -> "sv"
            "dan" -> "da"
            "nor" -> "no"
            "fin" -> "fi"
            "pol" -> "pl"
            "ces", "cze" -> "cs"
            "ukr" -> "uk"
            "heb" -> "he"
            "vie" -> "vi"
            "ind" -> "id"
            "msa", "may" -> "ms"
            "tha" -> "th"
            "ron", "rum" -> "ro"
            "hun" -> "hu"
            "ell", "gre" -> "el"
            "ben" -> "bn"
            "urd" -> "ur"
            "fas", "per" -> "fa"
            else -> code
        }
    }

    private fun languageDisplayName(language: String): String {
        if (language.isBlank() || language.equals("und", ignoreCase = true)) return ""
        val normalized = normalizedLanguage(language)
        val locale = Locale.forLanguageTag(normalized)
        return locale.getDisplayLanguage(Locale.getDefault()).ifBlank { language }
    }

    private fun selectQuality(height: Int, persist: Boolean = true) {
        selectedQualityHeight = height
        if (persist) {
            preferredQualityHeight = height
            playerPrefs.edit().putInt("preferred_quality", height).apply()
        }

        val tracks = mutableListOf<Pair<Tracks.Group, Int>>()
        player.currentTracks.groups
            .filter { it.type == C.TRACK_TYPE_VIDEO }
            .forEach { group ->
                for (index in 0 until group.length) {
                    val format = group.getTrackFormat(index)
                    if (group.isTrackSupported(index) && format.height > 0) tracks += group to index
                }
            }

        // If the active source exposes this exact quality as an in-player
        // variant, keep the URL and change only the track selector.
        val exactTrack = tracks.firstOrNull {
            it.first.getTrackFormat(it.second).height == height
        }
        if (exactTrack != null) {
            player.trackSelectionParameters = player.trackSelectionParameters
                .buildUpon()
                .setOverrideForType(
                    TrackSelectionOverride(exactTrack.first.mediaTrackGroup, exactTrack.second)
                )
                .build()
            return
        }

        // Some VidLink responses use one direct URL per quality. Switch URLs
        // manually when the requested quality is not an available in-player track.
        val sourceMatch = sources.indices.firstOrNull { sources[it].quality == height }
        if (sourceMatch != null) {
            if (sourceMatch != sourceIndex) {
                val resumePosition = player.currentPosition.coerceAtLeast(0L)
                sourceIndex = sourceMatch
                lifecycleScope.launch {
                    prepareSource(sources[sourceMatch], resumePosition.takeIf { it > 0L })
                }
            }
            return
        }

        val closestTrack = tracks.minByOrNull {
            abs(it.first.getTrackFormat(it.second).height - height)
        } ?: return
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(
                TrackSelectionOverride(closestTrack.first.mediaTrackGroup, closestTrack.second)
            )
            .build()
    }

    private fun playNextEpisode() {
        val mediaType = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty()
        if (!mediaType.equals("series", ignoreCase = true) &&
            !mediaType.equals("tv", ignoreCase = true)
        ) return
        saveProgress(true)
        activeEpisode += 1
        val baseName = displayTitle.substringBefore(" — ")
        displayTitle = "$baseName — S$activeSeason E$activeEpisode"
        lifecycleScope.launch { resolveAndStart() }
    }

    private fun restoreSavedProgress() {
        val saved = getPreferences(MODE_PRIVATE).getLong(progressKey(), 0L)
        val length = player.duration.coerceAtLeast(0L)

        if (saved > 15_000L && (length <= 0L || saved < length - 15_000L)) {
            player.seekTo(saved)
            player.play()
        }
    }

    private fun progressKey(): String {
        val type = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty()
        val id = intent.getIntExtra(EXTRA_TMDB_ID, 0)
        return "progress:$type:$id:$activeSeason:$activeEpisode"
    }

    private fun saveProgress(force: Boolean) {
        val current = player.currentPosition.coerceAtLeast(0L)
        val total = player.duration.coerceAtLeast(0L)
        if (!force && abs(current - lastPositionSave) < 5_000L) return
        lastPositionSave = current
        getPreferences(MODE_PRIVATE).edit().putLong(progressKey(), current).apply()

        // Sync progress with shared Watch History preferences
        val tmdbId = intent.getIntExtra(EXTRA_TMDB_ID, 0)
        if (tmdbId > 0 && current > 3_000L) {
            runCatching {
                val historyPrefs = getSharedPreferences(MainViewModel.HISTORY_PREFS, Context.MODE_PRIVATE)
                val raw = historyPrefs.getString(MainViewModel.HISTORY_KEY, null)
                if (!raw.isNullOrBlank()) {
                    val arr = JSONArray(raw)
                    for (i in 0 until arr.length()) {
                        val obj = arr.optJSONObject(i) ?: continue
                        if (obj.optInt("id") == tmdbId) {
                            obj.put("season", activeSeason)
                            obj.put("episode", activeEpisode)
                            obj.put("positionMs", current)
                            if (total > 0L) obj.put("durationMs", total)
                            obj.put("updatedAt", System.currentTimeMillis())
                            break
                        }
                    }
                    historyPrefs.edit().putString(MainViewModel.HISTORY_KEY, arr.toString()).apply()
                }
            }
        }
    }

    override fun onPause() {
        saveProgress(true)
        startupWatchdogJob?.cancel()
        startupWatchdogJob = null
        player.pause()
        super.onPause()
    }

    override fun onDestroy() {
        progressJob?.cancel()
        startupWatchdogJob?.cancel()
        playbackRequestGeneration++
        sourcePreparationGeneration++
        player.release()
        super.onDestroy()
    }
}

@UnstableApi
private fun subtitleStyleFor(style: SubtitleVisualStyle): CaptionStyleCompat = when (style) {
    SubtitleVisualStyle.CLASSIC -> CaptionStyleCompat(
        android.graphics.Color.WHITE,
        android.graphics.Color.TRANSPARENT,
        android.graphics.Color.TRANSPARENT,
        CaptionStyleCompat.EDGE_TYPE_OUTLINE,
        android.graphics.Color.BLACK,
        android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
    )
    SubtitleVisualStyle.GOLD -> CaptionStyleCompat(
        android.graphics.Color.rgb(245, 201, 76),
        android.graphics.Color.TRANSPARENT,
        android.graphics.Color.TRANSPARENT,
        CaptionStyleCompat.EDGE_TYPE_OUTLINE,
        android.graphics.Color.BLACK,
        android.graphics.Typeface.DEFAULT_BOLD
    )
    SubtitleVisualStyle.HIGH_CONTRAST -> CaptionStyleCompat(
        android.graphics.Color.WHITE,
        android.graphics.Color.TRANSPARENT,
        android.graphics.Color.TRANSPARENT,
        CaptionStyleCompat.EDGE_TYPE_OUTLINE,
        android.graphics.Color.BLACK,
        android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
    )
}

private fun applySubtitleStyle(playerView: PlayerView, style: SubtitleVisualStyle) {
    playerView.subtitleView?.apply {
        setApplyEmbeddedStyles(false)
        setStyle(subtitleStyleFor(style))
        // Approximate the common hard-sub look: readable bold text, black outline,
        // no subtitle rectangle, and a small safe margin at the bottom of the video.
        setFractionalTextSize(0.052f)
        setBottomPaddingFraction(0.045f)
    }
}

@Composable
private fun MovyzaPlayerScreen(
    title: String,
    isSeries: Boolean,
    player: ExoPlayer,
    position: Long,
    duration: Long,
    buffered: Long,
    playing: Boolean,
    buffering: Boolean,
    error: String?,
    qualities: List<Int>,
    selectedQualityHeight: Int,
    subtitleTracks: List<TrackOption>,
    audioTracks: List<TrackOption>,
    playbackSpeed: Float,
    autoplayNext: Boolean,
    subtitleVisualStyle: SubtitleVisualStyle,
    onClose: () -> Unit,
    onSeek: (Long) -> Unit,
    onTogglePlay: () -> Unit,
    onSkip: (Long) -> Unit,
    onNextEpisode: () -> Unit,
    onQuality: (Int) -> Unit,
    onSelectSubtitle: (TrackOption?) -> Unit,
    onSelectPreferredSubtitle: () -> Unit,
    onSelectAudio: (TrackOption) -> Unit,
    onSpeed: (Float) -> Unit,
    onAutoplayNext: (Boolean) -> Unit,
    onSubtitleStyle: (SubtitleVisualStyle) -> Unit,
    onRetry: () -> Unit
) {
    if (LocalInspectionMode.current) return

    var controls by remember { mutableStateOf(true) }
    var showQuality by remember { mutableStateOf(false) }
    var trackDialog by remember { mutableStateOf<TrackDialog?>(null) }
    var showSettings by remember { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var resizeMode by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }

    BackHandler(onBack = onClose)

    LaunchedEffect(controls, playing) {
        if (controls && playing) {
            delay(3_500)
            controls = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { controls = !controls },
                    onDoubleTap = { offset ->
                        val halfWidth = size.width / 2f
                        onSkip(if (offset.x < halfWidth) -10_000L else 10_000L)
                    }
                )
            }
    ) {
        AndroidView(
            factory = { context ->
                PlayerView(context).apply {
                    useController = false
                    this.resizeMode = resizeMode
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    this.player = player
                    setBackgroundColor(android.graphics.Color.BLACK)
                    applySubtitleStyle(this, subtitleVisualStyle)
                }
            },
            update = { view ->
                view.resizeMode = resizeMode
                applySubtitleStyle(view, subtitleVisualStyle)
            },
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    scaleX = zoom
                    scaleY = zoom
                }
                .pointerInput(Unit) {
                    detectTransformGestures { _, _, gestureZoom, _ ->
                        zoom = (zoom * gestureZoom).coerceIn(1f, 1.35f)
                    }
                }
        )

        if (buffering && error == null) {
            Surface(
                modifier = Modifier.align(Alignment.Center),
                shape = CircleShape,
                color = MovyzaColors.GlassStrong,
                border = BorderStroke(1.dp, MovyzaColors.GoldBorder)
            ) {
                CircularProgressIndicator(
                    modifier = Modifier
                        .padding(14.dp)
                        .size(30.dp),
                    strokeWidth = 2.5.dp,
                    color = MovyzaColors.Gold300
                )
            }
        }

        AnimatedVisibility(
            visible = controls && error == null,
            enter = fadeIn(tween(150)),
            exit = fadeOut(tween(150))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0.0f to Color(0xBF04060D),
                            0.30f to Color.Transparent,
                            0.70f to Color.Transparent,
                            1.0f to Color(0xD904060D)
                        )
                    )
                    .systemBarsPadding()
            ) {
                // Top Glass Control Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MovyzaColors.GlassStrong,
                        border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                    ) {
                        IconButton(onClick = onClose) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.player_close), tint = MovyzaColors.Text)
                        }
                    }

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 12.dp)
                    ) {
                        Text(
                            text = title,
                            color = MovyzaColors.Text,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = stringResource(R.string.player_brand_subtitle),
                            color = MovyzaColors.Gold300,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    if (isSeries) {
                        Surface(
                            shape = MovyzaShapes.Sm,
                            color = MovyzaColors.GlassStrong,
                            border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                        ) {
                            TextButton(onClick = onNextEpisode) {
                                Icon(
                                    Icons.Default.SkipNext,
                                    contentDescription = null,
                                    tint = MovyzaColors.Gold300,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(Modifier.width(4.dp))
                                Text(
                                    text = stringResource(R.string.player_next_episode),
                                    color = MovyzaColors.Text,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                    }

                    if (subtitleTracks.isNotEmpty()) {
                        Surface(
                            shape = MovyzaShapes.Sm,
                            color = MovyzaColors.GlassStrong,
                            border = BorderStroke(1.dp, MovyzaColors.GoldBorder)
                        ) {
                            TextButton(onClick = { trackDialog = TrackDialog.SUBTITLES }) {
                                Text("CC", color = MovyzaColors.Gold300, fontSize = 11.sp, fontWeight = FontWeight.Black)
                            }
                        }
                        Spacer(Modifier.width(6.dp))
                    }

                    if (audioTracks.size > 1) {
                        Surface(
                            shape = MovyzaShapes.Sm,
                            color = MovyzaColors.GlassStrong,
                            border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                        ) {
                            TextButton(onClick = { trackDialog = TrackDialog.AUDIO }) {
                                Text("A", color = MovyzaColors.Text, fontSize = 11.sp, fontWeight = FontWeight.Black)
                            }
                        }
                        Spacer(Modifier.width(6.dp))
                    }

                    Surface(
                        shape = MovyzaShapes.Sm,
                        color = MovyzaColors.GlassStrong,
                        border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                    ) {
                        IconButton(onClick = { showSettings = true }) {
                            Icon(
                                Icons.Outlined.Settings,
                                contentDescription = stringResource(R.string.player_settings),
                                tint = MovyzaColors.Text,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Spacer(Modifier.width(8.dp))

                    Surface(
                        shape = MovyzaShapes.Sm,
                        color = MovyzaColors.GlassStrong,
                        border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                    ) {
                        IconButton(
                            onClick = {
                                resizeMode = when (resizeMode) {
                                    AspectRatioFrameLayout.RESIZE_MODE_FIT -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                                    AspectRatioFrameLayout.RESIZE_MODE_ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                                    else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                                }
                            }
                        ) {
                            Icon(
                                Icons.Outlined.AspectRatio,
                                contentDescription = stringResource(R.string.player_aspect_ratio),
                                tint = MovyzaColors.Text,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Spacer(Modifier.width(8.dp))

                    Surface(
                        shape = MovyzaShapes.Sm,
                        color = MovyzaColors.GlassStrong,
                        border = BorderStroke(1.dp, MovyzaColors.GoldBorder)
                    ) {
                        TextButton(onClick = { showQuality = true }) {
                            Icon(
                                Icons.Outlined.HighQuality,
                                contentDescription = null,
                                tint = MovyzaColors.Gold300,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(Modifier.width(5.dp))
                            val qualityText = if (qualities.isEmpty()) {
                                stringResource(R.string.player_quality_auto)
                            } else {
                                qualityLabel(selectedQualityHeight)
                            }
                            Text(
                                text = qualityText,
                                color = MovyzaColors.Gold300,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                // Center Transport Controls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MovyzaColors.GlassStrong,
                        border = BorderStroke(1.dp, MovyzaColors.GlassBorder),
                        modifier = Modifier.size(50.dp)
                    ) {
                        IconButton(onClick = { onSkip(-10_000L) }) {
                            Icon(
                                Icons.Default.FastRewind,
                                contentDescription = stringResource(R.string.player_seek_back),
                                tint = MovyzaColors.Text,
                                modifier = Modifier.size(26.dp)
                            )
                        }
                    }

                    Spacer(Modifier.width(24.dp))

                    Surface(
                        modifier = Modifier.size(68.dp),
                        shape = CircleShape,
                        color = MovyzaColors.Gold400
                    ) {
                        IconButton(onClick = onTogglePlay) {
                            Icon(
                                imageVector = if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                                contentDescription = if (playing) stringResource(R.string.player_pause) else stringResource(R.string.player_play),
                                tint = MovyzaColors.Bg,
                                modifier = Modifier.size(34.dp)
                            )
                        }
                    }

                    Spacer(Modifier.width(24.dp))

                    Surface(
                        shape = CircleShape,
                        color = MovyzaColors.GlassStrong,
                        border = BorderStroke(1.dp, MovyzaColors.GlassBorder),
                        modifier = Modifier.size(50.dp)
                    ) {
                        IconButton(onClick = { onSkip(10_000L) }) {
                            Icon(
                                Icons.Default.FastForward,
                                contentDescription = stringResource(R.string.player_seek_forward),
                                tint = MovyzaColors.Text,
                                modifier = Modifier.size(26.dp)
                            )
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                // Bottom Timeline & Scrubber
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = formatTime(position),
                            color = MovyzaColors.Gold300,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.weight(1f))
                        if (buffered > position && duration > 0L) {
                            Text(
                                text = stringResource(R.string.player_buffered_format, (100 * buffered.toFloat() / duration.toFloat()).toInt().coerceIn(0, 100)),
                                color = MovyzaColors.Text3,
                                fontSize = 11.sp
                            )
                            Spacer(Modifier.width(12.dp))
                        }
                        Text(
                            text = formatTime(duration),
                            color = MovyzaColors.Text2,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    Slider(
                        value = position.toFloat().coerceIn(0f, duration.coerceAtLeast(1L).toFloat()),
                        onValueChange = { onSeek(it.toLong()) },
                        valueRange = 0f..duration.coerceAtLeast(1L).toFloat(),
                        colors = SliderDefaults.colors(
                            thumbColor = MovyzaColors.Gold300,
                            activeTrackColor = MovyzaColors.Gold400,
                            inactiveTrackColor = MovyzaColors.GlassBorder
                        )
                    )
                }
            }
        }

        if (error != null) {
            Surface(
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth(0.85f)
                    .padding(horizontal = 24.dp),
                shape = RoundedCornerShape(22.dp),
                color = MovyzaColors.GlassStrong,
                border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = error,
                        color = MovyzaColors.Text,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = stringResource(R.string.player_error_hint),
                        color = MovyzaColors.Text3,
                        fontSize = 12.sp
                    )
                    Spacer(Modifier.height(16.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = onRetry,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MovyzaColors.Gold400,
                                contentColor = MovyzaColors.Bg
                            ),
                            shape = MovyzaShapes.Sm
                        ) {
                            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.player_retry), fontWeight = FontWeight.Bold)
                        }
                        TextButton(onClick = onClose) {
                            Text(stringResource(R.string.back), color = MovyzaColors.Text2)
                        }
                    }
                }
            }
        }
    }

    if (showSettings) {
        AlertDialog(
            onDismissRequest = { showSettings = false },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = { Text(stringResource(R.string.player_settings), color = MovyzaColors.Text, fontWeight = FontWeight.Black) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.player_speed), color = MovyzaColors.Text2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        listOf(0.75f, 1f, 1.25f, 1.5f, 2f).forEach { speed ->
                            TextButton(
                                onClick = { onSpeed(speed) },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text(
                                    "${speed}x",
                                    color = if (kotlin.math.abs(playbackSpeed - speed) < 0.01f) MovyzaColors.Gold300 else MovyzaColors.Text,
                                    fontWeight = if (kotlin.math.abs(playbackSpeed - speed) < 0.01f) FontWeight.Bold else FontWeight.Normal
                                )
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.player_autoplay_next), color = MovyzaColors.Text, fontWeight = FontWeight.Bold)
                            Text(
                                stringResource(if (autoplayNext) R.string.player_autoplay_enabled else R.string.player_autoplay_disabled),
                                color = MovyzaColors.Text3,
                                fontSize = 11.sp
                            )
                        }
                        Switch(checked = autoplayNext, onCheckedChange = onAutoplayNext)
                    }

                    Text(stringResource(R.string.player_subtitle_style), color = MovyzaColors.Text2, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    listOf(
                        SubtitleVisualStyle.CLASSIC to stringResource(R.string.subtitle_classic),
                        SubtitleVisualStyle.GOLD to stringResource(R.string.subtitle_gold),
                        SubtitleVisualStyle.HIGH_CONTRAST to stringResource(R.string.subtitle_high_contrast)
                    ).forEach { (style, label) ->
                        TextButton(
                            onClick = { onSubtitleStyle(style) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                label,
                                color = if (subtitleVisualStyle == style) MovyzaColors.Gold300 else MovyzaColors.Text,
                                fontWeight = if (subtitleVisualStyle == style) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }

                    Text(
                        stringResource(R.string.player_default_quality_note),
                        color = MovyzaColors.Text3,
                        fontSize = 11.sp
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { showSettings = false }) {
                    Text(stringResource(R.string.common_done), color = MovyzaColors.Gold300, fontWeight = FontWeight.Bold)
                }
            }
        )
    }

    if (showQuality) {
        AlertDialog(
            onDismissRequest = { showQuality = false },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = {
                Text(stringResource(R.string.player_quality_title), color = MovyzaColors.Text, fontWeight = FontWeight.Black)
            },
            text = {
                Column {
                    if (qualities.isEmpty()) {
                        Text(stringResource(R.string.player_quality_auto_active), color = MovyzaColors.Text2, fontSize = 13.sp)
                    } else {
                        qualities.distinct().sortedDescending().forEach { height ->
                            TextButton(
                                onClick = {
                                    onQuality(height)
                                    showQuality = false
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = qualityLabel(height),
                                    color = if (height == selectedQualityHeight) MovyzaColors.Gold300 else MovyzaColors.Text,
                                    fontWeight = if (height == selectedQualityHeight) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 14.sp
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showQuality = false }) {
                    Text(stringResource(R.string.player_close), color = MovyzaColors.Text3)
                }
            }
        )
    }

    if (trackDialog == TrackDialog.SUBTITLES) {
        AlertDialog(
            onDismissRequest = { trackDialog = null },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = { Text(stringResource(R.string.player_subtitles_title), color = MovyzaColors.Text, fontWeight = FontWeight.Black) },
            text = {
                Column {
                    TextButton(onClick = { onSelectPreferredSubtitle(); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.player_subtitle_device_auto), color = MovyzaColors.Gold300, fontWeight = FontWeight.Bold)
                    }
                    subtitleTracks.forEach { option ->
                        TextButton(onClick = { onSelectSubtitle(option); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                option.label + if (option.languageTag.isNotBlank()) " • " + option.languageTag else "",
                                color = MovyzaColors.Text
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { trackDialog = null }) { Text(stringResource(R.string.player_close), color = MovyzaColors.Text3) } }
        )
    }

    if (trackDialog == TrackDialog.AUDIO) {
        AlertDialog(
            onDismissRequest = { trackDialog = null },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = { Text(stringResource(R.string.player_audio_track_title), color = MovyzaColors.Text, fontWeight = FontWeight.Black) },
            text = {
                Column {
                    audioTracks.forEach { option ->
                        TextButton(onClick = { onSelectAudio(option); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                option.label + if (option.languageTag.isNotBlank()) " • " + option.languageTag else "",
                                color = MovyzaColors.Text
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { trackDialog = null }) { Text(stringResource(R.string.player_close), color = MovyzaColors.Text3) } }
        )
    }
}

private fun formatTime(milliseconds: Long): String {
    val seconds = (milliseconds / 1000L).coerceAtLeast(0L)
    val h = seconds / 3600L
    val m = (seconds % 3600L) / 60L
    val s = seconds % 60L
    return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.US, "%02d:%02d", m, s)
}

@Composable
private fun qualityLabel(height: Int): String = when {
    height >= 2160 -> stringResource(R.string.player_quality_4k)
    height >= 1440 -> stringResource(R.string.player_quality_1440)
    height >= 1080 -> stringResource(R.string.player_quality_1080)
    height >= 720 -> stringResource(R.string.player_quality_720)
    height >= 576 -> stringResource(R.string.player_quality_576)
    height >= 480 -> stringResource(R.string.player_quality_480)
    height >= 360 -> stringResource(R.string.player_quality_360)
    else -> stringResource(R.string.player_quality_custom_format, height)
}
