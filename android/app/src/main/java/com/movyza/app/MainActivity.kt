package com.movyza.app

import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocalMovies
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import com.movyza.app.data.Movie
import com.movyza.app.data.MovyzaApi
import com.movyza.app.data.TmdbDetails
import com.movyza.app.data.UserSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private val MovyzaDark = darkColorScheme(
    primary = Color(0xFFB7FF3C),
    secondary = Color(0xFF8BD0FF),
    background = Color(0xFF06070A),
    surface = Color(0xFF0D1015),
    surfaceVariant = Color(0xFF171B22),
    onPrimary = Color(0xFF101500),
    onBackground = Color(0xFFF2F5F7),
    onSurface = Color(0xFFF2F5F7)
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = MovyzaDark) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    MovyzaApp()
                }
            }
        }
    }
}

data class HomeState(
    val trending: List<Movie> = emptyList(),
    val movies: List<Movie> = emptyList(),
    val topRated: List<Movie> = emptyList(),
    val series: List<Movie> = emptyList()
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val api = MovyzaApi()
    private val prefs = app.getSharedPreferences("movyza_session", Context.MODE_PRIVATE)

    private val _home = MutableStateFlow(HomeState())
    val home: StateFlow<HomeState> = _home.asStateFlow()

    private val _search = MutableStateFlow<List<Movie>>(emptyList())
    val search: StateFlow<List<Movie>> = _search.asStateFlow()

    private val _watchlist = MutableStateFlow<List<Movie>>(emptyList())
    val watchlist: StateFlow<List<Movie>> = _watchlist.asStateFlow()

    var session by mutableStateOf<UserSession?>(restoreSession())
        private set
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    val config = api.configStatus()

    init { refreshHome() }

    fun refreshHome() {
        viewModelScope.launch {
            loading = true
            error = null
            runCatching {
                HomeState(
                    trending = api.trending(),
                    movies = api.popularMovies(),
                    topRated = api.topRatedMovies(),
                    series = api.popularSeries()
                )
            }.onSuccess { _home.value = it }
                .onFailure { error = it.message ?: "تعذر تحميل الكتالوج" }
            loading = false
            loadWatchlist()
        }
    }

    fun search(query: String) {
        viewModelScope.launch {
            if (query.isBlank()) { _search.value = emptyList(); return@launch }
            loading = true
            runCatching { api.search(query) }
                .onSuccess { _search.value = it }
                .onFailure { error = it.message ?: "تعذر البحث" }
            loading = false
        }
    }

    fun loadWatchlist() {
        val current = session ?: return
        viewModelScope.launch {
            runCatching { api.watchlist(current) }.onSuccess { _watchlist.value = it }
        }
    }

    fun signIn(email: String, password: String, onDone: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            loading = true
            api.signIn(email, password).onSuccess {
                session = it
                saveSession(it)
                loadWatchlist()
                onDone(true, "تم تسجيل الدخول")
            }.onFailure {
                onDone(false, it.message ?: "فشل تسجيل الدخول")
            }
            loading = false
        }
    }

    fun signUp(name: String, email: String, password: String, onDone: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            loading = true
            api.signUp(name, email, password).onSuccess { created ->
                if (created != null) {
                    session = created
                    saveSession(created)
                    onDone(true, "تم إنشاء الحساب")
                } else {
                    onDone(true, "تم إنشاء الحساب. تحقق من بريدك ثم سجّل الدخول.")
                }
            }.onFailure {
                onDone(false, it.message ?: "فشل إنشاء الحساب")
            }
            loading = false
        }
    }

    fun toggleWatchlist(movie: Movie, onMessage: (String) -> Unit) {
        val current = session ?: run {
            onMessage("سجّل الدخول أولًا")
            return
        }
        viewModelScope.launch {
            val exists = _watchlist.value.any { it.id == movie.id && it.mediaType == movie.mediaType }
            val result = if (exists) api.removeFromWatchlist(current, movie) else api.addToWatchlist(current, movie)
            result.onSuccess {
                loadWatchlist()
                onMessage(if (exists) "أزيل من قائمتي" else "أضيف إلى قائمتي")
            }.onFailure { onMessage(it.message ?: "تعذر تحديث القائمة") }
        }
    }

    fun signOut() {
        session = null
        prefs.edit().clear().apply()
        _watchlist.value = emptyList()
    }

    private fun restoreSession(): UserSession? {
        val token = prefs.getString("token", null) ?: return null
        val id = prefs.getString("id", null) ?: return null
        val email = prefs.getString("email", "") ?: ""
        return UserSession(token, id, email)
    }

    private fun saveSession(s: UserSession) {
        prefs.edit().putString("token", s.accessToken).putString("id", s.userId).putString("email", s.email).apply()
    }
}

enum class Tab(val label: String) { HOME("الرئيسية"), MOVIES("أفلام"), SERIES("مسلسلات"), SEARCH("بحث"), PROFILE("حسابي") }

@Composable
fun MovyzaApp(vm: MainViewModel = viewModel()) {
    var tab by remember { mutableStateOf(Tab.HOME) }
    var selected by remember { mutableStateOf<Movie?>(null) }
    var detail by remember { mutableStateOf<TmdbDetails?>(null) }
    var showAuth by remember { mutableStateOf(false) }
    var loginMode by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val home by vm.home.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val watchlist by vm.watchlist.collectAsStateWithLifecycle()

    if (showAuth) {
        AuthDialog(
            login = loginMode,
            loading = vm.loading,
            onDismiss = { showAuth = false },
            onToggle = { loginMode = !loginMode },
            onSubmit = { name, email, password ->
                if (loginMode) {
                    vm.signIn(email, password) { ok, message ->
                        scope.launch { snackbar.showSnackbar(message) }
                        if (ok) showAuth = false
                    }
                } else {
                    vm.signUp(name, email, password) { ok, message ->
                        scope.launch { snackbar.showSnackbar(message) }
                        if (ok && message == "تم إنشاء الحساب") showAuth = false
                    }
                }
            }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF0A0C10)) {
                Tab.values().forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        icon = {
                            Icon(
                                when (item) {
                                    Tab.HOME -> Icons.Filled.Home
                                    Tab.MOVIES -> Icons.Filled.LocalMovies
                                    Tab.SERIES -> Icons.Filled.Tv
                                    Tab.SEARCH -> Icons.Filled.Search
                                    Tab.PROFILE -> Icons.Filled.Person
                                },
                                contentDescription = item.label
                            )
                        },
                        label = { Text(item.label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MovyzaDark.primary,
                            selectedTextColor = MovyzaDark.primary,
                            indicatorColor = Color(0xFF17200D)
                        )
                    )
                }
            }
        },
        containerColor = MovyzaDark.background
    ) { padding ->
        AnimatedContent(
            targetState = tab,
            modifier = Modifier.padding(padding),
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "tab"
        ) { current ->
            when (current) {
                Tab.HOME -> HomeScreen(
                    state = home,
                    loading = vm.loading,
                    error = vm.error,
                    onOpen = { movie -> selected = movie },
                    onRefresh = { vm.refreshHome() }
                )
                Tab.MOVIES -> CatalogScreen("أفلام", home.movies, vm.loading, onOpen = { selected = it })
                Tab.SERIES -> CatalogScreen("مسلسلات", home.series, vm.loading, onOpen = { selected = it })
                Tab.SEARCH -> SearchScreen(search, vm.loading, onQuery = vm::search, onOpen = { selected = it })
                Tab.PROFILE -> ProfileScreen(
                    session = vm.session,
                    watchlist = watchlist,
                    onOpen = { selected = it },
                    onLogin = { loginMode = true; showAuth = true },
                    onSignup = { loginMode = false; showAuth = true },
                    onLogout = vm::signOut
                )
            }
        }
    }

    selected?.let { movie ->
        DetailScreen(
            movie = movie,
            details = detail,
            watchlisted = watchlist.any { it.id == movie.id && it.mediaType == movie.mediaType },
            onBack = { selected = null; detail = null },
            onLoad = {
                scope.launch {
                    runCatching { vmDetails(vm, movie) }.onSuccess { detail = it }
                }
            },
            onToggleWatchlist = {
                vm.toggleWatchlist(movie) { msg -> scope.launch { snackbar.showSnackbar(msg) } }
            }
        )
    }
}

suspend fun vmDetails(vm: MainViewModel, movie: Movie): TmdbDetails {
    val api = MovyzaApi()
    return api.details(movie.id, movie.mediaType)
}

@Composable
fun HomeScreen(state: HomeState, loading: Boolean, error: String?, onOpen: (Movie) -> Unit, onRefresh: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF0A0D11), Color(0xFF06070A), Color(0xFF06070A)))
        ),
        contentPadding = PaddingValues(bottom = 28.dp)
    ) {
        item {
            Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("MOVYZA", fontSize = 28.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp)
                        Text("اكتشف شيئًا يستحق المشاهدة", color = Color(0xFF98A0AA))
                    }
                    IconButton(onClick = onRefresh) { Icon(Icons.Filled.AccountCircle, "الحساب", tint = MovyzaDark.primary) }
                }
                Spacer(Modifier.height(18.dp))
                if (state.trending.isNotEmpty()) FeaturedCard(state.trending.first(), onOpen)
                if (error != null) {
                    Spacer(Modifier.height(12.dp))
                    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF241418))) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(error, color = Color(0xFFFF9EA7), modifier = Modifier.weight(1f))
                            TextButton(onClick = onRefresh) { Text("إعادة") }
                        }
                    }
                }
                if (loading) {
                    Spacer(Modifier.height(18.dp))
                    LinearLoading()
                }
            }
        }
        item { Section("الأكثر رواجًا", state.trending, onOpen) }
        item { Section("أفلام شعبية", state.movies, onOpen) }
        item { Section("الأعلى تقييمًا", state.topRated, onOpen) }
        item { Section("مسلسلات شعبية", state.series, onOpen) }
    }
}

@Composable
fun FeaturedCard(movie: Movie, onOpen: (Movie) -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(390.dp).clip(RoundedCornerShape(28.dp)).clickable { onOpen(movie) }
    ) {
        AsyncImage(model = movie.backdropUrl ?: movie.posterUrl, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xFF06070A)))))
        Column(
            Modifier.align(Alignment.BottomStart).padding(22.dp)
        ) {
            Text("TRENDING", color = MovyzaDark.primary, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
            Text(movie.title, fontSize = 27.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                if (movie.overview.isBlank()) "اضغط لعرض التفاصيل" else movie.overview,
                color = Color(0xFFD0D5DB),
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 6.dp)
            )
        }
    }
}

@Composable
fun Section(title: String, movies: List<Movie>, onOpen: (Movie) -> Unit) {
    if (movies.isEmpty()) return
    Column(Modifier.padding(top = 24.dp)) {
        Row(
            Modifier.padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 19.sp, modifier = Modifier.weight(1f))
            Text("المزيد", color = Color(0xFF8C949E), fontSize = 13.sp)
        }
        LazyRow(
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(movies.take(12)) { MovieCard(it, onOpen) }
        }
    }
}

@Composable
fun MovieCard(movie: Movie, onOpen: (Movie) -> Unit) {
    Column(
        Modifier.width(142.dp).clickable { onOpen(movie) }
    ) {
        Box(Modifier.fillMaxWidth().height(210.dp).clip(RoundedCornerShape(18.dp))) {
            AsyncImage(model = movie.posterUrl, contentDescription = movie.title, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            Surface(
                modifier = Modifier.padding(8.dp).align(Alignment.TopEnd),
                shape = RoundedCornerShape(10.dp),
                color = Color(0xCC101318)
            ) {
                Text("★ " + String.format("%.1f", movie.rating), fontSize = 11.sp, modifier = Modifier.padding(horizontal = 7.dp, vertical = 4.dp))
            }
        }
        Text(
            movie.title.ifBlank { movie.originalTitle },
            modifier = Modifier.padding(top = 8.dp),
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            fontWeight = FontWeight.SemiBold
        )
        Text(if (movie.mediaType == "series") "مسلسل" else "فيلم", color = Color(0xFF8C949E), fontSize = 11.sp)
    }
}

@Composable
fun CatalogScreen(title: String, movies: List<Movie>, loading: Boolean, onOpen: (Movie) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 22.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Text(title, fontSize = 28.sp, fontWeight = FontWeight.Black)
            if (loading) LinearLoading()
        }
        items(movies) { MovieListCard(it, onOpen) }
    }
}

@Composable
fun MovieListCard(movie: Movie, onOpen: (Movie) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Color(0xFF0D1015)).clickable { onOpen(movie) }.padding(8.dp)
    ) {
        AsyncImage(model = movie.posterUrl, contentDescription = null, modifier = Modifier.size(88.dp, 124.dp).clip(RoundedCornerShape(14.dp)), contentScale = ContentScale.Crop)
        Column(Modifier.padding(start = 13.dp, end = 6.dp).weight(1f)) {
            Text(movie.title, fontWeight = FontWeight.Bold, fontSize = 17.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(5.dp))
            Text(movie.releaseDate.take(4), color = Color(0xFF8C949E), fontSize = 12.sp)
            Text("★ " + String.format("%.1f", movie.rating), color = MovyzaDark.primary, fontSize = 12.sp)
            Spacer(Modifier.height(8.dp))
            Text(movie.overview, color = Color(0xFFAAB0B7), fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun SearchScreen(results: List<Movie>, loading: Boolean, onQuery: (String) -> Unit, onOpen: (Movie) -> Unit) {
    var query by remember { mutableStateOf("") }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Text("ابحث", fontSize = 28.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = { query = it; onQuery(it) },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("فيلم، مسلسل، ممثل...") },
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                singleLine = true
            )
            if (loading) LinearLoading()
        }
        items(results) { MovieListCard(it, onOpen) }
    }
}

@Composable
fun ProfileScreen(
    session: UserSession?,
    watchlist: List<Movie>,
    onOpen: (Movie) -> Unit,
    onLogin: () -> Unit,
    onSignup: () -> Unit,
    onLogout: () -> Unit
) {
    LazyColumn(contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item {
            Text("حسابي", fontSize = 30.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.height(8.dp))
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFF0E1116))) {
                Column(Modifier.fillMaxWidth().padding(18.dp)) {
                    Icon(Icons.Filled.Person, null, modifier = Modifier.size(40.dp), tint = MovyzaDark.primary)
                    Spacer(Modifier.height(8.dp))
                    if (session == null) {
                        Text("أهلاً بك في Movyza", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("سجّل الدخول لمزامنة قائمتك عبر Supabase.", color = Color(0xFF9AA2AC))
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(onClick = onLogin) { Text("تسجيل الدخول") }
                            OutlinedButton(onClick = onSignup) { Text("إنشاء حساب") }
                        }
                    } else {
                        Text(session.email, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                        Text("حساب Movyza • Supabase", color = Color(0xFF9AA2AC))
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = onLogout) { Text("تسجيل الخروج") }
                    }
                }
            }
        }
        item { Text("قائمتي", fontWeight = FontWeight.Bold, fontSize = 20.sp) }
        if (watchlist.isEmpty()) {
            item { Text("قائمتك فارغة حاليًا.", color = Color(0xFF8C949E)) }
        } else {
            items(watchlist) { MovieCard(it, onOpen) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthDialog(
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
        title = { Text(if (login) "تسجيل الدخول" else "إنشاء حساب") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!login) OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("الاسم") }, singleLine = true)
                OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("البريد الإلكتروني") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("كلمة المرور") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                TextButton(onClick = onToggle) { Text(if (login) "ليس لديك حساب؟ إنشاء حساب" else "لديك حساب؟ تسجيل الدخول") }
            }
        },
        confirmButton = {
            Button(
                enabled = !loading && email.isNotBlank() && password.length >= 6,
                onClick = { onSubmit(name, email, password) }
            ) { if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(if (login) "دخول" else "تسجيل") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } }
    )
}

@Composable
fun DetailScreen(
    movie: Movie,
    details: TmdbDetails?,
    watchlisted: Boolean,
    onBack: () -> Unit,
    onLoad: () -> Unit,
    onToggleWatchlist: () -> Unit
) {
    LaunchedEffect(movie.id, movie.mediaType) {
        if (details == null) onLoad()
    }
    Box(Modifier.fillMaxSize().background(Color(0xFF06070A))) {
        AsyncImage(model = details?.movie?.backdropUrl ?: movie.backdropUrl, contentDescription = null, modifier = Modifier.fillMaxWidth().height(350.dp), contentScale = ContentScale.Crop)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, 0.42f to Color(0xFF06070A), 0.72f to Color(0xFF06070A))))
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "رجوع") }
                Text("تفاصيل", fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.weight(1f))
            Column(Modifier.padding(20.dp)) {
                Text(movie.title, fontSize = 30.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(
                        movie.releaseDate.take(4).ifBlank { null },
                        "★ " + String.format("%.1f", movie.rating),
                        if (movie.mediaType == "series") "مسلسل" else "فيلم"
                    ).joinToString("  •  "),
                    color = MovyzaDark.primary
                )
                if (details?.tagline.orEmpty().isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(details!!.tagline, color = Color(0xFFB1B8C1), fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
                }
                Spacer(Modifier.height(12.dp))
                Text(
                    details?.movie?.overview ?: movie.overview.ifBlank { "تحميل التفاصيل..." },
                    color = Color(0xFFD6DBE0),
                    maxLines = 5,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = onToggleWatchlist) {
                        Text(if (watchlisted) "✓ في قائمتي" else "+ قائمتي")
                    }
                    AssistChip(onClick = {}, label = { Text("Native Android") })
                }
            }
        }
    }
}

@Composable
fun LinearLoading() {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
    }
}
