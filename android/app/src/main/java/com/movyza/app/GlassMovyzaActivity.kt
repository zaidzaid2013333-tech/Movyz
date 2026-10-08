package com.movyza.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
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
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
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

private val GlassBlack = MovyzaColors.Bg
private val GlassGold = MovyzaColors.Gold600
private val GlassGoldBright = MovyzaColors.Gold300
private val GlassGoldDark = MovyzaColors.Gold700
private val GlassText = MovyzaColors.Text
private val GlassMuted = MovyzaColors.Text2
private val GlassFaint = MovyzaColors.Text3
private val GlassPanel = MovyzaColors.Glass
private val GlassPanelStrong = MovyzaColors.GlassStrong

class GlassMovyzaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MovyzaTheme {
                Surface(Modifier.fillMaxSize(), color = MovyzaColors.Bg) {
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
    val context = LocalContext.current
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

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = MovyzaColors.Bg,
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            if (selected == null) {
                MovyzaBottomBar(selected = tab, onSelect = { tab = it })
            }
        }
    ) { innerPadding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .background(MovyzaColors.Bg)
        ) {
            AnimatedContent(
                targetState = tab,
                modifier = Modifier.fillMaxSize(),
                transitionSpec = {
                    fadeIn(tween(120)) togetherWith fadeOut(tween(90))
                },
                label = "native-pages"
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
        }
    }

    AnimatedVisibility(
        visible = selected != null,
        enter = fadeIn(tween(140)),
        exit = fadeOut(tween(100))
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
                onWatch = {
                    context.startActivity(
                        Intent(context, com.movyza.app.player.MovyzaPlayerActivity::class.java).apply {
                            putExtra(com.movyza.app.player.MovyzaPlayerActivity.EXTRA_TMDB_ID, movie.id)
                            putExtra(com.movyza.app.player.MovyzaPlayerActivity.EXTRA_MEDIA_TYPE, movie.mediaType)
                            putExtra(com.movyza.app.player.MovyzaPlayerActivity.EXTRA_TITLE, movie.title.ifBlank { movie.originalTitle })
                        }
                    )
                },
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
private fun MovyzaBottomBar(
    selected: Tab,
    onSelect: (Tab) -> Unit
) {
    NavigationBar(
        modifier = Modifier.fillMaxWidth(),
        containerColor = MovyzaColors.Bg2,
        tonalElevation = 0.dp,
        windowInsets = androidx.compose.foundation.layout.WindowInsets.navigationBars
    ) {
        Tab.values().forEach { item ->
            NavigationBarItem(
                selected = selected == item,
                onClick = { onSelect(item) },
                icon = {
                    Icon(
                        when (item) {
                            Tab.HOME -> Icons.Outlined.Home
                            Tab.MOVIES -> Icons.Outlined.LocalMovies
                            Tab.SERIES -> Icons.Outlined.Tv
                            Tab.SEARCH -> Icons.Outlined.Search
                            Tab.PROFILE -> Icons.Outlined.Person
                        },
                        contentDescription = item.label
                    )
                },
                label = { Text(item.label, fontSize = 10.sp, maxLines = 1) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MovyzaColors.Gold300,
                    selectedTextColor = MovyzaColors.Gold300,
                    unselectedIconColor = MovyzaColors.Text3,
                    unselectedTextColor = MovyzaColors.Text3,
                    indicatorColor = MovyzaColors.Gold500.copy(alpha = .12f)
                )
            )
        }
    )
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
    LazyColumn(
        Modifier.fillMaxSize().background(MovyzaColors.Bg),
        contentPadding = PaddingValues(bottom = 22.dp)
    ) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 17.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text("MOVYZA", color = MovyzaColors.Gold300, fontSize = 24.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp)
                    Text("Cinema, reimagined.", color = MovyzaColors.Text3, fontSize = 9.sp, letterSpacing = 1.sp)
                }
                GlassCircleButton(Icons.Outlined.Search, onSearch)
                Spacer(Modifier.width(7.dp))
                GlassCircleButton(Icons.Outlined.AccountCircle, onProfile)
            }
        }
        item {
            NativeHeroTemplate(
                movie = state.trending.firstOrNull(),
                onClick = state.trending.firstOrNull()?.let { { onOpen(it) } }
            )
        }
        item {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 13.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                GlassPill("أفلام", Icons.Outlined.LocalMovies, onSearch)
                GlassPill("مسلسلات", Icons.Outlined.Tv, onSearch)
                GlassPill("بحث", Icons.Outlined.Search, onSearch)
                GlassPill("قائمتي", Icons.Outlined.BookmarkAdded, onProfile)
            }
        }
        if (error != null) item { GlassError(error) }
        item { NativeTemplateSection("الأكثر رواجًا", "عناوين تتصدر Movyza", state.trending.drop(1), loading, onOpen) }
        item { NativeTemplateSection("أفلام شعبية", "اختيارات جاهزة للمشاهدة", state.movies, loading, onOpen) }
        item { NativeTemplateSection("الأعلى تقييمًا", "أقوى التقييمات", state.topRated, loading, onOpen) }
        item { NativeTemplateSection("مسلسلات شعبية", "جلسة مشاهدة جديدة", state.series, loading, onOpen) }
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
        color = GlassPanelStrong,
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
        color = GlassPanel,
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
                .shadow(5.dp, RoundedCornerShape(17.dp))
                .border(1.dp, Color.White.copy(alpha = .055f), RoundedCornerShape(17.dp))
                .background(MovyzaColors.Bg2)
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
                color = MovyzaColors.Bg.copy(alpha = .68f)
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
    Column(Modifier.fillMaxSize().background(MovyzaColors.Bg)) {
        Column(Modifier.padding(horizontal = 18.dp, vertical = 18.dp)) {
            Text(title, color = MovyzaColors.Text, fontSize = 28.sp, fontWeight = FontWeight.Black)
            Text(subtitle, color = MovyzaColors.Text3, fontSize = 10.sp, modifier = Modifier.padding(top = 3.dp))
        }
        val gridItems: List<Movie?> = if (movies.isEmpty() && loading) {
            List(8) { null }
        } else {
            movies
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 22.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            items(
                items = gridItems,
                key = { it?.mediaType + "-" + it?.id + "-" + (it?.title ?: "template") }
            ) { movie ->
                NativePosterTemplate(movie = movie, onClick = movie?.let { { onOpen(it) } })
            }
        }
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
        Modifier.fillMaxSize().background(MovyzaColors.Bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text("اكتشف", color = MovyzaColors.Text, fontSize = 29.sp, fontWeight = FontWeight.Black)
            Text("ابحث عن فيلم، مسلسل أو عنوان.", color = MovyzaColors.Text3, fontSize = 10.sp, modifier = Modifier.padding(top = 3.dp))
            Spacer(Modifier.height(12.dp))
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MovyzaColors.Glass,
                border = BorderStroke(1.dp, MovyzaColors.GlassBorder)
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("اكتب ما تبحث عنه…", color = MovyzaColors.Text3) },
                    leadingIcon = { Icon(Icons.Outlined.Search, null, tint = MovyzaColors.Gold300) },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MovyzaColors.Gold500.copy(alpha = .65f),
                        unfocusedBorderColor = Color.Transparent,
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent
                    ),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text)
                )
            }
        }
        if (results.isEmpty() && loading) {
            items(List(5) { it }) { NativeRowTemplate(null) }
        } else {
            items(results.take(30), key = { it.mediaType + "-" + it.id }) { movie ->
                NativeRowTemplate(movie, onClick = { onOpen(movie) })
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
        Modifier.fillMaxSize().background(MovyzaColors.Bg),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            Text("مساحتي", color = MovyzaColors.Text, fontSize = 29.sp, fontWeight = FontWeight.Black)
            Text("حسابك وقائمتك وتجربتك في مكان واحد.", color = MovyzaColors.Text3, fontSize = 10.sp)
        }
        item { NativeProfileTemplate(session, onLogin, onSignup, onLogout) }
        item {
            Column {
                Text("قائمتي", color = MovyzaColors.Text, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                Text(watchlist.size.toString() + " عنوان محفوظ", color = MovyzaColors.Text3, fontSize = 9.sp)
            }
        }
        if (watchlist.isEmpty()) {
            item { NativeEmptyWatchlist() }
        } else {
            items(watchlist, key = { it.mediaType + "-" + it.id }) { movie ->
                NativeRowTemplate(movie, onClick = { onOpen(movie) })
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
    LazyColumn(
        Modifier.fillMaxSize().background(MovyzaColors.Bg),
        contentPadding = PaddingValues(bottom = 24.dp)
    ) {
        item { NativeDetailHero(movie, details, onBack) }
        item { NativeDetailBody(movie, details, watchlisted, onWatch, onToggleWatchlist) }
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
        containerColor = GlassPanelStrong,
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
                    .background(MovyzaColors.Bg2.copy(alpha = alpha))
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
                            .background(MovyzaColors.Bg2.copy(alpha = alpha))
                    )
                }
            }
        }
    }
}


@Composable
private fun NativeHeroTemplate(
    movie: Movie?,
    onClick: (() -> Unit)? = null
) {
    val clickable = if (movie != null && onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Box(
        Modifier.fillMaxWidth().height(398.dp).padding(horizontal = 12.dp)
            .clip(RoundedCornerShape(24.dp)).background(MovyzaColors.Bg2)
            .border(1.dp, MovyzaColors.GlassBorder, RoundedCornerShape(24.dp))
            .then(clickable)
    ) {
        if (movie != null) {
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
                        .42f to Color.Transparent,
                        .72f to MovyzaColors.Bg.copy(alpha = .72f),
                        1f to MovyzaColors.Bg.copy(alpha = .98f)
                    )
                )
            )
            Column(Modifier.align(Alignment.BottomStart).padding(18.dp)) {
                MovyzaTemplateBadge("مختار لك")
                Spacer(Modifier.height(8.dp))
                Text(
                    movie.title.ifBlank { movie.originalTitle },
                    color = Color.White,
                    fontSize = 27.sp,
                    fontWeight = FontWeight.Black,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    listOfNotNull(
                        movie.releaseDate.takeIf { it.length >= 4 }?.take(4),
                        if (movie.mediaType == "series") "مسلسل" else "فيلم",
                        "★ " + String.format("%.1f", movie.rating)
                    ).joinToString("  •  "),
                    color = MovyzaColors.Gold300,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(7.dp))
                Text(
                    movie.overview.ifBlank { "استكشف هذا العنوان في Movyza." },
                    color = Color.White.copy(alpha = .72f),
                    fontSize = 10.sp,
                    lineHeight = 14.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        } else {
            Column(Modifier.align(Alignment.BottomStart).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.width(76.dp).height(20.dp).clip(RoundedCornerShape(99.dp)).background(Color.White.copy(alpha = .055f)))
                Box(Modifier.width(220.dp).height(28.dp).clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = .06f)))
                Box(Modifier.width(160.dp).height(12.dp).clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = .045f)))
            }
        }
    }
}

@Composable
private fun NativePosterTemplate(movie: Movie?, onClick: (() -> Unit)? = null) {
    val clickable = if (movie != null && onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Column(Modifier.fillMaxWidth().then(clickable)) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(.67f).clip(RoundedCornerShape(16.dp))
                .background(MovyzaColors.Bg2).border(1.dp, MovyzaColors.GlassBorder, RoundedCornerShape(16.dp))
        ) {
            if (movie != null) {
                AsyncImage(model = movie.posterUrl, contentDescription = movie.title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                MovyzaTemplateBadge("★ " + String.format("%.1f", movie.rating), Modifier.align(Alignment.TopStart).padding(7.dp))
            }
        }
        Text(
            movie?.title?.ifBlank { movie.originalTitle } ?: "عنوان الفيلم",
            color = if (movie == null) MovyzaColors.Text3 else MovyzaColors.Text,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 7.dp, start = 1.dp, end = 1.dp)
        )
        Text(
            if (movie == null) "      " else if (movie.mediaType == "series") "مسلسل" else movie.releaseDate.take(4),
            color = MovyzaColors.Text3,
            fontSize = 9.sp,
            modifier = Modifier.padding(top = 3.dp, start = 1.dp)
        )
    }
}

@Composable
private fun NativeRowTemplate(movie: Movie?, onClick: (() -> Unit)? = null) {
    val clickable = if (movie != null && onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Row(
        Modifier.fillMaxWidth().then(clickable).clip(RoundedCornerShape(16.dp))
            .background(MovyzaColors.Glass).border(1.dp, MovyzaColors.GlassBorder, RoundedCornerShape(16.dp)).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(68.dp, 96.dp).clip(RoundedCornerShape(11.dp)).background(MovyzaColors.Bg2)) {
            if (movie != null) {
                AsyncImage(model = movie.posterUrl, contentDescription = movie.title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            }
        }
        Column(Modifier.padding(horizontal = 10.dp).weight(1f)) {
            Text(
                movie?.title?.ifBlank { movie.originalTitle } ?: "عنوان الفيلم",
                color = if (movie == null) MovyzaColors.Text3 else MovyzaColors.Text,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                if (movie == null) "----  •  ----  •  ★ -" else listOfNotNull(
                    movie.releaseDate.takeIf { it.length >= 4 }?.take(4),
                    if (movie.mediaType == "series") "مسلسل" else "فيلم",
                    "★ " + String.format("%.1f", movie.rating)
                ).joinToString("  •  "),
                color = MovyzaColors.Gold300,
                fontSize = 9.sp,
                modifier = Modifier.padding(top = 6.dp)
            )
            Text(
                movie?.overview ?: "جارٍ ربط بيانات TMDB…",
                color = MovyzaColors.Text3,
                fontSize = 10.sp,
                lineHeight = 14.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp)
            )
        }
    }
}

@Composable
private fun NativeTemplateSection(
    title: String,
    subtitle: String,
    movies: List<Movie>,
    loading: Boolean,
    onOpen: (Movie) -> Unit
) {
    Column(Modifier.padding(top = 8.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, color = MovyzaColors.Text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Text(subtitle, color = MovyzaColors.Text3, fontSize = 9.sp)
            }
        }
        val items = if (movies.isEmpty() && loading) List<Movie?>(5) { null } else movies.take(12).map { it }
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(items, key = { it?.mediaType + "-" + it?.id + "-" + (it?.title ?: "template") }) { movie ->
                NativePosterTemplate(movie, movie?.let { { onOpen(it) } })
            }
        }
    }
}

@Composable
private fun NativeProfileTemplate(
    session: UserSession?,
    onLogin: () -> Unit,
    onSignup: () -> Unit,
    onLogout: () -> Unit
) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = MovyzaColors.Glass, border = BorderStroke(1.dp, MovyzaColors.GlassBorder)) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(54.dp).clip(CircleShape).background(MovyzaColors.Gold500), contentAlignment = Alignment.Center) {
                    Text(if (session == null) "M" else session.email.take(1).uppercase(), color = MovyzaColors.Bg, fontSize = 22.sp, fontWeight = FontWeight.Black)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (session == null) "أهلاً بك في Movyza" else session.email, color = MovyzaColors.Text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Text(if (session == null) "سجّل الدخول لمزامنة قائمتك" else "حساب Movyza • Supabase", color = MovyzaColors.Text3, fontSize = 9.sp, modifier = Modifier.padding(top = 3.dp))
                }
            }
            Spacer(Modifier.height(14.dp))
            if (session == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onLogin, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = MovyzaColors.Gold300, contentColor = MovyzaColors.Bg), shape = RoundedCornerShape(13.dp)) {
                        Text("تسجيل الدخول", fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(onClick = onSignup, modifier = Modifier.weight(1f), shape = RoundedCornerShape(13.dp)) {
                        Text("إنشاء حساب")
                    }
                }
            } else {
                OutlinedButton(onClick = onLogout, shape = RoundedCornerShape(13.dp)) { Text("تسجيل الخروج") }
            }
        }
    }
}

@Composable
private fun NativeEmptyWatchlist() {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = MovyzaColors.Glass, border = BorderStroke(1.dp, MovyzaColors.GlassBorder)) {
        Column(Modifier.padding(vertical = 30.dp, horizontal = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.BookmarkAdd, null, tint = MovyzaColors.Gold300, modifier = Modifier.size(28.dp))
            Spacer(Modifier.height(8.dp))
            Text("قائمتك جاهزة", color = MovyzaColors.Text, fontWeight = FontWeight.Bold)
            Text("أضف أول فيلم أو مسلسل تريد الرجوع إليه.", color = MovyzaColors.Text3, fontSize = 10.sp)
        }
    }
}

@Composable
private fun NativeDetailHero(movie: Movie, details: TmdbDetails?, onBack: () -> Unit) {
    Box(Modifier.fillMaxWidth().height(405.dp).background(MovyzaColors.Bg2)) {
        AsyncImage(model = details?.movie?.backdropUrl ?: movie.backdropUrl ?: movie.posterUrl, contentDescription = movie.title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, .44f to Color.Transparent, .72f to MovyzaColors.Bg.copy(alpha = .68f), 1f to MovyzaColors.Bg)))
        GlassCircleButton(Icons.Outlined.ArrowBack, onBack)
    }
}

@Composable
private fun NativeDetailBody(
    movie: Movie,
    details: TmdbDetails?,
    watchlisted: Boolean,
    onWatch: () -> Unit,
    onToggleWatchlist: () -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 16.dp)) {
        Text(movie.title.ifBlank { movie.originalTitle }, color = MovyzaColors.Text, fontSize = 28.sp, lineHeight = 32.sp, fontWeight = FontWeight.Black, maxLines = 3, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(8.dp))
        Text(
            listOfNotNull(
                movie.releaseDate.takeIf { it.length >= 4 }?.take(4),
                if (movie.mediaType == "series") "مسلسل" else "فيلم",
                "★ " + String.format("%.1f", movie.rating),
                details?.runtime?.takeIf { it > 0 }?.let { "$it د" }
            ).joinToString("  •  "),
            color = MovyzaColors.Gold300,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold
        )
        if (details == null) {
            NativeTextSkeleton()
        } else {
            if (details.genres.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    details.genres.take(4).forEach { genre ->
                        Surface(shape = RoundedCornerShape(999.dp), color = MovyzaColors.Glass) {
                            Text(genre, color = MovyzaColors.Text2, fontSize = 9.sp, modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp))
                        }
                    }
                }
            }
            details.tagline?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, color = MovyzaColors.Gold500, fontSize = 11.sp)
            }
            Spacer(Modifier.height(10.dp))
            Text(details.movie.overview.ifBlank { movie.overview }, color = MovyzaColors.Text2, fontSize = 11.sp, lineHeight = 17.sp)
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Button(
                onClick = onWatch,
                modifier = Modifier.weight(1f).height(50.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MovyzaColors.Gold300, contentColor = MovyzaColors.Bg),
                shape = RoundedCornerShape(14.dp)
            ) {
                Icon(Icons.Outlined.PlayArrow, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("مشاهدة", fontWeight = FontWeight.Black)
            }
            Surface(Modifier.size(50.dp), shape = RoundedCornerShape(14.dp), color = MovyzaColors.Glass, border = BorderStroke(1.dp, MovyzaColors.GlassBorder)) {
                IconButton(onClick = onToggleWatchlist) {
                    Icon(if (watchlisted) Icons.Outlined.BookmarkAdded else Icons.Outlined.BookmarkAdd, contentDescription = "قائمتي", tint = if (watchlisted) MovyzaColors.Gold300 else MovyzaColors.Text)
                }
            }
        }
    }
}

@Composable
private fun NativeTextSkeleton() {
    Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(4) { index ->
            Box(
                Modifier.fillMaxWidth(if (index < 2) .94f else .76f)
                    .height(11.dp).clip(RoundedCornerShape(8.dp))
                    .background(Color.White.copy(alpha = .045f))
            )
        }
    }
}

@Composable
private fun MovyzaTemplateBadge(text: String, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = RoundedCornerShape(999.dp), color = Color.Black.copy(alpha = .50f), border = BorderStroke(1.dp, Color.White.copy(alpha = .10f))) {
        Text(text, color = MovyzaColors.Gold300, fontSize = 8.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
    }
}

