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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
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
import androidx.media3.ui.PlayerView
import com.movyza.app.MainViewModel
import com.movyza.app.MovyzaColors
import com.movyza.app.MovyzaShapes
import com.movyza.app.MovyzaTheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import java.util.Locale
import kotlin.math.abs

private enum class TrackDialog { SUBTITLES, AUDIO }

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
    private var firstReady = true
    private var defaultQualityApplied = false
    private var progressJob: Job? = null
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
    private var trackDialog by mutableStateOf<TrackDialog?>(null)
    private var defaultSubtitleApplied = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()

        activeSeason = intent.getIntExtra(EXTRA_SEASON, 1).coerceAtLeast(1)
        activeEpisode = intent.getIntExtra(EXTRA_EPISODE, 1).coerceAtLeast(1)
        displayTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "MOVYZA" }
        val isSeries = intent.getStringExtra(EXTRA_MEDIA_TYPE) == "series"

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

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                buffering = state == Player.STATE_BUFFERING
                duration = player.duration.coerceAtLeast(0L)
                when (state) {
                    Player.STATE_READY -> {
                        buffering = false
                        if (firstReady) {
                            firstReady = false
                            restoreSavedProgress()
                        }
                        refreshTracks()
                    }
                    Player.STATE_ENDED -> saveProgress(true)
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                playing = isPlaying
            }

            override fun onTracksChanged(tracks: Tracks) {
                refreshTracks()
            }

            override fun onPlayerError(playerError: PlaybackException) {
                buffering = false
                if (sourceIndex + 1 < sources.size) {
                    sourceIndex += 1
                    prepareSource(sources[sourceIndex])
                } else {
                    error = "تعذر تشغيل المصدر الحالي، يرجى المحاولة مجدداً."
                }
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
                    onClose = { finish() },
                    onSeek = { player.seekTo(it.coerceIn(0L, duration)) },
                    onTogglePlay = { if (player.isPlaying) player.pause() else player.play() },
                    onSkip = { delta -> player.seekTo((player.currentPosition + delta).coerceIn(0L, duration)) },
                    onNextEpisode = {
                        if (isSeries) {
                            saveProgress(true)
                            activeEpisode += 1
                            val baseName = displayTitle.substringBefore(" — ")
                            displayTitle = "$baseName — S$activeSeason E$activeEpisode"
                            lifecycleScope.launch { resolveAndStart() }
                        }
                    },
                    onQuality = { selectQuality(it) },
                    onSubtitles = { trackDialog = TrackDialog.SUBTITLES },
                    onAudio = { trackDialog = TrackDialog.AUDIO },
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

    private suspend fun resolveAndStart() {
        error = null
        buffering = true
        val directUrl = intent.getStringExtra(EXTRA_SOURCE_URL)?.trim().orEmpty()
        sources = if (directUrl.isNotBlank()) {
            listOf(PlaybackCandidate(directUrl))
        } else {
            val request = PlaybackRequest(
                tmdbId = intent.getIntExtra(EXTRA_TMDB_ID, 0),
                mediaType = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty().ifBlank { "movie" },
                season = activeSeason,
                episode = activeEpisode
            )
            runCatching { MovyzaPlaybackRepository.resolve(request) }
                .getOrElse {
                    buffering = false
                    error = it.message ?: "لم نتمكن من تجهيز مصدر البث المباشر."
                    emptyList()
                }
        }

        if (sources.isEmpty()) return

        sourceIndex = 0
        firstReady = true
        defaultQualityApplied = false
        defaultSubtitleApplied = false
        subtitleTracks = emptyList()
        audioTracks = emptyList()
        prepareSource(sources.first())
    }

    private fun prepareSource(source: PlaybackCandidate) {
        error = null
        buffering = true
        subtitleTracks = emptyList()
        audioTracks = emptyList()

        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(12_000)
            .setReadTimeoutMs(20_000)
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("Movyza/2.0 Android")
            .setDefaultRequestProperties(source.headers)

        val subtitleConfigurations = source.subtitles.mapNotNull { subtitle ->
            val uri = runCatching { Uri.parse(subtitle.url) }.getOrNull() ?: return@mapNotNull null
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

            MediaItem.SubtitleConfiguration.Builder(uri)
                .setMimeType(mime)
                .setLanguage(subtitle.language.ifBlank { null })
                .setLabel(subtitle.label.ifBlank { languageDisplayName(subtitle.language) })
                .setSelectionFlags(if (subtitle.isDefault) C.SELECTION_FLAG_DEFAULT else 0)
                .setRoleFlags(if (subtitle.isForced) C.ROLE_FLAG_FORCED else 0)
                .build()
        }

        val mediaItem = MediaItem.Builder()
            .setUri(source.url)
            .setTag(source)
            .setSubtitleConfigurations(subtitleConfigurations)
            .build()

        val mediaSource = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))
            .createMediaSource(mediaItem)

        player.setMediaSource(mediaSource)
        player.prepare()
        player.playWhenReady = true
    }

    private fun refreshTracks() {
        val heights = buildList {
            player.currentTracks.groups
                .filter { it.type == C.TRACK_TYPE_VIDEO }
                .forEach { group ->
                    for (index in 0 until group.length) {
                        val format = group.getTrackFormat(index)
                        if (group.isTrackSupported(index) && format.height > 0) add(format.height)
                    }
                }
        }.distinct().sortedDescending()

        qualities = heights
        subtitleTracks = buildTrackOptions(C.TRACK_TYPE_TEXT)
        audioTracks = buildTrackOptions(C.TRACK_TYPE_AUDIO)

        if (!defaultQualityApplied && heights.isNotEmpty()) {
            defaultQualityApplied = true
            val preferred = heights.minByOrNull { abs(it - 720) } ?: heights.first()
            selectQuality(preferred)
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
        val builder = player.trackSelectionParameters.buildUpon()
        if (option == null) {
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            builder
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(
                    TrackSelectionOverride(option.group.mediaTrackGroup, option.index)
                )
        }
        player.trackSelectionParameters = builder.build()
    }

    private fun selectPreferredTextTrack() {
        val preferredLanguage = Locale.getDefault().language
        val preferred = subtitleTracks.firstOrNull {
            normalizedLanguage(it.languageTag) == preferredLanguage
        } ?: subtitleTracks.firstOrNull()
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

    private fun normalizedLanguage(language: String): String =
        language.trim().lowercase().substringBefore('-').substringBefore('_')

    private fun languageDisplayName(language: String): String {
        if (language.isBlank() || language.equals("und", ignoreCase = true)) return ""
        val locale = Locale.forLanguageTag(language.replace('_', '-'))
        return locale.getDisplayLanguage(Locale.getDefault()).ifBlank { language }
    }

    private fun selectQuality(height: Int) {
        selectedQualityHeight = height
        val tracks = mutableListOf<Pair<Tracks.Group, Int>>()
        player.currentTracks.groups
            .filter { it.type == C.TRACK_TYPE_VIDEO }
            .forEach { group ->
                for (index in 0 until group.length) {
                    val format = group.getTrackFormat(index)
                    if (group.isTrackSupported(index) && format.height > 0) tracks += group to index
                }
            }

        val picked = tracks.minByOrNull {
            abs(it.first.getTrackFormat(it.second).height - height)
        } ?: return

        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(TrackSelectionOverride(picked.first.mediaTrackGroup, picked.second))
            .build()
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
        player.pause()
        super.onPause()
    }

    override fun onDestroy() {
        progressJob?.cancel()
        player.release()
        super.onDestroy()
    }
}

@UnstableApi
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
    onClose: () -> Unit,
    onSeek: (Long) -> Unit,
    onTogglePlay: () -> Unit,
    onSkip: (Long) -> Unit,
    onNextEpisode: () -> Unit,
    onQuality: (Int) -> Unit,
    onSubtitles: () -> Unit,
    onAudio: () -> Unit,
    onRetry: () -> Unit
) {
    if (LocalInspectionMode.current) return

    var controls by remember { mutableStateOf(true) }
    var showQuality by remember { mutableStateOf(false) }
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
                }
            },
            update = { view ->
                view.resizeMode = resizeMode
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
                            Icon(Icons.Default.Close, contentDescription = "إغلاق", tint = MovyzaColors.Text)
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
                            text = "MOVYZA CINEMA PLAYER",
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
                                    text = "الحلقة التالية",
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
                            TextButton(onClick = onSubtitles) {
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
                            TextButton(onClick = onAudio) {
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
                                contentDescription = "أبعاد الشاشة",
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
                                "تلقائي"
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
                                contentDescription = "تأخير 10 ثوان",
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
                                contentDescription = if (playing) "إيقاف مؤقت" else "تشغيل",
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
                                contentDescription = "تقديم 10 ثوان",
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
                                text = "محمّل ${(100 * buffered.toFloat() / duration.toFloat()).toInt().coerceIn(0, 100)}%",
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
                        text = "تحقق من اتصال الإنترنت أو أعد محاولة جلب المصدر.",
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
                            Text("إعادة المحاولة", fontWeight = FontWeight.Bold)
                        }
                        TextButton(onClick = onClose) {
                            Text("رجوع", color = MovyzaColors.Text2)
                        }
                    }
                }
            }
        }
    }

    if (showQuality) {
        AlertDialog(
            onDismissRequest = { showQuality = false },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = {
                Text("جودة البث", color = MovyzaColors.Text, fontWeight = FontWeight.Black)
            },
            text = {
                Column {
                    if (qualities.isEmpty()) {
                        Text("الجودة التلقائية مفعّلة لهذا المصدر.", color = MovyzaColors.Text2, fontSize = 13.sp)
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
                    Text("إغلاق", color = MovyzaColors.Text3)
                }
            }
        )
    }

    if (trackDialog == TrackDialog.SUBTITLES) {
        AlertDialog(
            onDismissRequest = { trackDialog = null },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = { Text("الترجمة", color = MovyzaColors.Text, fontWeight = FontWeight.Black) },
            text = {
                Column {
                    TextButton(onClick = { selectTextTrack(null); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("إيقاف الترجمة", color = MovyzaColors.Text, fontWeight = FontWeight.Bold)
                    }
                    TextButton(onClick = { selectPreferredTextTrack(); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                        Text("تلقائي • لغة الجهاز", color = MovyzaColors.Gold300, fontWeight = FontWeight.Bold)
                    }
                    subtitleTracks.forEach { option ->
                        TextButton(onClick = { selectTextTrack(option); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                option.label + if (option.languageTag.isNotBlank()) " • " + option.languageTag else "",
                                color = MovyzaColors.Text
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { trackDialog = null }) { Text("إغلاق", color = MovyzaColors.Text3) } }
        )
    }

    if (trackDialog == TrackDialog.AUDIO) {
        AlertDialog(
            onDismissRequest = { trackDialog = null },
            containerColor = MovyzaColors.Bg2,
            shape = MovyzaShapes.Lg,
            title = { Text("مسار الصوت", color = MovyzaColors.Text, fontWeight = FontWeight.Black) },
            text = {
                Column {
                    audioTracks.forEach { option ->
                        TextButton(onClick = { selectAudioTrack(option); trackDialog = null }, modifier = Modifier.fillMaxWidth()) {
                            Text(
                                option.label + if (option.languageTag.isNotBlank()) " • " + option.languageTag else "",
                                color = MovyzaColors.Text
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { trackDialog = null }) { Text("إغلاق", color = MovyzaColors.Text3) } }
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

private fun qualityLabel(height: Int): String = when {
    height >= 2160 -> "4K Ultra HD"
    height >= 1440 -> "1440p QHD"
    height >= 1080 -> "1080p Full HD"
    height >= 720 -> "720p HD • مستحسن"
    height >= 576 -> "576p"
    height >= 480 -> "480p"
    height >= 360 -> "360p توفير البيانات"
    else -> "${height}p"
}
