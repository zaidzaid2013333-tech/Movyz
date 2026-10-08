package com.movyza.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.BookmarkAdded
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.LocalMovies
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.movyza.app.data.Movie
import com.movyza.app.data.MovyzaApi
import com.movyza.app.data.TmdbDetails
import com.movyza.app.data.UserSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Gold = Color(0xFFE0BE68)
private val GoldBright = Color(0xFFF7E0A0)
private val GoldDeep = Color(0xFF9F7831)
private val Black = Color(0xFF040404)
private val Ink = Color(0xFF090806)
private val Surface1 = Color(0xFF0E0D0B)
private val Surface2 = Color(0xFF17140F)
private val TextMain = Color(0xFFF5F1E9)
private val TextMuted = Color(0xFFA9A097)
private val TextFaint = Color(0xFF6C665E)

private val PremiumScheme = darkColorScheme(
    primary = GoldBright,
    secondary = Gold,
    tertiary = GoldDeep,
    background = Black,
    surface = Surface1,
    surfaceVariant = Surface2,
    onPrimary = Ink,
    onBackground = TextMain,
    onSurface = TextMain
)

class PremiumActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = PremiumScheme) {
                Surface(Modifier.fillMaxSize(), color = Black) {
                    PremiumMovyzaApp()
                }
            }
        }
    }
}

@Composable
private fun PremiumMovyzaApp(vm: MainViewModel = androidx.lifecycle.viewmodel.compose.viewModel()) {
    var tab by remember { mutableStateOf(Tab.HOME) }
    var selected by remember { mutableStateOf<Movie?>(null) }
    var details by remember { mutableStateOf<TmdbDetails?>(null) }
    var authOpen by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf(true) }

    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val home by vm.home.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val watchlist by vm.watchlist.collectAsStateWithLifecycle()

    if (authOpen) {
        PremiumAuthDialog(
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

    Scaffold(
        containerColor = Black,
        contentWindowInsets = WindowInsets.safeDrawing,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            PremiumNav(
                selected = tab,
                onSelect = { tab = it }
            )
        }
    ) { padding ->
        AnimatedContent(
            targetState = tab,
            modifier = Modifier
                .fillMaxSize()
                .padding(top = padding.calculateTopPadding()),
            transitionSpec = {
                val dir = if (targetState.ordinal >= initialState.ordinal) 1 else -1
                (
                    slideInHorizontally(tween(260, easing = FastOutSlowInEasing)) { dir * it / 8 } +
                        fadeIn(tween(180))
                    ) togetherWith (
                    slideOutHorizontally(tween(210)) { -dir * it / 9 } +
                        fadeOut(tween(120))
                    )
            },
            label = "premium-tab"
        ) { current ->
            when (current) {
                Tab.HOME -> PremiumHome(
                    state = home,
                    loading = vm.loading,
                    error = vm.error,
                    onOpen = { selected = it },
                    onSearch = { tab = Tab.SEARCH },
                    onProfile = { tab = Tab.PROFILE }
                )
                Tab.MOVIES -> PremiumCatalog(
                    title = "أفلام مختارة",
                    subtitle = "اختيارات قوية لليلة المشاهدة",
                    movies = home.movies,
                    loading = vm.loading,
                    onOpen = { selected = it }
                )
                Tab.SERIES -> PremiumCatalog(
                    title = "مسلسلات",
                    subtitle = "عناوين تستحق جلسة طويلة",
                    movies = home.series,
                    loading = vm.loading,
                    onOpen = { selected = it }
                )
                Tab.SEARCH -> PremiumSearch(
                    results = search,
                    loading = vm.loading,
                    onQuery = vm::search,
                    onOpen = { selected = it }
                )
                Tab.PROFILE -> PremiumProfile(
                    session = vm.session,
                    watchlist = watchlist,
                    onOpen = { selected = it },
                    onLogin = { loginMode = true; authOpen = true },
                    onSignup = { loginMode = false; authOpen = true },
                    onLogout = vm::signOut
                )
            }
        }
    }

    AnimatedVisibility(
        visible = selected != null,
        enter = fadeIn(tween(180)),
        exit = fadeOut(tween(120))
    ) {
        selected?.let { movie ->
            PremiumDetails(
                movie = movie,
                details = details,
                watchlisted = watchlist.any { it.id == movie.id && it.mediaType == movie.mediaType },
                onBack = { selected = null; details = null },
                onLoad = {
                    scope.launch {
                        runCatching { MovyzaApi().details(movie.id, movie.mediaType) }
                            .onSuccess { details = it }
                    }
                },
                onWatch = {
                    scope.launch {
                        snackbar.showSnackbar("واجهة المشغل أصبحت نقطة الربط التالية")
                    }
                },
                onToggleWatchlist = {
                    vm.toggleWatchlist(movie) { message ->
                        scope.launch { snackbar.showSnackbar(message) }
                    }
                }
            )
        }
    }
}

@Composable
private fun PremiumNav(selected: Tab, onSelect: (Tab) -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 12.dp, vertical = 9.dp)
            .shadow(22.dp, RoundedCornerShape(25.dp)),
        shape = RoundedCornerShape(25.dp),
        color = Color(0xEF100E0B),
        tonalElevation = 0.dp
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Tab.values().forEach { item ->
                val active = item == selected
                val tint by animateColorAsState(
                    targetValue = if (active) GoldBright else TextMuted,
                    animationSpec = tween(220),
                    label = "nav-color"
                )
                val scale by animateFloatAsState(
                    targetValue = if (active) 1f else .94f,
                    animationSpec = tween(220, easing = FastOutSlowInEasing),
                    label = "nav-scale"
                )
                Box(
                    Modifier
                        .weight(1f)
                        .height(54.dp)
                        .padding(horizontal = 3.dp)
                        .clip(RoundedCornerShape(17.dp))
                        .background(if (active) Gold.copy(alpha = .10f) else Color.Transparent)
                        .clickable { onSelect(item) },
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
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
                            modifier = Modifier.size((21f * scale).dp)
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            item.label,
                            color = tint,
                            fontSize = 9.sp,
                            fontWeight = if (active) FontWeight.Bold else FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PremiumHome(
    state: HomeState,
    loading: Boolean,
    error: String?,
    onOpen: (Movie) -> Unit,
    onSearch: () -> Unit,
    onProfile: () -> Unit
) {
    var heroIndex by remember { mutableStateOf(0) }
    val heroes = remember(state.trending) {
        state.trending.filter { !it.backdropUrl.isNullOrBlank() }.take(5)
    }

    LaunchedEffect(heroes.size) {
        if (heroes.isNotEmpty()) {
            while (true) {
                delay(6200)
                heroIndex = (heroIndex + 1) % heroes.size
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().background(Black),
        contentPadding = PaddingValues(bottom = 124.dp)
    ) {
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 12.dp, top = 16.dp, bottom = 9.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "MOVYZA",
                        color = GoldBright,
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Black,
                        letterSpacing = 4.sp
                    )
                    Text(
                        "Cinema, reimagined.",
                        color = TextFaint,
                        fontSize = 10.sp,
                        letterSpacing = 1.4.sp
                    )
                }
                PremiumIconButton(Icons.Outlined.Search, onSearch)
                Spacer(Modifier.width(4.dp))
                PremiumIconButton(Icons.Outlined.AccountCircle, onProfile)
            }
        }

        item {
            if (heroes.isNotEmpty()) {
                AnimatedContent(
                    targetState = heroes.getOrNull(heroIndex) ?: heroes.first(),
                    transitionSpec = { fadeIn(tween(560)) togetherWith fadeOut(tween(340)) },
                    label = "hero-cycle"
                ) { hero ->
                    PremiumHero(movie = hero, onOpen = { onOpen(hero) })
                }
            } else {
                PremiumHeroSkeleton()
            }
        }

        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 18.dp, vertical = 15.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                PremiumChip("أفلام", Icons.Outlined.LocalMovies, onSearch)
                PremiumChip("مسلسلات", Icons.Outlined.Tv, onSearch)
                PremiumChip("تقييمات", Icons.Outlined.Tune, onSearch)
                PremiumChip("قائمتي", Icons.Outlined.BookmarkAdded, onProfile)
            }
        }

        if (error != null) item { PremiumError(message = error) }

        if (loading && state.movies.isEmpty()) {
            item { PremiumHomeSkeletons() }
        } else {
            item { PremiumSection("الآن على Movyza", state.trending.drop(1), onOpen, "رائج الآن") }
            item { PremiumSection("اختيارات لك", state.movies, onOpen, "أفلام") }
            item { PremiumSection("الأعلى تقييمًا", state.topRated, onOpen, "موثوق") }
            item { PremiumSection("جلسة مسلسلات", state.series, onOpen, "مسلسلات") }
        }
    }
}

@Composable
private fun PremiumIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Surface(
        Modifier.size(42.dp),
        shape = CircleShape,
        color = Surface2
    ) {
        IconButton(onClick = onClick) {
            Icon(icon, null, tint = TextMain, modifier = Modifier.size(19.dp))
        }
    }
}

@Composable
private fun PremiumHero(movie: Movie, onOpen: () -> Unit) {
    val pulse = rememberInfiniteTransition(label = "hero-light")
    val glow by pulse.animateFloat(
        .14f,
        .28f,
        infiniteRepeatable(tween(2100), RepeatMode.Reverse),
        label = "hero-glow"
    )

    Box(
        Modifier
            .fillMaxWidth()
            .height(474.dp)
            .padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(30.dp))
            .clickable(onClick = onOpen)
    ) {
        AsyncImage(
            model = movie.backdropUrl ?: movie.posterUrl,
            contentDescription = movie.title,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )

        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    .30f to Color.Transparent,
                    .58f to Black.copy(alpha = .10f),
                    .76f to Black.copy(alpha = .76f),
                    1f to Black.copy(alpha = .99f)
                )
            )
        )

        Box(
            Modifier.fillMaxSize().background(
                Brush.radialGradient(
                    listOf(Gold.copy(alpha = glow), Color.Transparent),
                    radius = 900f
                )
            )
        )

        Column(
            Modifier
                .align(Alignment.BottomStart)
                .padding(22.dp)
        ) {
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = Gold.copy(alpha = .15f)
            ) {
                Text(
                    "FEATURED",
                    color = GoldBright,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Black,
                    letterSpacing = 1.6.sp,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                )
            }

            Spacer(Modifier.height(10.dp))

            Text(
                movie.title.ifBlank { movie.originalTitle },
                color = Color.White,
                fontSize = 31.sp,
                lineHeight = 35.sp,
                fontWeight = FontWeight.Black,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "★ " + String.format("%.1f", movie.rating),
                    color = GoldBright,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
                PremiumDot()
                Text(movie.releaseDate.take(4).ifBlank { "2026" }, color = Color.White.copy(alpha = .78f), fontSize = 12.sp)
                PremiumDot()
                Text(
                    if (movie.mediaType == "series") "مسلسل" else "فيلم",
                    color = Color.White.copy(alpha = .78f),
                    fontSize = 12.sp
                )
            }

            Spacer(Modifier.height(8.dp))

            Text(
                movie.overview.ifBlank { "اكتشف التفاصيل وشاهد هذا العنوان ضمن تجربة Movyza." },
                color = Color.White.copy(alpha = .78f),
                fontSize = 12.sp,
                lineHeight = 18.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Button(
                    onClick = onOpen,
                    modifier = Modifier.height(45.dp),
                    shape = RoundedCornerShape(14.dp),
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GoldBright,
                        contentColor = Ink
                    )
                ) {
                    Icon(Icons.Outlined.PlayArrow, null, modifier = Modifier.size(19.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("التفاصيل", fontWeight = FontWeight.Black)
                }

                OutlinedButton(
                    onClick = onOpen,
                    modifier = Modifier.height(45.dp),
                    shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, Color.White.copy(alpha = .25f)),
                    contentPadding = PaddingValues(horizontal = 15.dp)
                ) {
                    Icon(Icons.Outlined.BookmarkAdd, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("قائمتي")
                }
            }
        }

        Surface(
            Modifier.align(Alignment.TopEnd).padding(16.dp),
            shape = RoundedCornerShape(11.dp),
            color = Color.Black.copy(alpha = .46f)
        ) {
            Text(
                "MOVYZA",
                color = Color.White,
                fontSize = 8.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 1.sp,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
            )
        }
    }
}

@Composable
private fun PremiumDot() {
    Box(
        Modifier
            .padding(horizontal = 8.dp)
            .size(3.dp)
            .clip(CircleShape)
            .background(Gold)
    )
}

@Composable
private fun PremiumChip(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Surface(
        Modifier.clip(RoundedCornerShape(999.dp)).clickable(onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = Surface2
    ) {
        Row(
            Modifier.padding(horizontal = 13.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, null, tint = GoldBright, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, color = TextMain, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PremiumSection(
    title: String,
    movies: List<Movie>,
    onOpen: (Movie) -> Unit,
    tag: String
) {
    if (movies.isEmpty()) return

    Column(Modifier.padding(top = 7.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, color = TextMain, fontSize = 19.sp, fontWeight = FontWeight.Black)
                Text(tag, color = TextFaint, fontSize = 10.sp, letterSpacing = .8.sp)
            }
            Text("استكشف", color = GoldBright, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(11.dp)
        ) {
            items(movies.take(12), key = { it.mediaType + "-" + it.id }) { movie ->
                PremiumPoster(movie, onOpen)
            }
        }
    }
}

@Composable
private fun PremiumPoster(movie: Movie, onOpen: (Movie) -> Unit) {
    Column(
        Modifier.width(122.dp).clickable { onOpen(movie) }
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(.66f).clip(RoundedCornerShape(17.dp)).background(Surface1)
        ) {
            AsyncImage(
                model = movie.posterUrl,
                contentDescription = movie.title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        0f to Color.Transparent,
                        .64f to Color.Transparent,
                        1f to Color.Black.copy(alpha = .80f)
                    )
                )
            )
            Surface(
                Modifier.align(Alignment.TopEnd).padding(7.dp),
                shape = RoundedCornerShape(8.dp),
                color = Color.Black.copy(alpha = .55f)
            ) {
                Text(
                    "★ " + String.format("%.1f", movie.rating),
                    color = GoldBright,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 5.dp)
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            movie.title.ifBlank { movie.originalTitle },
            color = TextMain,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 15.sp
        )
        Text(
            if (movie.mediaType == "series") "مسلسل" else movie.releaseDate.take(4),
            color = TextFaint,
            fontSize = 9.sp,
            modifier = Modifier.padding(top = 3.dp)
        )
    }
}

@Composable
private fun PremiumCatalog(
    title: String,
    subtitle: String,
    movies: List<Movie>,
    loading: Boolean,
    onOpen: (Movie) -> Unit
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.fillMaxSize().background(Black),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 124.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)
    ) {
        item(span = { GridItemSpan(2) }) {
            Column(Modifier.padding(bottom = 2.dp)) {
                Text(title, color = TextMain, fontSize = 29.sp, fontWeight = FontWeight.Black)
                Text(subtitle, color = TextFaint, fontSize = 11.sp)
                if (loading) {
                    Spacer(Modifier.height(10.dp))
                    PremiumLoading()
                }
            }
        }
        items(movies, key = { it.mediaType + "-" + it.id }) { movie ->
            PremiumGridCard(movie, onOpen)
        }
    }
}

@Composable
private fun PremiumGridCard(movie: Movie, onOpen: (Movie) -> Unit) {
    Column(Modifier.fillMaxWidth().clickable { onOpen(movie) }) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(.67f).clip(RoundedCornerShape(18.dp)).background(Surface1)
        ) {
            AsyncImage(
                model = movie.posterUrl,
                contentDescription = movie.title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            Surface(
                Modifier.align(Alignment.TopStart).padding(8.dp),
                shape = RoundedCornerShape(8.dp),
                color = Color.Black.copy(alpha = .52f)
            ) {
                Text(
                    "★ " + String.format("%.1f", movie.rating),
                    color = GoldBright,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 5.dp)
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            movie.title.ifBlank { movie.originalTitle },
            color = TextMain,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 15.sp
        )
        Text(
            if (movie.mediaType == "series") "مسلسل" else "فيلم",
            color = TextFaint,
            fontSize = 9.sp,
            modifier = Modifier.padding(top = 3.dp)
        )
    }
}

@Composable
private fun PremiumSearch(
    results: List<Movie>,
    loading: Boolean,
    onQuery: (String) -> Unit,
    onOpen: (Movie) -> Unit
) {
    var query by remember { mutableStateOf("") }

    LaunchedEffect(query) {
        delay(420)
        onQuery(query)
    }

    LazyColumn(
        Modifier.fillMaxSize().background(Black),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 21.dp, bottom = 124.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp)
    ) {
        item {
            Text("اكتشف", color = TextMain, fontSize = 31.sp, fontWeight = FontWeight.Black)
            Text("فيلم، مسلسل، ممثل أو عنوان في بالك.", color = TextFaint, fontSize = 11.sp)
            Spacer(Modifier.height(14.dp))
            Surface(shape = RoundedCornerShape(18.dp), color = Surface2) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("اكتب ما تبحث عنه…", color = TextFaint) },
                    leadingIcon = { Icon(Icons.Outlined.Search, null, tint = GoldBright) },
                    singleLine = true,
                    shape = RoundedCornerShape(18.dp),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Gold.copy(alpha = .75f),
                        unfocusedBorderColor = Color.Transparent,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text)
                )
            }
            if (loading) {
                Spacer(Modifier.height(10.dp))
                PremiumLoading()
            }
        }

        items(results.take(30), key = { it.mediaType + "-" + it.id }) { movie ->
            PremiumSearchRow(movie, onOpen)
        }
    }
}

@Composable
private fun PremiumSearchRow(movie: Movie, onOpen: (Movie) -> Unit) {
    Surface(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable { onOpen(movie) },
        shape = RoundedCornerShape(18.dp),
        color = Surface1
    ) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            AsyncImage(
                model = movie.posterUrl,
                contentDescription = movie.title,
                modifier = Modifier.size(74.dp, 102.dp).clip(RoundedCornerShape(13.dp)),
                contentScale = ContentScale.Crop
            )
            Column(Modifier.padding(start = 12.dp, end = 8.dp).weight(1f)) {
                Text(
                    movie.title.ifBlank { movie.originalTitle },
                    color = TextMain,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    listOfNotNull(
                        movie.releaseDate.takeIf { it.length >= 4 }?.take(4),
                        if (movie.mediaType == "series") "مسلسل" else "فيلم",
                        "★ " + String.format("%.1f", movie.rating)
                    ).joinToString("  •  "),
                    color = GoldBright,
                    fontSize = 10.sp
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    movie.overview,
                    color = TextMuted,
                    fontSize = 10.sp,
                    lineHeight = 14.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun PremiumProfile(
    session: UserSession?,
    watchlist: List<Movie>,
    onOpen: (Movie) -> Unit,
    onLogin: () -> Unit,
    onSignup: () -> Unit,
    onLogout: () -> Unit
) {
    LazyColumn(
        Modifier.fillMaxSize().background(Black),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 124.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text("مساحتي", color = TextMain, fontSize = 31.sp, fontWeight = FontWeight.Black)
            Text("حسابك وقائمتك وتجربتك في مكان واحد.", color = TextFaint, fontSize = 11.sp)
        }

        item {
            Surface(shape = RoundedCornerShape(24.dp), color = Surface2) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Box(
                        Modifier.size(58.dp).clip(CircleShape).background(
                            Brush.linearGradient(listOf(GoldBright, GoldDeep))
                        ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            if (session == null) "M" else session.email.take(1).uppercase(),
                            color = Ink,
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                    Spacer(Modifier.height(13.dp))
                    if (session == null) {
                        Text("أهلاً بك في Movyza", color = TextMain, fontSize = 20.sp, fontWeight = FontWeight.Black)
                        Spacer(Modifier.height(4.dp))
                        Text("سجّل الدخول لمزامنة قائمتك عبر Supabase.", color = TextMuted, fontSize = 11.sp)
                        Spacer(Modifier.height(15.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = onLogin,
                                shape = RoundedCornerShape(13.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = GoldBright,
                                    contentColor = Ink
                                )
                            ) {
                                Text("تسجيل الدخول", fontWeight = FontWeight.Bold)
                            }
                            OutlinedButton(onClick = onSignup, shape = RoundedCornerShape(13.dp)) {
                                Text("إنشاء حساب")
                            }
                        }
                    } else {
                        Text(session.email, color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.Black)
                        Text("حساب Movyza • Supabase", color = TextMuted, fontSize = 11.sp)
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = onLogout, shape = RoundedCornerShape(13.dp)) {
                            Text("تسجيل الخروج")
                        }
                    }
                }
            }
        }

        item {
            Column {
                Text("قائمتي", color = TextMain, fontSize = 21.sp, fontWeight = FontWeight.Black)
                Text(watchlist.size.toString() + " عنوان محفوظ", color = TextFaint, fontSize = 10.sp)
            }
        }

        if (watchlist.isEmpty()) {
            item {
                Surface(shape = RoundedCornerShape(20.dp), color = Surface1) {
                    Column(
                        Modifier.fillMaxWidth().padding(34.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Outlined.BookmarkAdd, null, tint = GoldBright, modifier = Modifier.size(30.dp))
                        Spacer(Modifier.height(9.dp))
                        Text("قائمتك جاهزة", color = TextMain, fontWeight = FontWeight.Bold)
                        Text(
                            "أضف أول فيلم أو مسلسل تريد الرجوع إليه لاحقًا.",
                            color = TextFaint,
                            fontSize = 10.sp
                        )
                    }
                }
            }
        } else {
            items(watchlist, key = { it.mediaType + "-" + it.id }) { movie ->
                PremiumSearchRow(movie, onOpen)
            }
        }
    }
}

@Composable
private fun PremiumAuthDialog(
    login: Boolean,
    loading: Boolean,
    onDismiss: () -> Unit,
    onToggle: () -> Unit,
    onSubmit: (String, String, String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Surface2,
        title = {
            Text(
                if (login) "مرحبًا بعودتك" else "ابدأ مع Movyza",
                color = TextMain,
                fontWeight = FontWeight.Black
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                if (!login) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("الاسم") },
                        singleLine = true
                    )
                }
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("البريد الإلكتروني") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("كلمة المرور") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
                )
                TextButton(onClick = onToggle) {
                    Text(
                        if (login) "ليس لديك حساب؟ إنشاء حساب" else "لديك حساب؟ تسجيل الدخول",
                        color = GoldBright
                    )
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !loading && email.isNotBlank() && password.length >= 6,
                onClick = { onSubmit(name, email, password) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = GoldBright,
                    contentColor = Ink
                ),
                shape = RoundedCornerShape(12.dp)
            ) {
                if (loading) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(if (login) "دخول" else "إنشاء", fontWeight = FontWeight.Bold)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("إلغاء", color = TextMuted)
            }
        }
    )
}

@Composable
private fun PremiumDetails(
    movie: Movie,
    details: TmdbDetails?,
    watchlisted: Boolean,
    onBack: () -> Unit,
    onLoad: () -> Unit,
    onWatch: () -> Unit,
    onToggleWatchlist: () -> Unit
) {
    LaunchedEffect(movie.id, movie.mediaType) {
        if (details == null) onLoad()
    }

    Box(Modifier.fillMaxSize().background(Black)) {
        AsyncImage(
            model = details?.movie?.backdropUrl ?: movie.backdropUrl ?: movie.posterUrl,
            contentDescription = movie.title,
            modifier = Modifier.fillMaxWidth().height(480.dp),
            contentScale = ContentScale.Crop
        )

        Box(
            Modifier.fillMaxWidth().height(560.dp).background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = .05f),
                    .32f to Color.Transparent,
                    .60f to Black.copy(alpha = .72f),
                    .82f to Black.copy(alpha = .98f),
                    1f to Black
                )
            )
        )

        Surface(
            Modifier.padding(top = 14.dp, start = 12.dp),
            shape = CircleShape,
            color = Color.Black.copy(alpha = .40f)
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, "رجوع", tint = Color.White)
            }
        }

        Column(
            Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 26.dp)
        ) {
            Spacer(Modifier.weight(1f))

            Text(
                movie.title.ifBlank { movie.originalTitle },
                color = Color.White,
                fontSize = 31.sp,
                lineHeight = 34.sp,
                fontWeight = FontWeight.Black,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(9.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "★ " + String.format("%.1f", movie.rating),
                    color = GoldBright,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Black
                )
                PremiumDot()
                Text(movie.releaseDate.take(4), color = TextMuted, fontSize = 11.sp)
                PremiumDot()
                Text(if (movie.mediaType == "series") "مسلسل" else "فيلم", color = TextMuted, fontSize = 11.sp)
                if (details != null && details.runtime > 0 && movie.mediaType != "series") {
                    PremiumDot()
                    Text(details.runtime.toString() + " دقيقة", color = TextMuted, fontSize = 11.sp)
                }
            }

            if (details?.genres?.isNotEmpty() == true) {
                Spacer(Modifier.height(9.dp))
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(7.dp)
                ) {
                    details.genres.take(4).forEach { genre ->
                        Surface(shape = RoundedCornerShape(999.dp), color = Surface2) {
                            Text(
                                genre,
                                color = TextMuted,
                                fontSize = 9.sp,
                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp)
                            )
                        }
                    }
                }
            }

            details?.tagline?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(9.dp))
                Text(it, color = Gold, fontSize = 11.sp, fontStyle = FontStyle.Italic)
            }

            Spacer(Modifier.height(11.dp))

            Text(
                details?.movie?.overview ?: movie.overview.ifBlank { "تحميل تفاصيل العنوان…" },
                color = Color.White.copy(alpha = .77f),
                fontSize = 11.sp,
                lineHeight = 17.sp,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(16.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Button(
                    onClick = onWatch,
                    modifier = Modifier.weight(1f).height(50.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GoldBright,
                        contentColor = Ink
                    ),
                    shape = RoundedCornerShape(15.dp)
                ) {
                    Icon(Icons.Outlined.PlayArrow, null, modifier = Modifier.size(19.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("مشاهدة", fontWeight = FontWeight.Black)
                }

                Surface(
                    Modifier
                        .size(50.dp)
                        .clip(RoundedCornerShape(15.dp))
                        .clickable(onClick = onToggleWatchlist),
                    shape = RoundedCornerShape(15.dp),
                    color = Surface2
                ) {
                    IconButton(onClick = onToggleWatchlist) {
                        Icon(
                            if (watchlisted) Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkAdd,
                            contentDescription = "قائمتي",
                            tint = if (watchlisted) GoldBright else TextMain
                        )
                    }
                }
            }
        }

        if (details == null) {
            Surface(
                Modifier.align(Alignment.Center).padding(bottom = 130.dp),
                shape = CircleShape,
                color = Color.Black.copy(alpha = .45f)
            ) {
                CircularProgressIndicator(
                    Modifier.padding(11.dp).size(27.dp),
                    strokeWidth = 2.dp,
                    color = GoldBright
                )
            }
        }
    }
}

@Composable
private fun PremiumError(message: String) {
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 7.dp),
        shape = RoundedCornerShape(17.dp),
        color = Color(0xFF1D1210)
    ) {
        Row(
            Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier.size(8.dp).clip(CircleShape).background(Color(0xFFBA6259))
            )
            Spacer(Modifier.width(10.dp))
            Text(
                message,
                color = Color(0xFFD9AAA3),
                fontSize = 10.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun PremiumHeroSkeleton() {
    val pulse = rememberInfiniteTransition(label = "hero-skeleton")
    val alpha by pulse.animateFloat(
        .38f,
        .72f,
        infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "hero-alpha"
    )
    Box(
        Modifier
            .fillMaxWidth()
            .height(474.dp)
            .padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(30.dp))
            .background(Surface2.copy(alpha = alpha))
    )
}

@Composable
private fun PremiumHomeSkeletons() {
    repeat(3) {
        Column(Modifier.padding(top = 15.dp)) {
            Box(
                Modifier
                    .padding(horizontal = 18.dp)
                    .width(145.dp)
                    .height(18.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Surface2)
            )
            LazyRow(
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(11.dp)
            ) {
                items(4) {
                    Box(
                        Modifier
                            .width(122.dp)
                            .aspectRatio(.66f)
                            .clip(RoundedCornerShape(17.dp))
                            .background(Surface2)
                    )
                }
            }
        }
    }
}

@Composable
private fun PremiumLoading() {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator(
            Modifier.size(20.dp),
            strokeWidth = 2.dp,
            color = GoldBright
        )
    }
}
