package com.movyza.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.BookmarkAdded
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocalMovies
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.movyza.app.data.EpisodeItem
import com.movyza.app.data.Movie
import com.movyza.app.data.TmdbDetails
import com.movyza.app.data.UserSession
import com.movyza.app.data.WatchHistoryEntry
import com.movyza.app.player.MovyzaPlayerActivity
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

class GlassMovyzaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MovyzaTheme {
                Surface(Modifier.fillMaxSize(), color = MovyzaColors.Bg) {
                    MovyzaNativeApp()
                }
            }
        }
    }
}

private fun launchPlayer(
    context: Context,
    vm: MainViewModel,
    movie: Movie,
    season: Int = 1,
    episode: Int = 1,
    episodeTitle: String? = null
) {
    vm.recordMediaOpened(movie, season, episode)
    val fullTitle = if (movie.mediaType == "series") {
        val base = movie.displayTitle
        val suffix = "S${season} E${episode}" + (episodeTitle?.takeIf { it.isNotBlank() }?.let { " • $it" } ?: "")
        "$base — $suffix"
    } else {
        movie.displayTitle
    }
    context.startActivity(
        Intent(context, MovyzaPlayerActivity::class.java).apply {
            putExtra(MovyzaPlayerActivity.EXTRA_TMDB_ID, movie.id)
            putExtra(MovyzaPlayerActivity.EXTRA_MEDIA_TYPE, movie.mediaType)
            putExtra(MovyzaPlayerActivity.EXTRA_SEASON, season.coerceAtLeast(1))
            putExtra(MovyzaPlayerActivity.EXTRA_EPISODE, episode.coerceAtLeast(1))
            putExtra(MovyzaPlayerActivity.EXTRA_TITLE, fullTitle)
        }
    )
}

@Composable
private fun MovyzaLaunchScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = "MOVYZA",
                color = MovyzaColors.Gold300,
                fontSize = 36.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 5.sp
            )
            Text(
                text = "سينماك تبدأ هنا",
                color = MovyzaColors.Text3,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.height(4.dp))
            CircularProgressIndicator(
                modifier = Modifier.size(22.dp),
                strokeWidth = 2.dp,
                color = MovyzaColors.Gold300
            )
        }
    }
}

@Composable
fun MovyzaNativeApp(vm: MainViewModel = viewModel()) {
    var launchComplete by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        // Draw the lightweight launch surface first, then start network/model work.
        withFrameNanos { }
        vm.startInitialLoad()
        delay(650)
        launchComplete = true
    }

    if (!launchComplete) {
        MovyzaLaunchScreen()
        return
    }

    var tab by remember { mutableStateOf(Tab.HOME) }
    var selected by remember { mutableStateOf<Movie?>(null) }
    var details by remember { mutableStateOf<TmdbDetails?>(null) }
    var detailsLoading by remember { mutableStateOf(false) }
    var authOpen by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf(true) }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val snackbar = remember { SnackbarHostState() }
    val home by vm.home.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val watchlist by vm.watchlist.collectAsStateWithLifecycle()
    val watchHistory by vm.watchHistory.collectAsStateWithLifecycle()

    // Refresh watch history when returning from MovyzaPlayerActivity
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                vm.refreshWatchHistory()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // Handle system Back button when on non-Home tab
    BackHandler(enabled = selected == null && tab != Tab.HOME) {
        tab = Tab.HOME
    }

    if (authOpen) {
        MovyzaAuthDialog(
            login = loginMode,
            loading = vm.loading,
            onDismiss = { authOpen = false },
            onToggle = { loginMode = !loginMode },
            onSubmit = { name, email, password ->
                if (loginMode) {
                    vm.signIn(email, password) { ok, message ->
                        scope.launch { snackbar.showSnackbar(message) }
                        if (ok) authOpen = false
                    }
                } else {
                    vm.signUp(name, email, password) { ok, message ->
                        scope.launch { snackbar.showSnackbar(message) }
                        if (ok && message == "تم إنشاء الحساب") authOpen = false
                    }
                }
            }
        )
    }

    // Root deterministic shell: Column locks MovyzaFixedBottomBar at the bottom edge of the screen
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MovyzaColors.Bg)
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .statusBarsPadding()
            ) {
                AnimatedContent(
                    targetState = tab,
                    modifier = Modifier.fillMaxSize(),
                    transitionSpec = {
                        fadeIn(tween(150)) togetherWith fadeOut(tween(110))
                    },
                    label = "movyza-tab"
                ) { current ->
                    when (current) {
                        Tab.HOME -> MovyzaHomeTemplateScreen(
                            state = home,
                            loading = vm.loading,
                            error = vm.error,
                            watchlist = watchlist,
                            watchHistory = watchHistory,
                            onOpen = { item ->
                                details = null
                                selected = item
                            },
                            onPlay = { item, season, ep ->
                                launchPlayer(context, vm, item, season, ep)
                            },
                            onToggleWatchlist = { item ->
                                if (vm.session == null) {
                                    loginMode = true
                                    authOpen = true
                                } else {
                                    vm.toggleWatchlist(item) { msg ->
                                        scope.launch { snackbar.showSnackbar(msg) }
                                    }
                                }
                            },
                            onSelectTab = { tab = it },
                            onRefresh = { vm.refreshHome() }
                        )

                        Tab.MOVIES -> MovyzaCatalogTemplateScreen(
                            title = "الأفلام",
                            subtitle = "تشكيلة سينمائية منتقاة بجودة عالية",
                            popularItems = home.movies,
                            topRatedItems = home.topRated,
                            loading = vm.loading,
                            loadingMore = vm.loadingMoreMovies,
                            onLoadMore = { vm.loadMoreMovies() },
                            onOpen = { item ->
                                details = null
                                selected = item
                            }
                        )

                        Tab.SERIES -> MovyzaCatalogTemplateScreen(
                            title = "المسلسلات",
                            subtitle = "أقوى المسلسلات الدرامية والعالمية",
                            popularItems = home.series,
                            topRatedItems = home.topRatedSeries.ifEmpty { home.series },
                            loading = vm.loading,
                            loadingMore = vm.loadingMoreSeries,
                            onLoadMore = { vm.loadMoreSeries() },
                            onOpen = { item ->
                                details = null
                                selected = item
                            }
                        )

                        Tab.SEARCH -> MovyzaSearchTemplateScreen(
                            results = search,
                            suggestions = home.trending,
                            loading = vm.searchLoading,
                            onQuery = vm::search,
                            onOpen = { item ->
                                details = null
                                selected = item
                            }
                        )

                        Tab.PROFILE -> MovyzaProfileTemplateScreen(
                            session = vm.session,
                            watchlist = watchlist,
                            watchHistory = watchHistory,
                            onOpen = { item ->
                                details = null
                                selected = item
                            },
                            onResumeHistory = { entry ->
                                launchPlayer(context, vm, entry.toMovie(), entry.season, entry.episode)
                            },
                            onClearHistory = {
                                vm.clearWatchHistory()
                                scope.launch { snackbar.showSnackbar("تم مسح سجل المشاهدة") }
                            },
                            onLogin = {
                                loginMode = true
                                authOpen = true
                            },
                            onSignup = {
                                loginMode = false
                                authOpen = true
                            },
                            onLogout = {
                                vm.signOut()
                                scope.launch { snackbar.showSnackbar("تم تسجيل الخروج") }
                            },
                            onBrowseCatalog = { tab = Tab.MOVIES }
                        )
                    }
                }

                SnackbarHost(
                    hostState = snackbar,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(12.dp)
                )
            }

            // Locked Bottom Bar: Always anchored at the physical bottom of the Column
            MovyzaFixedBottomBar(
                selected = tab,
                onSelect = { newTab ->
                    selected = null
                    details = null
                    tab = newTab
                }
            )
        }

        // Full-Screen Details Overlay
        AnimatedVisibility(
            visible = selected != null,
            enter = fadeIn(tween(170)),
            exit = fadeOut(tween(130))
        ) {
            val currentMovie = selected
            if (currentMovie != null) {
                MovyzaDetailsTemplateScreen(
                    movie = currentMovie,
                    details = details,
                    detailsLoading = detailsLoading,
                    watchlisted = watchlist.any { it.id == currentMovie.id && it.mediaType == currentMovie.mediaType },
                    onBack = {
                        selected = null
                        details = null
                    },
                    onRequestDetails = { target ->
                        detailsLoading = true
                        vm.fetchDetails(target) { loaded ->
                            if (selected?.id == target.id) {
                                details = loaded
                            }
                            detailsLoading = false
                        }
                    },
                    onRequestSeasonEpisodes = { seriesId, seasonNum, callback ->
                        vm.fetchSeasonEpisodes(seriesId, seasonNum, callback)
                    },
                    onWatch = { season, episode, epTitle ->
                        launchPlayer(context, vm, currentMovie, season, episode, epTitle)
                    },
                    onToggleWatchlist = {
                        if (vm.session == null) {
                            loginMode = true
                            authOpen = true
                        } else {
                            vm.toggleWatchlist(currentMovie) { message ->
                                scope.launch { snackbar.showSnackbar(message) }
                            }
                        }
                    },
                    onSelectSimilar = { nextMovie ->
                        details = null
                        selected = nextMovie
                    }
                )
            }
        }
    }
}

/**
 * Custom Fixed Glass Bottom Navigation Bar:
 * Does not use Material3's NavigationBar subcomposition or double windowInsets,
 * guaranteeing it stays 100% locked at the bottom of the screen across all devices.
 */
@Composable
private fun MovyzaFixedBottomBar(
    selected: Tab,
    onSelect: (Tab) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MovyzaColors.GlassStrong)
            .navigationBarsPadding()
    ) {
        HorizontalDivider(thickness = 1.dp, color = MovyzaColors.GlassBorder)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            Tab.entries.forEach { item ->
                val active = selected == item
                val tint by animateColorAsState(
                    targetValue = if (active) MovyzaColors.Gold300 else MovyzaColors.Text3,
                    animationSpec = tween(160),
                    label = "nav-tint"
                )
                val pillBg by animateColorAsState(
                    targetValue = if (active) MovyzaColors.Gold500.copy(alpha = 0.16f) else Color.Transparent,
                    animationSpec = tween(160),
                    label = "nav-bg"
                )

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .padding(horizontal = 3.dp)
                        .clip(MovyzaShapes.Md)
                        .background(pillBg)
                        .then(
                            if (active) Modifier.border(1.dp, MovyzaColors.GoldBorder, MovyzaShapes.Md)
                            else Modifier
                        )
                        .clickable { onSelect(item) },
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            imageVector = when (item) {
                                Tab.HOME -> Icons.Outlined.Home
                                Tab.MOVIES -> Icons.Outlined.LocalMovies
                                Tab.SERIES -> Icons.Outlined.Tv
                                Tab.SEARCH -> Icons.Outlined.Search
                                Tab.PROFILE -> Icons.Outlined.Person
                            },
                            contentDescription = item.label,
                            tint = tint,
                            modifier = Modifier.size(21.dp)
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = item.label,
                            color = tint,
                            fontSize = 11.sp,
                            fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MovyzaHomeTemplateScreen(
    state: HomeState,
    loading: Boolean,
    error: String?,
    watchlist: List<Movie>,
    watchHistory: List<WatchHistoryEntry>,
    onOpen: (Movie) -> Unit,
    onPlay: (Movie, Int, Int) -> Unit,
    onToggleWatchlist: (Movie) -> Unit,
    onSelectTab: (Tab) -> Unit,
    onRefresh: () -> Unit
) {
    val heroCandidates = remember(state.trending) {
        state.trending.take(5)
    }
    var heroIndex by remember { mutableIntStateOf(0) }

    LaunchedEffect(heroCandidates.size) {
        if (heroCandidates.size > 1) {
            while (true) {
                delay(6_500)
                heroIndex = (heroIndex + 1) % heroCandidates.size
            }
        } else {
            heroIndex = 0
        }
    }

    val hero = heroCandidates.getOrNull(heroIndex) ?: state.trending.firstOrNull()
    val heroWatchlisted = hero != null && watchlist.any { it.id == hero.id && it.mediaType == hero.mediaType }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg),
        contentPadding = PaddingValues(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        item(key = "home-header") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "MOVYZA",
                        color = MovyzaColors.Gold300,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Black,
                        letterSpacing = 2.sp
                    )
                    Text(
                        text = "منصة السينما والدراما العربية",
                        color = MovyzaColors.Text3,
                        fontSize = 11.sp
                    )
                }
                GlassIconButton(
                    onClick = { onSelectTab(Tab.SEARCH) },
                    icon = Icons.Outlined.Search,
                    contentDescription = "البحث"
                )
                Spacer(Modifier.width(8.dp))
                GlassIconButton(
                    onClick = { onSelectTab(Tab.PROFILE) },
                    icon = Icons.Outlined.AccountCircle,
                    contentDescription = "حسابي"
                )
            }
        }

        item(key = "home-hero") {
            MovyzaHeroTemplate(
                movie = hero,
                watchlisted = heroWatchlisted,
                heroIndex = heroIndex,
                heroCount = heroCandidates.size,
                onSelectHeroIndex = { heroIndex = it },
                onPlay = { if (hero != null) onPlay(hero, 1, 1) },
                onOpenDetails = { if (hero != null) onOpen(hero) },
                onToggleWatchlist = { if (hero != null) onToggleWatchlist(hero) }
            )
        }

        item(key = "home-quick-pills") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                GlassPill(
                    text = "الأفلام",
                    icon = Icons.Outlined.LocalMovies,
                    onClick = { onSelectTab(Tab.MOVIES) }
                )
                GlassPill(
                    text = "المسلسلات",
                    icon = Icons.Outlined.Tv,
                    onClick = { onSelectTab(Tab.SERIES) }
                )
                GlassPill(
                    text = "البحث السريع",
                    icon = Icons.Outlined.Search,
                    onClick = { onSelectTab(Tab.SEARCH) }
                )
                GlassPill(
                    text = "قائمتي المحفوظة",
                    icon = Icons.Outlined.BookmarkAdded,
                    onClick = { onSelectTab(Tab.PROFILE) }
                )
            }
        }

        if (error != null) {
            item(key = "home-error") {
                NativeErrorBanner(message = error, onRetry = onRefresh)
            }
        }

        if (watchHistory.isNotEmpty()) {
            item(key = "section-continue-watching") {
                Column {
                    SectionHeader(
                        title = "متابعة المشاهدة",
                        subtitle = "استكمل من حيث توقفت",
                        actionLabel = "السجل",
                        onAction = { onSelectTab(Tab.PROFILE) }
                    )
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(
                            count = minOf(watchHistory.size, 10),
                            key = { idx ->
                                val item = watchHistory[idx]
                                "continue-${item.mediaType}-${item.id}"
                            }
                        ) { idx ->
                            val entry = watchHistory[idx]
                            MovyzaContinueWatchingCard(
                                entry = entry,
                                onResume = { onPlay(entry.toMovie(), entry.season, entry.episode) },
                                onDetails = { onOpen(entry.toMovie()) }
                            )
                        }
                    }
                }
            }
        }

        item(key = "section-trending") {
            FixedHorizontalSection(
                sectionId = "trending",
                title = "الأكثر رواجًا هذا الأسبوع",
                subtitle = "عناوين تتصدر المشاهدات الآن",
                movies = state.trending.drop(1),
                loading = loading,
                onOpen = onOpen
            )
        }

        item(key = "section-movies") {
            FixedHorizontalSection(
                sectionId = "movies",
                title = "أفلام شعبية",
                subtitle = "اختيارات سينمائية جاهزة للمشاهدة",
                movies = state.movies,
                loading = loading,
                actionLabel = "عرض الكل",
                onAction = { onSelectTab(Tab.MOVIES) },
                onOpen = onOpen
            )
        }

        item(key = "section-top-rated") {
            FixedHorizontalSection(
                sectionId = "toprated",
                title = "الأعلى تقييمًا",
                subtitle = "أعمال خالدة بتقييمات استثنائية",
                movies = state.topRated,
                loading = loading,
                actionLabel = "عرض الكل",
                onAction = { onSelectTab(Tab.MOVIES) },
                onOpen = onOpen
            )
        }

        item(key = "section-series") {
            FixedHorizontalSection(
                sectionId = "series",
                title = "مسلسلات رائجة",
                subtitle = "حلقات ومواسم كاملة بانتظارك",
                movies = state.series,
                loading = loading,
                actionLabel = "عرض الكل",
                onAction = { onSelectTab(Tab.SERIES) },
                onOpen = onOpen
            )
        }
    }
}

/**
 * Fixed-Slot Horizontal Row:
 * Uses stable slot index keys (`"$sectionId-slot-$index"`) so Jetpack Compose
 * NEVER throws duplicate key crashes during loading and updates existing card slots in-place.
 */
@Composable
private fun FixedHorizontalSection(
    sectionId: String,
    title: String,
    subtitle: String,
    movies: List<Movie>,
    loading: Boolean,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    onOpen: (Movie) -> Unit
) {
    val slotCount = if (movies.isEmpty() && loading) 6 else minOf(movies.size, 14)
    if (slotCount == 0 && !loading) return

    Column {
        SectionHeader(
            title = title,
            subtitle = subtitle,
            actionLabel = actionLabel,
            onAction = onAction
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(
                count = slotCount,
                key = { index -> "$sectionId-slot-$index" }
            ) { index ->
                val movie = movies.getOrNull(index)
                MovyzaPosterCardTemplate(
                    movie = movie,
                    onClick = if (movie != null) ({ onOpen(movie) }) else null,
                    fixedWidth = 138.dp
                )
            }
        }
    }
}

@Composable
private fun MovyzaCatalogTemplateScreen(
    title: String,
    subtitle: String,
    popularItems: List<Movie>,
    topRatedItems: List<Movie>,
    loading: Boolean,
    loadingMore: Boolean,
    onLoadMore: () -> Unit,
    onOpen: (Movie) -> Unit
) {
    var filterIndex by remember { mutableIntStateOf(0) }
    var selectedGenreId by remember { mutableIntStateOf(0) }

    val baseList = if (filterIndex == 0) popularItems else topRatedItems
    val activeList = remember(baseList, selectedGenreId) {
        if (selectedGenreId == 0) baseList
        else baseList.filter { it.genreIds.contains(selectedGenreId) }
    }
    val slotCount = if (activeList.isEmpty() && loading) 8 else activeList.size

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Text(
                text = title,
                color = MovyzaColors.Text,
                fontSize = 26.sp,
                fontWeight = FontWeight.Black
            )
            Text(
                text = subtitle,
                color = MovyzaColors.Text3,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp)
            )
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                GlassPill(
                    text = "الأكثر شعبية",
                    active = filterIndex == 0 && selectedGenreId == 0,
                    onClick = {
                        filterIndex = 0
                        selectedGenreId = 0
                    }
                )
                GlassPill(
                    text = "الأعلى تقييمًا",
                    active = filterIndex == 1 && selectedGenreId == 0,
                    icon = Icons.Outlined.Star,
                    onClick = {
                        filterIndex = 1
                        selectedGenreId = 0
                    }
                )
                GlassPill(
                    text = "أكشن وإثارة",
                    active = selectedGenreId == 28 || selectedGenreId == 10759,
                    onClick = {
                        selectedGenreId = if (title == "المسلسلات") 10759 else 28
                    }
                )
                GlassPill(
                    text = "دراما",
                    active = selectedGenreId == 18,
                    onClick = { selectedGenreId = 18 }
                )
                GlassPill(
                    text = "كوميديا",
                    active = selectedGenreId == 35,
                    onClick = { selectedGenreId = 35 }
                )
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 28.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            items(
                count = slotCount,
                key = { index -> "catalog-$title-$filterIndex-$selectedGenreId-slot-$index" }
            ) { index ->
                val movie = activeList.getOrNull(index)
                MovyzaPosterCardTemplate(
                    movie = movie,
                    onClick = if (movie != null) ({ onOpen(movie) }) else null,
                    fixedWidth = null
                )
            }

            if (activeList.isNotEmpty() && selectedGenreId == 0) {
                item(
                    key = "catalog-load-more-$title",
                    span = { GridItemSpan(maxLineSpan) }
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        if (loadingMore) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(26.dp),
                                strokeWidth = 2.dp,
                                color = MovyzaColors.Gold300
                            )
                        } else {
                            GlassPill(
                                text = "تحميل المزيد من $title",
                                active = true,
                                onClick = onLoadMore
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MovyzaSearchTemplateScreen(
    results: List<Movie>,
    suggestions: List<Movie>,
    loading: Boolean,
    onQuery: (String) -> Unit,
    onOpen: (Movie) -> Unit
) {
    var query by remember { mutableStateOf("") }

    LaunchedEffect(query) {
        if (query.isBlank()) {
            onQuery("")
        } else {
            delay(360)
            onQuery(query)
        }
    }

    val isSearching = query.isNotBlank()
    val listItems = if (isSearching) results.take(30) else suggestions.take(15)
    val slotCount = if (isSearching && listItems.isEmpty() && loading) 5 else listItems.size

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item(key = "search-header") {
            Text(
                text = "البحث الذكي",
                color = MovyzaColors.Text,
                fontSize = 26.sp,
                fontWeight = FontWeight.Black
            )
            Text(
                text = "ابحث عن أي فيلم أو مسلسل بالاسم العربي أو الأجنبي",
                color = MovyzaColors.Text3,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp)
            )
            Spacer(Modifier.height(14.dp))
            GlassCard(
                shape = MovyzaShapes.Md,
                strong = true,
                goldAccent = query.isNotBlank()
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = {
                        Text("اكتب اسم الفيلم أو المسلسل...", color = MovyzaColors.Text3, fontSize = 13.sp)
                    },
                    leadingIcon = {
                        Icon(Icons.Outlined.Search, contentDescription = null, tint = MovyzaColors.Gold300)
                    },
                    trailingIcon = {
                        if (query.isNotEmpty()) {
                            IconButton(onClick = { query = "" }) {
                                Icon(Icons.Outlined.Close, contentDescription = "مسح", tint = MovyzaColors.Text2)
                            }
                        }
                    },
                    singleLine = true,
                    shape = MovyzaShapes.Md,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color.Transparent,
                        unfocusedBorderColor = Color.Transparent,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedTextColor = MovyzaColors.Text,
                        unfocusedTextColor = MovyzaColors.Text
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text)
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = if (isSearching) "نتائج البحث" else "اقتراحات شائعة الآن",
                color = MovyzaColors.Gold300,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )
        }

        if (isSearching && !loading && listItems.isEmpty()) {
            item(key = "search-empty") {
                GlassCard(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 12.dp),
                    shape = MovyzaShapes.Lg
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Outlined.Search,
                            contentDescription = null,
                            tint = MovyzaColors.Gold300,
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "لم نعثر على نتائج مطابقة",
                            color = MovyzaColors.Text,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            "جرّب كتابة الاسم بطريقة أخرى أو باللغة الإنجليزية.",
                            color = MovyzaColors.Text3,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }
            }
        } else {
            items(
                count = slotCount,
                key = { index -> "search-slot-$index" }
            ) { index ->
                val movie = listItems.getOrNull(index)
                MovyzaHorizontalCardTemplate(
                    movie = movie,
                    onClick = if (movie != null) ({ onOpen(movie) }) else null
                )
            }
        }
    }
}

@Composable
private fun MovyzaProfileTemplateScreen(
    session: UserSession?,
    watchlist: List<Movie>,
    watchHistory: List<WatchHistoryEntry>,
    onOpen: (Movie) -> Unit,
    onResumeHistory: (WatchHistoryEntry) -> Unit,
    onClearHistory: () -> Unit,
    onLogin: () -> Unit,
    onSignup: () -> Unit,
    onLogout: () -> Unit,
    onBrowseCatalog: () -> Unit
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item(key = "profile-header") {
            Text(
                text = "مساحتي الخاصة",
                color = MovyzaColors.Text,
                fontSize = 26.sp,
                fontWeight = FontWeight.Black
            )
            Text(
                text = "إدارة حسابك وسجل المشاهدة وقائمتك المحفوظة",
                color = MovyzaColors.Text3,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 2.dp)
            )
        }

        item(key = "profile-card") {
            GlassCard(
                modifier = Modifier.fillMaxWidth(),
                shape = MovyzaShapes.Lg,
                strong = true,
                goldAccent = session != null
            ) {
                Column(Modifier.padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(
                                        listOf(MovyzaColors.Gold300, MovyzaColors.Gold600)
                                    )
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = if (session == null) "M" else session.email.take(1).uppercase(),
                                color = MovyzaColors.Bg,
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Black
                            )
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = session?.email ?: "مرحباً بك في Movyza",
                                color = MovyzaColors.Text,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = if (session == null) {
                                    "سجّل الدخول لحفظ ومزامنة قائمة المشاهدة عبر أجهزتك"
                                } else {
                                    "حساب موفيزا نشط • مزامنة سحابية فورية"
                                },
                                color = MovyzaColors.Text3,
                                fontSize = 11.sp,
                                modifier = Modifier.padding(top = 3.dp)
                            )
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    if (session == null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            GoldButton(
                                text = "تسجيل الدخول",
                                icon = null,
                                onClick = onLogin,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedButton(
                                onClick = onSignup,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(48.dp),
                                shape = MovyzaShapes.Md,
                                border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                            ) {
                                Text("إنشاء حساب", color = MovyzaColors.Text, fontWeight = FontWeight.Bold)
                            }
                        }
                    } else {
                        OutlinedButton(
                            onClick = onLogout,
                            modifier = Modifier.height(44.dp),
                            shape = MovyzaShapes.Md,
                            border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
                        ) {
                            Text("تسجيل الخروج", color = MovyzaColors.Text2, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }

        if (watchHistory.isNotEmpty()) {
            item(key = "profile-history-section") {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = "سجل المشاهدة الأخير",
                                color = MovyzaColors.Text,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.ExtraBold
                            )
                            Text(
                                text = "${watchHistory.size} عنصر تم تشغيله",
                                color = MovyzaColors.Text3,
                                fontSize = 11.sp
                            )
                        }
                        TextButton(onClick = onClearHistory) {
                            Icon(
                                Icons.Outlined.DeleteOutline,
                                contentDescription = null,
                                tint = MovyzaColors.Text3,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text("مسح السجل", color = MovyzaColors.Text3, fontSize = 11.sp)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(
                            count = minOf(watchHistory.size, 10),
                            key = { idx ->
                                val h = watchHistory[idx]
                                "prof-history-${h.mediaType}-${h.id}"
                            }
                        ) { idx ->
                            val entry = watchHistory[idx]
                            MovyzaContinueWatchingCard(
                                entry = entry,
                                onResume = { onResumeHistory(entry) },
                                onDetails = { onOpen(entry.toMovie()) }
                            )
                        }
                    }
                }
            }
        }

        item(key = "watchlist-header") {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "قائمتي المحفوظة",
                        color = MovyzaColors.Text,
                        fontSize = 19.sp,
                        fontWeight = FontWeight.ExtraBold
                    )
                    Text(
                        text = "${watchlist.size} عنوان محفوظ",
                        color = MovyzaColors.Text3,
                        fontSize = 11.sp
                    )
                }
            }
        }

        if (watchlist.isEmpty()) {
            item(key = "watchlist-empty") {
                GlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MovyzaShapes.Lg
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 32.dp, horizontal = 20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Outlined.BookmarkAdd,
                            contentDescription = null,
                            tint = MovyzaColors.Gold300,
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = "قائمتك فارغة حالياً",
                            color = MovyzaColors.Text,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "أضف الأفلام والمسلسلات المفضلة لديك للوصول السريع إليها في أي وقت.",
                            color = MovyzaColors.Text3,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                        Spacer(Modifier.height(14.dp))
                        GlassPill(
                            text = "استكشاف الكتالوج",
                            active = true,
                            onClick = onBrowseCatalog
                        )
                    }
                }
            }
        } else {
            items(
                count = watchlist.size,
                key = { index ->
                    val item = watchlist[index]
                    "watchlist-${item.mediaType}-${item.id}"
                }
            ) { index ->
                val movie = watchlist[index]
                MovyzaHorizontalCardTemplate(
                    movie = movie,
                    onClick = { onOpen(movie) }
                )
            }
        }
    }
}

@Composable
private fun MovyzaDetailsTemplateScreen(
    movie: Movie,
    details: TmdbDetails?,
    detailsLoading: Boolean,
    watchlisted: Boolean,
    onBack: () -> Unit,
    onRequestDetails: (Movie) -> Unit,
    onRequestSeasonEpisodes: (Int, Int, (List<EpisodeItem>) -> Unit) -> Unit,
    onWatch: (season: Int, episode: Int, episodeTitle: String?) -> Unit,
    onToggleWatchlist: () -> Unit,
    onSelectSimilar: (Movie) -> Unit
) {
    BackHandler(onBack = onBack)

    var selectedSeason by remember(movie.id) { mutableIntStateOf(1) }
    var selectedEpisode by remember(movie.id) { mutableIntStateOf(1) }
    var episodes by remember(movie.id) { mutableStateOf<List<EpisodeItem>>(emptyList()) }
    var episodesLoading by remember(movie.id) { mutableStateOf(false) }

    LaunchedEffect(movie.id, movie.mediaType) {
        onRequestDetails(movie)
    }

    val isSeries = movie.mediaType == "series"
    val seasons = details?.seasons.orEmpty()

    LaunchedEffect(movie.id, isSeries, seasons, selectedSeason) {
        if (isSeries) {
            val targetSeason = seasons.firstOrNull { it.seasonNumber == selectedSeason }?.seasonNumber
                ?: seasons.firstOrNull()?.seasonNumber
                ?: 1
            if (targetSeason != selectedSeason) {
                selectedSeason = targetSeason
            }
            episodesLoading = true
            onRequestSeasonEpisodes(movie.id, targetSeason) { loadedEpisodes ->
                episodes = loadedEpisodes
                episodesLoading = false
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MovyzaColors.Bg)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(bottom = 36.dp)
        ) {
            item(key = "detail-hero") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(420.dp)
                        .background(MovyzaColors.SurfaceElevated)
                ) {
                    AsyncImage(
                        model = details?.movie?.backdropUrl ?: movie.backdropUrl ?: movie.posterUrl,
                        contentDescription = movie.displayTitle,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.verticalGradient(
                                    0.0f to Color(0x6604060D),
                                    0.40f to Color.Transparent,
                                    0.76f to Color(0xE604060D),
                                    1.0f to MovyzaColors.Bg
                                )
                            )
                    )

                    Row(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        Box(
                            modifier = Modifier
                                .size(width = 96.dp, height = 140.dp)
                                .clip(MovyzaShapes.Md)
                                .background(MovyzaColors.Bg2)
                                .border(1.dp, MovyzaColors.GlassBorder, MovyzaShapes.Md)
                        ) {
                            AsyncImage(
                                model = movie.posterUrl,
                                contentDescription = movie.displayTitle,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop
                            )
                        }

                        Spacer(Modifier.width(14.dp))

                        Column(Modifier.weight(1f)) {
                            MovyzaBadge(
                                text = if (isSeries) "مسلسل" else "فيلم سينمائي"
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = movie.displayTitle,
                                color = MovyzaColors.Text,
                                fontSize = 23.sp,
                                lineHeight = 29.sp,
                                fontWeight = FontWeight.Black,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(6.dp))
                            val metaParts = listOfNotNull(
                                "★ " + String.format(Locale.US, "%.1f", movie.rating),
                                movie.yearText.takeIf { it.isNotBlank() },
                                details?.runtime?.takeIf { it > 0 }?.let { "$it دقيقة" },
                                if (isSeries && seasons.isNotEmpty()) "${seasons.size} مواسم" else null
                            )
                            Text(
                                text = metaParts.joinToString("  •  "),
                                color = MovyzaColors.Gold300,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                            if (!details?.director.isNullOrBlank()) {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = (if (isSeries) "ابتكار: " else "إخراج: ") + details?.director.orEmpty(),
                                    color = MovyzaColors.Text2,
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }
            }

            item(key = "detail-actions-and-overview") {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                ) {
                    val activeEpObj = episodes.firstOrNull { it.episodeNumber == selectedEpisode }
                    val watchButtonLabel = if (isSeries) {
                        "مشاهدة م$selectedSeason • ح$selectedEpisode"
                    } else {
                        "مشاهدة الفيلم الآن"
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        GoldButton(
                            text = watchButtonLabel,
                            onClick = {
                                onWatch(selectedSeason, selectedEpisode, activeEpObj?.name)
                            },
                            modifier = Modifier.weight(1f)
                        )

                        GlassIconButton(
                            onClick = onToggleWatchlist,
                            icon = if (watchlisted) Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkAdd,
                            contentDescription = "قائمتي",
                            tint = if (watchlisted) MovyzaColors.Gold300 else MovyzaColors.Text,
                            goldBorder = watchlisted,
                            modifier = Modifier.size(48.dp)
                        )
                    }

                    val genres = details?.genres.orEmpty()
                    if (genres.isNotEmpty()) {
                        Spacer(Modifier.height(14.dp))
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            genres.take(5).forEach { genre ->
                                GlassPill(text = genre)
                            }
                        }
                    }

                    details?.tagline?.takeIf { it.isNotBlank() }?.let { tagline ->
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = "«$tagline»",
                            color = MovyzaColors.Gold400,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    Spacer(Modifier.height(12.dp))

                    GlassCard(
                        modifier = Modifier.fillMaxWidth(),
                        shape = MovyzaShapes.Md
                    ) {
                        Column(Modifier.padding(14.dp)) {
                            Text(
                                text = "القصة",
                                color = MovyzaColors.Gold300,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(Modifier.height(6.dp))
                            val overviewText = details?.movie?.overview?.takeIf { it.isNotBlank() }
                                ?: movie.overview.takeIf { it.isNotBlank() }
                                ?: if (detailsLoading) "جارٍ تحميل تفاصيل القصة..." else "لا يتوفر ملخص عربي لهذا العمل حالياً."
                            Text(
                                text = overviewText,
                                color = MovyzaColors.Text2,
                                fontSize = 13.sp,
                                lineHeight = 21.sp
                            )
                        }
                    }
                }
            }

            val castList = details?.cast.orEmpty()
            if (castList.isNotEmpty()) {
                item(key = "detail-cast") {
                    Column(Modifier.padding(top = 6.dp)) {
                        SectionHeader(
                            title = "طاقم التمثيل",
                            subtitle = "أبرز نجوم العمل"
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(
                                count = castList.size,
                                key = { idx -> "cast-${movie.id}-${castList[idx].id}-$idx" }
                            ) { idx ->
                                MovyzaCastBubble(member = castList[idx])
                            }
                        }
                    }
                }
            }

            if (isSeries) {
                item(key = "detail-series-seasons") {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp)
                    ) {
                        SectionHeader(
                            title = "المواسم والحلقات",
                            subtitle = "اختر الموسم والحلقة لبدء المشاهدة فوراً"
                        )

                        if (seasons.isNotEmpty()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState())
                                    .padding(horizontal = 16.dp, vertical = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                seasons.forEach { season ->
                                    GlassPill(
                                        text = "${season.name} (${season.episodeCount})",
                                        active = season.seasonNumber == selectedSeason,
                                        onClick = {
                                            selectedSeason = season.seasonNumber
                                            selectedEpisode = 1
                                        }
                                    )
                                }
                            }
                        }

                        if (episodesLoading) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 20.dp),
                                horizontalArrangement = Arrangement.Center
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    strokeWidth = 2.dp,
                                    color = MovyzaColors.Gold300
                                )
                            }
                        } else {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 6.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                episodes.forEach { ep ->
                                    val isSelectedEp = ep.episodeNumber == selectedEpisode
                                    GlassCard(
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = MovyzaShapes.Md,
                                        goldAccent = isSelectedEp,
                                        onClick = {
                                            selectedEpisode = ep.episodeNumber
                                            onWatch(selectedSeason, ep.episodeNumber, ep.name)
                                        }
                                    ) {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(10.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .size(width = 104.dp, height = 62.dp)
                                                    .clip(MovyzaShapes.Sm)
                                                    .background(MovyzaColors.SurfaceElevated),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                AsyncImage(
                                                    model = ep.stillUrl ?: movie.backdropUrl ?: movie.posterUrl,
                                                    contentDescription = ep.name,
                                                    modifier = Modifier.fillMaxSize(),
                                                    contentScale = ContentScale.Crop
                                                )
                                                Box(
                                                    modifier = Modifier
                                                        .size(28.dp)
                                                        .clip(CircleShape)
                                                        .background(Color(0xB304060D)),
                                                    contentAlignment = Alignment.Center
                                                ) {
                                                    Icon(
                                                        Icons.Outlined.PlayArrow,
                                                        contentDescription = null,
                                                        tint = MovyzaColors.Gold300,
                                                        modifier = Modifier.size(18.dp)
                                                    )
                                                }
                                            }

                                            Spacer(Modifier.width(12.dp))

                                            Column(Modifier.weight(1f)) {
                                                Text(
                                                    text = "الحلقة ${ep.episodeNumber} • ${ep.name}",
                                                    color = if (isSelectedEp) MovyzaColors.Gold300 else MovyzaColors.Text,
                                                    fontSize = 13.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                if (ep.overview.isNotBlank()) {
                                                    Spacer(Modifier.height(3.dp))
                                                    Text(
                                                        text = ep.overview,
                                                        color = MovyzaColors.Text3,
                                                        fontSize = 11.sp,
                                                        lineHeight = 15.sp,
                                                        maxLines = 2,
                                                        overflow = TextOverflow.Ellipsis
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            val similarList = details?.similar.orEmpty()
            if (similarList.isNotEmpty()) {
                item(key = "detail-similar") {
                    Spacer(Modifier.height(14.dp))
                    FixedHorizontalSection(
                        sectionId = "similar-${movie.id}",
                        title = "أعمال مشابهة قد تعجبك",
                        subtitle = "اقتراحات ذات صلة",
                        movies = similarList,
                        loading = false,
                        onOpen = onSelectSimilar
                    )
                }
            }
        }

        // Floating Glass Top Bar respecting Status Bar Insets
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            GlassIconButton(
                onClick = onBack,
                icon = Icons.AutoMirrored.Outlined.ArrowBack,
                contentDescription = "رجوع"
            )
            GlassIconButton(
                onClick = onToggleWatchlist,
                icon = if (watchlisted) Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkAdd,
                contentDescription = "قائمتي",
                tint = if (watchlisted) MovyzaColors.Gold300 else MovyzaColors.Text,
                goldBorder = watchlisted
            )
        }
    }
}

@Composable
private fun NativeErrorBanner(message: String, onRetry: () -> Unit) {
    GlassCard(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = MovyzaShapes.Md
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = message,
                color = Color(0xFFF2A59E),
                fontSize = 12.sp,
                modifier = Modifier.weight(1f)
            )
            TextButton(onClick = onRetry) {
                Icon(
                    Icons.Outlined.Refresh,
                    contentDescription = null,
                    tint = MovyzaColors.Gold300,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(4.dp))
                Text("إعادة المحاولة", color = MovyzaColors.Gold300, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun MovyzaAuthDialog(
    login: Boolean,
    loading: Boolean,
    onDismiss: () -> Unit,
    onToggle: () -> Unit,
    onSubmit: (String, String, String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = MovyzaColors.Bg2,
        shape = MovyzaShapes.Lg,
        title = {
            Text(
                text = if (login) "مرحباً بعودتك" else "انضم إلى Movyza",
                color = MovyzaColors.Text,
                fontWeight = FontWeight.Black,
                fontSize = 20.sp
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!login) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("الاسم") },
                        singleLine = true,
                        shape = MovyzaShapes.Sm,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريد الإلكتروني") },
                    singleLine = true,
                    shape = MovyzaShapes.Sm,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("كلمة المرور") },
                    singleLine = true,
                    shape = MovyzaShapes.Sm,
                    modifier = Modifier.fillMaxWidth(),
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                imageVector = if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                contentDescription = "إظهار كلمة المرور",
                                tint = MovyzaColors.Text3
                            )
                        }
                    }
                )
                TextButton(onClick = onToggle) {
                    Text(
                        text = if (login) "ليس لديك حساب؟ إنشاء حساب جديد" else "لديك حساب بالفعل؟ تسجيل الدخول",
                        color = MovyzaColors.Gold300,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !loading && email.isNotBlank() && password.length >= 6,
                onClick = { onSubmit(name, email, password) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MovyzaColors.Gold400,
                    contentColor = MovyzaColors.Bg
                ),
                shape = MovyzaShapes.Sm
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MovyzaColors.Bg
                    )
                } else {
                    Text(if (login) "دخول" else "إنشاء الحساب", fontWeight = FontWeight.Bold)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("إلغاء", color = MovyzaColors.Text3)
            }
        }
    )
}
