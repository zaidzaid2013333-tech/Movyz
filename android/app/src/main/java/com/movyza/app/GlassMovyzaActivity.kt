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
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.scale
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.movyza.app.data.Movie
import com.movyza.app.data.MovyzaApi
import com.movyza.app.data.TmdbDetails
import com.movyza.app.data.UserSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val GlassBlack = Color(0xFF030303)
private val GlassGold = Color(0xFFD9B65D)
private val GlassGoldBright = Color(0xFFF4D88C)
private val GlassGoldDark = Color(0xFF8F6828)
private val GlassText = Color(0xFFF7F3EB)
private val GlassMuted = Color(0xFFA29A8F)
private val GlassFaint = Color(0xFF6E675D)
private val GlassPanel = Color(0x8D171510)
private val GlassPanelStrong = Color(0xD30C0B09)

private val GlassScheme = darkColorScheme(
    primary = GlassGoldBright,
    secondary = GlassGold,
    tertiary = GlassGoldDark,
    background = GlassBlack,
    surface = GlassPanelStrong,
    surfaceVariant = Color(0xFF18150F),
    onPrimary = GlassBlack,
    onBackground = GlassText,
    onSurface = GlassText
)

class GlassMovyzaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = GlassScheme) {
                Surface(Modifier.fillMaxSize(), color = GlassBlack) {
                    GlassMovyzaApp()
                }
            }
        }
    }
}

@Composable
private fun GlassMovyzaApp(vm: MainViewModel = androidx.lifecycle.viewmodel.compose.viewModel()) {
    var tab by remember { mutableStateOf(Tab.HOME) }
    var selected by remember { mutableStateOf<Movie?>(null) }
    var details by remember { mutableStateOf<TmdbDetails?>(null) }
    var authOpen by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf(true) }

    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val home by vm.home.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val watchlist by vm.watchlist.collectAsStateWithLifecycle()

    if (authOpen) {
        GlassAuthDialog(
            login = loginMode,
            loading = vm.loading,
            onDismiss = { authOpen = false },
            onToggle = { loginMode = !loginMode },
            onSubmit = { name, email, password ->
                if (loginMode) {
                    vm.signIn(email, password) { ok, message ->
                        scope.launch { snack.showSnackbar(message) }
                        if (ok) authOpen = false
                    }
                } else {
                    vm.signUp(name, email, password) { ok, message ->
                        scope.launch { snack.showSnackbar(message) }
                        if (ok && message == "تم إنشاء الحساب") authOpen = false
                    }
                }
            }
        )
    }

    Box(Modifier.fillMaxSize().background(GlassBlack)) {
        AnimatedContent(
            targetState = tab,
            modifier = Modifier.fillMaxSize(),
            transitionSpec = {
                val dir = if (targetState.ordinal >= initialState.ordinal) 1 else -1
                (
                    slideInHorizontally(tween(300, easing = FastOutSlowInEasing)) { dir * it / 12 } +
                        fadeIn(tween(180))
                ) togetherWith (
                    slideOutHorizontally(tween(220)) { -dir * it / 14 } +
                        fadeOut(tween(120))
                )
            },
            label = "glass-pages"
        ) { current ->
            when (current) {
                Tab.HOME -> GlassHome(
                    state = home,
                    loading = vm.loading,
                    error = vm.error,
                    onOpen = { selected = it },
                    onSearch = { tab = Tab.SEARCH },
                    onProfile = { tab = Tab.PROFILE }
                )
                Tab.MOVIES -> GlassCatalog(
                    title = "أفلام",
                    subtitle = "اختيارات سينمائية لك",
                    movies = home.movies,
                    loading = vm.loading,
                    onOpen = { selected = it }
                )
                Tab.SERIES -> GlassCatalog(
                    title = "مسلسلات",
                    subtitle = "اكتشف عناوينك القادمة",
                    movies = home.series,
                    loading = vm.loading,
                    onOpen = { selected = it }
                )
                Tab.SEARCH -> GlassSearch(
                    results = search,
                    loading = vm.loading,
                    onQuery = vm::search,
                    onOpen = { selected = it }
                )
                Tab.PROFILE -> GlassProfile(
                    session = vm.session,
                    watchlist = watchlist,
                    onOpen = { selected = it },
                    onLogin = { loginMode = true; authOpen = true },
                    onSignup = { loginMode = false; authOpen = true },
                    onLogout = vm::signOut
                )
            }
        }

        GlassDock(
            selected = tab,
            onSelect = { tab = it },
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(horizontal = 14.dp, bottom = 8.dp)
                .navigationBarsPadding()
        )

        SnackbarHost(
            hostState = snack,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 92.dp)
        )
    }

    AnimatedVisibility(
        visible = selected != null,
        enter = fadeIn(tween(180)),
        exit = fadeOut(tween(120))
    ) {
        selected?.let { movie ->
            GlassDetails(
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
                onWatch = { scope.launch { snack.showSnackbar("المشغل جاهز كنقطة الربط التالية") } },
                onToggleWatchlist = {
                    vm.toggleWatchlist(movie) { message ->
                        scope.launch { snack.showSnackbar(message) }
                    }
                }
            )
        }
    }
}

@Composable
private fun GlassDock(
    selected: Tab,
    onSelect: (Tab) -> Unit,
    modifier: Modifier
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(67.dp)
            .shadow(28.dp, RoundedCornerShape(24.dp)),
        shape = RoundedCornerShape(24.dp),
        color = GlassPanelStrong,
        border = BorderStroke(1.dp, Color.White.copy(alpha = .10f)),
        tonalElevation = 0.dp
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.linearGradient(
                        listOf(
                            Color.White.copy(alpha = .045f),
                            Color.Transparent,
                            GlassGold.copy(alpha = .028f),
                            Color.Transparent
                        )
                    )
                )
                .padding(horizontal = 5.dp, vertical = 5.dp)
        ) {
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Tab.values().forEach { item ->
                    val active = item == selected
                    val tint by animateColorAsState(
                        if (active) GlassGoldBright else GlassMuted.copy(alpha = .72f),
                        tween(230),
                        label = "dock-color"
                    )
                    val iconScale by animateFloatAsState(
                        if (active) 1f else .92f,
                        tween(230, easing = FastOutSlowInEasing),
                        label = "dock-scale"
                    )

                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .padding(horizontal = 2.dp)
                            .clip(RoundedCornerShape(18.dp))
                            .background(
                                if (active) {
                                    Brush.verticalGradient(
                                        listOf(
                                            GlassGold.copy(alpha = .18f),
                                            GlassGold.copy(alpha = .045f)
                                        )
                                    )
                                } else {
                                    Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent))
                                }
                            )
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
                                modifier = Modifier.size((21f * iconScale).dp)
                            )
                            AnimatedVisibility(
                                visible = active,
                                enter = fadeIn(tween(160)),
                                exit = fadeOut(tween(100))
                            ) {
                                Text(
                                    item.label,
                                    color = tint,
                                    fontSize = 8.sp,
                                    fontWeight = FontWeight.Black,
                                    modifier = Modifier.padding(top = 1.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GlassHome(
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
    val transition = rememberInfiniteTransition(label = "home-motion")
    val heroScale by transition.animateFloat(
        1f,
        1.028f,
        infiniteRepeatable(tween(7000, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "hero-scale"
    )
    val glow by transition.animateFloat(
        .10f,
        .22f,
        infiniteRepeatable(tween(2300), RepeatMode.Reverse),
        label = "hero-glow"
    )

    LaunchedEffect(heroes.size) {
        if (heroes.isNotEmpty()) {
            while (true) {
                delay(6200)
                heroIndex = (heroIndex + 1) % heroes.size
            }
        }
    }

    LazyColumn(
        Modifier.fillMaxSize().background(GlassBlack),
        contentPadding = PaddingValues(bottom = 112.dp)
    ) {
        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 18.dp, end = 14.dp, top = 16.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "MOVYZA",
                        color = GlassGoldBright,
                        fontSize = 23.sp,
                        fontWeight = FontWeight.Black,
                        letterSpacing = 4.sp
                    )
                    Text(
                        "Cinema, reimagined.",
                        color = GlassGold.copy(alpha = .52f),
                        fontSize = 9.sp,
                        letterSpacing = 1.5.sp
                    )
                }
                GlassCircleButton(Icons.Outlined.Search, onSearch)
                Spacer(Modifier.width(5.dp))
                GlassCircleButton(Icons.Outlined.AccountCircle, onProfile)
            }
        }

        item {
            if (heroes.isNotEmpty()) {
                AnimatedContent(
                    targetState = heroes[heroIndex.coerceIn(0, heroes.lastIndex)],
                    transitionSpec = { fadeIn(tween(540)) togetherWith fadeOut(tween(330)) },
                    label = "hero-swap"
                ) { hero ->
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(448.dp)
                            .padding(horizontal = 12.dp)
                            .clip(RoundedCornerShape(29.dp))
                            .border(1.dp, Color.White.copy(alpha = .07f), RoundedCornerShape(29.dp))
                            .clickable { onOpen(hero) }
                    ) {
                        AsyncImage(
                            model = hero.backdropUrl ?: hero.posterUrl,
                            contentDescription = hero.title,
                            modifier = Modifier.fillMaxSize().scale(heroScale),
                            contentScale = ContentScale.Crop
                        )
                        Box(
                            Modifier.fillMaxSize().background(
                                Brush.verticalGradient(
                                    0f to Color.Transparent,
                                    .36f to Color.Transparent,
                                    .59f to GlassBlack.copy(alpha = .11f),
                                    .77f to GlassBlack.copy(alpha = .76f),
                                    1f to GlassBlack.copy(alpha = .99f)
                                )
                            )
                        )
                        Box(
                            Modifier.fillMaxSize().background(
                                Brush.radialGradient(
                                    listOf(GlassGold.copy(alpha = glow), Color.Transparent),
                                    radius = 820f
                                )
                            )
                        )

                        Column(
                            Modifier
                                .align(Alignment.BottomStart)
                                .padding(21.dp)
                        ) {
                            GlassTag("FEATURED")
                            Spacer(Modifier.height(10.dp))
                            Text(
                                hero.title.ifBlank { hero.originalTitle },
                                color = Color.White,
                                fontSize = 31.sp,
                                lineHeight = 34.sp,
                                fontWeight = FontWeight.Black,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "★ " + String.format("%.1f", hero.rating),
                                    color = GlassGoldBright,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Black
                                )
                                GlassDot()
                                Text(hero.releaseDate.take(4), color = Color.White.copy(alpha = .76f), fontSize = 11.sp)
                                GlassDot()
                                Text(
                                    if (hero.mediaType == "series") "مسلسل" else "فيلم",
                                    color = Color.White.copy(alpha = .76f),
                                    fontSize = 11.sp
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(
                                hero.overview.ifBlank { "عنوان مختار ضمن تجربة Movyza السينمائية." },
                                color = Color.White.copy(alpha = .74f),
                                fontSize = 11.sp,
                                lineHeight = 17.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(14.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = { onOpen(hero) },
                                    modifier = Modifier.height(44.dp),
                                    shape = RoundedCornerShape(14.dp),
                                    contentPadding = PaddingValues(horizontal = 15.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = GlassGoldBright,
                                        contentColor = GlassBlack
                                    )
                                ) {
                                    Icon(Icons.Outlined.PlayArrow, null, Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("التفاصيل", fontWeight = FontWeight.Black)
                                }
                                GlassAction("＋ قائمتي") { onOpen(hero) }
                            }
                        }
                    }
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(448.dp)
                        .padding(horizontal = 12.dp)
                        .clip(RoundedCornerShape(29.dp))
                        .background(Color(0xFF14120E))
                )
            }
        }

        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 18.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                GlassPill("أفلام", Icons.Outlined.LocalMovies, onSearch)
                GlassPill("مسلسلات", Icons.Outlined.Tv, onSearch)
                GlassPill("تقييمات", Icons.Outlined.Tune, onSearch)
                GlassPill("قائمتي", Icons.Outlined.BookmarkAdded, onProfile)
            }
        }

        if (error != null) item { GlassError(error) }

        if (loading && state.movies.isEmpty()) {
            item { GlassSkeletons() }
        } else {
            item { GlassSection("الآن", state.trending.drop(1), "رائج الآن", onOpen) }
            item { GlassSection("اختيارات لك", state.movies, "أفلام", onOpen) }
            item { GlassSection("الأعلى تقييمًا", state.topRated, "موثوق", onOpen) }
            item { GlassSection("جلسة مسلسلات", state.series, "مسلسلات", onOpen) }
        }
    }
}

@Composable
private fun GlassCircleButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Surface(
        Modifier.size(41.dp).shadow(10.dp, CircleShape),
        shape = CircleShape,
        color = Color(0x761A1712),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .085f))
    ) {
        IconButton(onClick = onClick) {
            Icon(icon, null, tint = GlassText, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun GlassTag(text: String) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = GlassGold.copy(alpha = .13f),
        border = BorderStroke(1.dp, GlassGold.copy(alpha = .18f))
    ) {
        Text(
            text,
            color = GlassGoldBright,
            fontSize = 8.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 1.45.sp,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
        )
    }
}

@Composable
private fun GlassAction(text: String, onClick: () -> Unit) {
    Surface(
        Modifier.height(44.dp).clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick),
        shape = RoundedCornerShape(14.dp),
        color = Color(0x66151210),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .17f))
    ) {
        Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
            Text(text, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun GlassPill(
    text: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit
) {
    Surface(
        Modifier.clip(RoundedCornerShape(999.dp)).clickable(onClick = onClick),
        shape = RoundedCornerShape(999.dp),
        color = Color(0x7A17140F),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .065f))
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(icon, null, tint = GlassGoldBright, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Text(text, color = GlassText, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun GlassSection(
    title: String,
    movies: List<Movie>,
    subtitle: String,
    onOpen: (Movie) -> Unit
) {
    if (movies.isEmpty()) return

    Column(Modifier.padding(top = 7.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, color = GlassText, fontSize = 18.sp, fontWeight = FontWeight.Black)
                Text(subtitle, color = GlassFaint, fontSize = 9.sp, letterSpacing = .8.sp)
            }
            Text("استكشف", color = GlassGoldBright, fontSize = 9.sp, fontWeight = FontWeight.Bold)
        }

        LazyRow(
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(11.dp)
        ) {
            items(movies.take(12), key = { it.mediaType + "-" + it.id }) { movie ->
                GlassPoster(movie, onOpen)
            }
        }
    }
}

@Composable
private fun GlassPoster(movie: Movie, onOpen: (Movie) -> Unit) {
    Column(Modifier.width(122.dp).clickable { onOpen(movie) }) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(177.dp)
                .clip(RoundedCornerShape(17.dp))
                .shadow(12.dp, RoundedCornerShape(17.dp))
                .border(1.dp, Color.White.copy(alpha = .055f), RoundedCornerShape(17.dp))
                .background(Color(0xFF12110E))
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
                        .62f to Color.Transparent,
                        1f to Color.Black.copy(alpha = .82f)
                    )
                )
            )
            Surface(
                Modifier.align(Alignment.TopEnd).padding(7.dp),
                shape = RoundedCornerShape(8.dp),
                color = Color.Black.copy(alpha = .52f)
            ) {
                Text(
                    "★ " + String.format("%.1f", movie.rating),
                    color = GlassGoldBright,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 5.dp)
                )
            }
        }
        Spacer(Modifier.height(7.dp))
        Text(
            movie.title.ifBlank { movie.originalTitle },
            color = GlassText,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 15.sp
        )
        Text(
            if (movie.mediaType == "series") "مسلسل" else movie.releaseDate.take(4),
            color = GlassFaint,
            fontSize = 9.sp,
            modifier = Modifier.padding(top = 3.dp)
        )
    }
}

@Composable
private fun GlassCatalog(
    title: String,
    subtitle: String,
    movies: List<Movie>,
    loading: Boolean,
    onOpen: (Movie) -> Unit
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        modifier = Modifier.fillMaxSize().background(GlassBlack),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 22.dp, bottom = 108.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp)
    ) {
        item(span = { GridItemSpan(2) }) {
            Column {
                Text(title, color = GlassText, fontSize = 29.sp, fontWeight = FontWeight.Black)
                Text(subtitle, color = GlassFaint, fontSize = 10.sp)
                if (loading) {
                    Spacer(Modifier.height(9.dp))
                    GlassLoading()
                }
            }
        }
        items(movies, key = { it.mediaType + "-" + it.id }) { movie ->
            GlassGridCard(movie, onOpen)
        }
    }
}

@Composable
private fun GlassGridCard(movie: Movie, onOpen: (Movie) -> Unit) {
    Column(Modifier.fillMaxWidth().clickable { onOpen(movie) }) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(249.dp)
                .clip(RoundedCornerShape(18.dp))
                .border(1.dp, Color.White.copy(alpha = .06f), RoundedCornerShape(18.dp))
        ) {
            AsyncImage(
                model = movie.posterUrl,
                contentDescription = movie.title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            Box(
                Modifier.fillMaxWidth().height(85.dp).align(Alignment.BottomCenter).background(
                    Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .90f)))
                )
            )
            Surface(
                Modifier.align(Alignment.TopStart).padding(8.dp),
                shape = RoundedCornerShape(8.dp),
                color = Color.Black.copy(alpha = .50f)
            ) {
                Text(
                    "★ " + String.format("%.1f", movie.rating),
                    color = GlassGoldBright,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 5.dp)
                )
            )
        }
        Spacer(Modifier.height(7.dp))
        Text(
            movie.title.ifBlank { movie.originalTitle },
            color = GlassText,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            if (movie.mediaType == "series") "مسلسل" else "فيلم",
            color = GlassFaint,
            fontSize = 9.sp,
            modifier = Modifier.padding(top = 3.dp)
        )
    }
}

@Composable
private fun GlassSearch(
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
        Modifier.fillMaxSize().background(GlassBlack),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 108.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp)
    ) {
        item {
            Text("اكتشف", color = GlassText, fontSize = 31.sp, fontWeight = FontWeight.Black)
            Text("فيلم، مسلسل، ممثل أو عنوان في بالك.", color = GlassFaint, fontSize = 10.sp)
            Spacer(Modifier.height(14.dp))
            Surface(
                shape = RoundedCornerShape(18.dp),
                color = Color(0x7A17140F),
                border = BorderStroke(1.dp, Color.White.copy(alpha = .065f))
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("اكتب ما تبحث عنه…", color = GlassFaint) },
                    leadingIcon = { Icon(Icons.Outlined.Search, null, tint = GlassGoldBright) },
                    singleLine = true,
                    shape = RoundedCornerShape(18.dp),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = GlassGold.copy(alpha = .72f),
                        unfocusedBorderColor = Color.Transparent,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent
                    )
                )
            }
            if (loading) {
                Spacer(Modifier.height(10.dp))
                GlassLoading()
            }
        }
        items(results.take(30), key = { it.mediaType + "-" + it.id }) { movie ->
            GlassSearchRow(movie, onOpen)
        }
    }
}

@Composable
private fun GlassSearchRow(movie: Movie, onOpen: (Movie) -> Unit) {
    Surface(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable { onOpen(movie) },
        shape = RoundedCornerShape(18.dp),
        color = Color(0xA811100D),
        border = BorderStroke(1.dp, Color.White.copy(alpha = .05f))
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
                    color = GlassText,
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
                    color = GlassGoldBright,
                    fontSize = 10.sp
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    movie.overview,
                    color = GlassMuted,
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
private fun GlassProfile(
    session: UserSession?,
    watchlist: List<Movie>,
    onOpen: (Movie) -> Unit,
    onLogin: () -> Unit,
    onSignup: () -> Unit,
    onLogout: () -> Unit
) {
    LazyColumn(
        Modifier.fillMaxSize().background(GlassBlack),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 22.dp, bottom = 108.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text("مساحتي", color = GlassText, fontSize = 31.sp, fontWeight = FontWeight.Black)
            Text("حسابك وقائمتك وتجربتك في مكان واحد.", color = GlassFaint, fontSize = 10.sp)
        }
        item {
            Surface(
                shape = RoundedCornerShape(24.dp),
                color = Color(0xA613120F),
                border = BorderStroke(1.dp, Color.White.copy(alpha = .065f))
            ) {
                Column(Modifier.fillMaxWidth().padding(20.dp)) {
                    Box(
                        Modifier.size(58.dp).clip(CircleShape).background(
                            Brush.linearGradient(listOf(GlassGoldBright, GlassGoldDark))
                        ),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            if (session == null) "M" else session.email.take(1).uppercase(),
                            color = GlassBlack,
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                    Spacer(Modifier.height(13.dp))
                    if (session == null) {
                        Text("أهلاً بك في Movyza", color = GlassText, fontSize = 20.sp, fontWeight = FontWeight.Black)
                        Spacer(Modifier.height(4.dp))
                        Text("سجّل الدخول لمزامنة قائمتك عبر Supabase.", color = GlassMuted, fontSize = 10.sp)
                        Spacer(Modifier.height(15.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = onLogin,
                                shape = RoundedCornerShape(13.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = GlassGoldBright,
                                    contentColor = GlassBlack
                                )
                            ) { Text("تسجيل الدخول", fontWeight = FontWeight.Bold) }
                            OutlinedButton(onClick = onSignup, shape = RoundedCornerShape(13.dp)) {
                                Text("إنشاء حساب")
                            }
                        }
                    } else {
                        Text(session.email, color = GlassText, fontSize = 18.sp, fontWeight = FontWeight.Black)
                        Text("حساب Movyza • Supabase", color = GlassMuted, fontSize = 10.sp)
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
                Text("قائمتي", color = GlassText, fontSize = 21.sp, fontWeight = FontWeight.Black)
                Text(watchlist.size.toString() + " عنوان محفوظ", color = GlassFaint, fontSize = 9.sp)
            }
        }
        if (watchlist.isEmpty()) {
            item {
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color(0x84110F0C),
                    border = BorderStroke(1.dp, Color.White.copy(alpha = .05f))
                ) {
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 34.dp, horizontal = 18.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Outlined.BookmarkAdd, null, tint = GlassGoldBright, modifier = Modifier.size(30.dp))
                        Spacer(Modifier.height(9.dp))
                        Text("قائمتك جاهزة", color = GlassText, fontWeight = FontWeight.Bold)
                        Text(
                            "أضف أول فيلم أو مسلسل تريد الرجوع إليه لاحقًا.",
                            color = GlassFaint,
                            fontSize = 10.sp
                        )
                    }
                }
            }
        } else {
            items(watchlist, key = { it.mediaType + "-" + it.id }) { movie ->
                GlassSearchRow(movie, onOpen)
            }
        }
    }
}

@Composable
private fun GlassDetails(
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

    Box(Modifier.fillMaxSize().background(GlassBlack)) {
        AsyncImage(
            model = details?.movie?.backdropUrl ?: movie.backdropUrl ?: movie.posterUrl,
            contentDescription = movie.title,
            modifier = Modifier.fillMaxWidth().height(485.dp),
            contentScale = ContentScale.Crop
        )
        Box(
            Modifier.fillMaxWidth().height(585.dp).background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = .03f),
                    .33f to Color.Transparent,
                    .58f to GlassBlack.copy(alpha = .72f),
                    .82f to GlassBlack.copy(alpha = .98f),
                    1f to GlassBlack
                )
            )
        )
        Surface(
            Modifier.padding(top = 14.dp, start = 12.dp),
            shape = CircleShape,
            color = Color.Black.copy(alpha = .36f),
            border = BorderStroke(1.dp, Color.White.copy(alpha = .08f))
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Outlined.ArrowBack, "رجوع", tint = Color.White)
            }
        }
        Column(
            Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 24.dp)
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
                Text("★ " + String.format("%.1f", movie.rating), color = GlassGoldBright, fontSize = 11.sp, fontWeight = FontWeight.Black)
                GlassDot()
                Text(movie.releaseDate.take(4), color = GlassMuted, fontSize = 11.sp)
                GlassDot()
                Text(if (movie.mediaType == "series") "مسلسل" else "فيلم", color = GlassMuted, fontSize = 11.sp)
                if (details?.runtime ?: 0 > 0 && movie.mediaType != "series") {
                    GlassDot()
                    Text(details!!.runtime.toString() + " دقيقة", color = GlassMuted, fontSize = 11.sp)
                }
            }
            if (details?.genres?.isNotEmpty() == true) {
                Spacer(Modifier.height(9.dp))
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(7.dp)
                ) {
                    details.genres.take(4).forEach { genre ->
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = Color(0xA918150F),
                            border = BorderStroke(1.dp, Color.White.copy(alpha = .05f))
                        ) {
                            Text(
                                genre,
                                color = GlassMuted,
                                fontSize = 9.sp,
                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp)
                            )
                        }
                    }
                }
            }
            details?.tagline?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(9.dp))
                Text(it, color = GlassGold, fontSize = 11.sp, fontStyle = FontStyle.Italic)
            }
            Spacer(Modifier.height(11.dp))
            Text(
                details?.movie?.overview ?: movie.overview.ifBlank { "تحميل تفاصيل العنوان…" },
                color = Color.White.copy(alpha = .76f),
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
                        containerColor = GlassGoldBright,
                        contentColor = GlassBlack
                    ),
                    shape = RoundedCornerShape(15.dp)
                ) {
                    Icon(Icons.Outlined.PlayArrow, null, Modifier.size(19.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("مشاهدة", fontWeight = FontWeight.Black)
                }
                Surface(
                    Modifier.size(50.dp).clip(RoundedCornerShape(15.dp)).clickable(onClick = onToggleWatchlist),
                    shape = RoundedCornerShape(15.dp),
                    color = Color(0xA818150F),
                    border = BorderStroke(1.dp, Color.White.copy(alpha = .07f))
                ) {
                    IconButton(onClick = onToggleWatchlist) {
                        Icon(
                            if (watchlisted) Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkAdd,
                            contentDescription = "قائمتي",
                            tint = if (watchlisted) GlassGoldBright else GlassText
                        )
                    }
                }
            }
        }
        if (details == null) {
            Surface(
                Modifier.align(Alignment.Center).padding(bottom = 130.dp),
                shape = CircleShape,
                color = Color.Black.copy(alpha = .40f)
            ) {
                CircularProgressIndicator(
                    Modifier.padding(11.dp).size(27.dp),
                    strokeWidth = 2.dp,
                    color = GlassGoldBright
                )
            }
        }
    }
}

@Composable
private fun GlassAuthDialog(
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
        containerColor = Color(0xF318150F),
        title = {
            Text(
                if (login) "مرحبًا بعودتك" else "ابدأ مع Movyza",
                color = GlassText,
                fontWeight = FontWeight.Black
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                if (!login) {
                    OutlinedTextField(name, { name = it }, label = { Text("الاسم") }, singleLine = true)
                }
                OutlinedTextField(
                    email,
                    { email = it },
                    label = { Text("البريد الإلكتروني") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
                )
                OutlinedTextField(
                    password,
                    { password = it },
                    label = { Text("كلمة المرور") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
                )
                TextButton(onClick = onToggle) {
                    Text(
                        if (login) "ليس لديك حساب؟ إنشاء حساب" else "لديك حساب؟ تسجيل الدخول",
                        color = GlassGoldBright
                    )
                }
            }
        },
        confirmButton = {
            Button(
                enabled = !loading && email.isNotBlank() && password.length >= 6,
                onClick = { onSubmit(name, email, password) },
                colors = ButtonDefaults.buttonColors(
                    containerColor = GlassGoldBright,
                    contentColor = GlassBlack
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
                Text("إلغاء", color = GlassMuted)
            }
        }
    )
}

@Composable
private fun GlassDot() {
    Box(
        Modifier.padding(horizontal = 7.dp).size(3.dp).clip(CircleShape).background(GlassGold)
    )
}

@Composable
private fun GlassError(message: String) {
    Surface(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 7.dp),
        shape = RoundedCornerShape(17.dp),
        color = Color(0xFF1C1210),
        border = BorderStroke(1.dp, Color(0xFF8D514A).copy(alpha = .20f))
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFFC06056)))
            Spacer(Modifier.width(9.dp))
            Text(message, color = Color(0xFFD4A39D), fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun GlassLoading() {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.Center) {
        CircularProgressIndicator(Modifier.size(19.dp), strokeWidth = 2.dp, color = GlassGoldBright)
    }
}

@Composable
private fun GlassSkeletons() {
    val pulse = rememberInfiniteTransition(label = "glass-skeleton")
    val alpha by pulse.animateFloat(
        .34f,
        .66f,
        infiniteRepeatable(tween(850), RepeatMode.Reverse),
        label = "skeleton-alpha"
    )
    repeat(3) {
        Column(Modifier.padding(top = 14.dp)) {
            Box(
                Modifier
                    .padding(horizontal = 18.dp)
                    .width(132.dp)
                    .height(17.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Color(0xFF17140F).copy(alpha = alpha))
            )
            LazyRow(
                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(11.dp)
            ) {
                items(4) {
                    Box(
                        Modifier
                            .width(122.dp)
                            .height(177.dp)
                            .clip(RoundedCornerShape(17.dp))
                            .background(Color(0xFF12110E).copy(alpha = alpha))
                    )
                }
            }
        }
    }
}
