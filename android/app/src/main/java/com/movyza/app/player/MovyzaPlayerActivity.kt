package com.movyza.app.player

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.C
import androidx.media3.common.MediaItem
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.Locale
import kotlin.math.abs

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
    private var warmupDone = false
    private var defaultQualityApplied = false
    private var progressJob: Job? = null
    private var lastPositionSave = 0L

    private var position by mutableLongStateOf(0L)
    private var duration by mutableLongStateOf(0L)
    private var buffered by mutableLongStateOf(0L)
    private var playing by mutableStateOf(false)
    private var buffering by mutableStateOf(true)
    private var error by mutableStateOf<String?>(null)
    private var qualities by mutableStateOf<List<Int>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        trackSelector = DefaultTrackSelector(this).apply {
            setParameters(buildUponParameters().setMaxVideoSize(3840, 2160).build())
        }

        player = ExoPlayer.Builder(this)
            .setTrackSelector(trackSelector)
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(15_000, 50_000, 1_000, 2_500)
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
                            restoreProgressOrWarmup()
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

            override fun onPlayerError(playerError: androidx.media3.common.PlaybackException) {
                buffering = false
                if (sourceIndex + 1 < sources.size) {
                    sourceIndex += 1
                    prepareSource(sources[sourceIndex])
                } else {
                    error = "تعذر تشغيل المصدر الحالي."
                }
            }
        })

        setContent {
            MovyzaPlayerScreen(
                title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "MOVYZA" },
                player = player,
                position = position,
                duration = duration,
                buffered = buffered,
                playing = playing,
                buffering = buffering,
                error = error,
                qualities = qualities,
                onClose = { finish() },
                onSeek = { player.seekTo(it.coerceIn(0L, duration)) },
                onTogglePlay = { if (player.isPlaying) player.pause() else player.play() },
                onSkip = { delta -> player.seekTo((player.currentPosition + delta).coerceIn(0L, duration)) },
                onQuality = { selectQuality(it) }
            )
        }

        lifecycleScope.launch { resolveAndStart() }

        progressJob = lifecycleScope.launch {
            while (isActive) {
                delay(500)
                position = player.currentPosition.coerceAtLeast(0L)
                duration = player.duration.coerceAtLeast(0L)
                buffered = player.bufferedPosition.coerceAtLeast(0L)
                if (player.currentPosition - lastPositionSave >= 5_000L) saveProgress(false)
            }
        }
    }

    private suspend fun resolveAndStart() {
        val directUrl = intent.getStringExtra(EXTRA_SOURCE_URL)?.trim().orEmpty()
        sources = if (directUrl.isNotBlank()) {
            listOf(PlaybackCandidate(directUrl))
        } else {
            val request = PlaybackRequest(
                tmdbId = intent.getIntExtra(EXTRA_TMDB_ID, 0),
                mediaType = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty().ifBlank { "movie" },
                season = intent.getIntExtra(EXTRA_SEASON, 1),
                episode = intent.getIntExtra(EXTRA_EPISODE, 1)
            )
            runCatching { MovyzaPlaybackRepository.resolve(request) }
                .getOrElse {
                    error = it.message ?: "لم نتمكن من تجهيز المصدر."
                    emptyList()
                }
        }

        if (sources.isEmpty()) return

        sourceIndex = 0
        firstReady = true
        warmupDone = false
        defaultQualityApplied = false
        prepareSource(sources.first())
    }

    private fun prepareSource(source: PlaybackCandidate) {
        error = null
        buffering = true

        val http = DefaultHttpDataSource.Factory()
            .setConnectTimeoutMs(10_000)
            .setReadTimeoutMs(20_000)
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("Movyza/2.0 Android")
            .setDefaultRequestProperties(source.headers)

        val mediaSource = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http))
            .createMediaSource(
                MediaItem.Builder().setUri(source.url).setTag(source).build()
            )

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

        if (!defaultQualityApplied && heights.isNotEmpty()) {
            defaultQualityApplied = true
            selectQuality(heights.minByOrNull { abs(it - 720) } ?: heights.first())
        }
    }

    private fun selectQuality(height: Int) {
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

    private fun restoreProgressOrWarmup() {
        val saved = getPreferences(MODE_PRIVATE).getLong(progressKey(), 0L)
        val length = player.duration.coerceAtLeast(0L)

        if (saved > 15_000L && saved < length - 15_000L) {
            player.seekTo(saved)
            player.play()
            return
        }

        if (!warmupDone && length > 180_000L) {
            warmupDone = true
            val original = player.currentPosition
            val warmupTarget = minOf(120_000L, length - 15_000L).coerceAtLeast(1_000L)
            player.seekTo(warmupTarget)
            lifecycleScope.launch {
                delay(260)
                if (!isFinishing) {
                    player.seekTo(original)
                    player.play()
                }
            }
        }
    }

    private fun progressKey(): String {
        val type = intent.getStringExtra(EXTRA_MEDIA_TYPE).orEmpty()
        val id = intent.getIntExtra(EXTRA_TMDB_ID, 0)
        val season = intent.getIntExtra(EXTRA_SEASON, 0)
        val episode = intent.getIntExtra(EXTRA_EPISODE, 0)
        return "progress:" + type + ":" + id + ":" + season + ":" + episode
    }

    private fun saveProgress(force: Boolean) {
        val current = player.currentPosition.coerceAtLeast(0L)
        if (!force && current - lastPositionSave < 5_000L) return
        lastPositionSave = current
        getPreferences(MODE_PRIVATE).edit().putLong(progressKey(), current).apply()
    }

    override fun onPause() {
        saveProgress(true)
        super.onPause()
    }

    override fun onDestroy() {
        progressJob?.cancel()
        player.release()
        super.onDestroy()
    }
}

@Composable
private fun MovyzaPlayerScreen(
    title: String,
    player: ExoPlayer,
    position: Long,
    duration: Long,
    buffered: Long,
    playing: Boolean,
    buffering: Boolean,
    error: String?,
    qualities: List<Int>,
    onClose: () -> Unit,
    onSeek: (Long) -> Unit,
    onTogglePlay: () -> Unit,
    onSkip: (Long) -> Unit,
    onQuality: (Int) -> Unit,
) {
    if (LocalInspectionMode.current) return

    var controls by remember { mutableStateOf(true) }
    var showQuality by remember { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(1f) }
    val density = LocalDensity.current

    BackHandler(onBack = onClose)

    LaunchedEffect(controls, playing) {
        if (controls && playing) {
            delay(3_000)
            controls = false
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { controls = !controls },
                    onDoubleTap = { offset ->
                        val center = density.density * 180f
                        onSkip(if (offset.x < center) -10_000L else 10_000L)
                    }
                )
            }
    ) {
        AndroidView(
            factory = { context ->
                PlayerView(context).apply {
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                    this.player = player
                    setBackgroundColor(android.graphics.Color.BLACK)
                }
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

        if (buffering) {
            Surface(
                Modifier.align(Alignment.Center),
                shape = CircleShape,
                color = Color.Black.copy(alpha = .45f)
            ) {
                Text("•", color = Color(0xFFF4D88C), fontSize = 34.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp))
            }
        }

        if (controls) {
            Column(
                Modifier.fillMaxSize().background(Color.Black.copy(alpha = .16f))
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(shape = CircleShape, color = Color.Black.copy(alpha = .44f)) {
                        IconButton(onClick = onClose) {
                            Icon(Icons.Default.Close, "إغلاق", tint = Color.White)
                        }
                    }

                    Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                        Text(title, color = Color.White, fontSize = 15.sp, maxLines = 1)
                        Text("MOVYZA PLAYER", color = Color(0xFFF4D88C), fontSize = 8.sp)
                    }

                    Surface(shape = RoundedCornerShape(12.dp), color = Color.Black.copy(alpha = .42f)) {
                        TextButton(onClick = { showQuality = true }) {
                            val qualityText = if (qualities.isEmpty()) "جودة"
                            else qualityLabel(qualities.minByOrNull { abs(it - 720) } ?: 720)
                            Text(qualityText, color = Color(0xFFF4D88C), fontSize = 11.sp)
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { onSkip(-10_000L) }) {
                        Icon(Icons.Default.FastRewind, null, tint = Color.White, modifier = Modifier.size(32.dp))
                    }

                    Surface(Modifier.size(68.dp), shape = CircleShape, color = Color(0xFFD9B65D)) {
                        IconButton(onClick = onTogglePlay) {
                            Icon(
                                if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                                null,
                                tint = Color.Black,
                                modifier = Modifier.size(33.dp)
                            )
                        }
                    }

                    IconButton(onClick = { onSkip(10_000L) }) {
                        Icon(Icons.Default.FastForward, null, tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                }

                Spacer(Modifier.weight(1f))

                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(formatTime(position), color = Color.White, fontSize = 10.sp)
                        Spacer(Modifier.weight(1f))
                        Text(formatTime(duration), color = Color.White.copy(alpha = .68f), fontSize = 10.sp)
                    }

                    Slider(
                        value = position.toFloat().coerceIn(0f, duration.coerceAtLeast(1L).toFloat()),
                        onValueChange = { onSeek(it.toLong()) },
                        valueRange = 0f..duration.coerceAtLeast(1L).toFloat()
                    )

                    if (buffered > position && duration > 0L) {
                        Text(
                            (100 * buffered.toFloat() / duration.toFloat()).toInt().toString() + "% buffered",
                            color = Color.White.copy(alpha = .45f),
                            fontSize = 7.sp
                        )
                    }
                }
            }
        }

        if (error != null) {
            Surface(
                Modifier.align(Alignment.Center).fillMaxWidth().padding(horizontal = 30.dp),
                shape = RoundedCornerShape(22.dp),
                color = Color(0xE016120E)
            ) {
                Column(Modifier.padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error, color = Color.White, fontSize = 14.sp)
                    Spacer(Modifier.height(7.dp))
                    Text("تأكد من وجود مصدر مباشر صالح.", color = Color(0xFFA29A8F), fontSize = 10.sp)
                    Spacer(Modifier.height(10.dp))
                    TextButton(onClick = onClose) {
                        Text("رجوع", color = Color(0xFFF4D88C))
                    }
                }
            }
        }
    }

    if (showQuality) {
        AlertDialog(
            onDismissRequest = { showQuality = false },
            containerColor = Color(0xFF0F0D0A),
            title = { Text("جودة التشغيل", color = Color.White) },
            text = {
                Column {
                    qualities.distinct().sortedDescending().forEach { height ->
                        TextButton(
                            onClick = {
                                onQuality(height)
                                showQuality = false
                            }
                        ) {
                            Text(
                                qualityLabel(height),
                                color = if (height == 720) Color(0xFFF4D88C) else Color.White
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showQuality = false }) {
                    Text("إغلاق", color = Color(0xFFA29A8F))
                }
            }
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
    height >= 2160 -> "4K"
    height >= 1440 -> "1440p"
    height >= 1080 -> "1080p"
    height >= 720 -> "720p • المفضلة"
    height >= 576 -> "576p"
    height >= 480 -> "480p"
    height >= 360 -> "360p"
    else -> height.toString() + "p"
}
