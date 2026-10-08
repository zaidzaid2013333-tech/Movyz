package com.movyza.app

import android.app.Application
import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.movyza.app.data.EpisodeItem
import com.movyza.app.data.Movie
import com.movyza.app.data.MovyzaApi
import com.movyza.app.data.TmdbDetails
import com.movyza.app.data.UserSession
import com.movyza.app.data.WatchHistoryEntry
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Immutable
data class HomeState(
    val trending: List<Movie> = emptyList(),
    val movies: List<Movie> = emptyList(),
    val topRated: List<Movie> = emptyList(),
    val series: List<Movie> = emptyList(),
    val topRatedSeries: List<Movie> = emptyList()
)

enum class Tab(val label: String) {
    HOME("الرئيسية"),
    MOVIES("أفلام"),
    SERIES("مسلسلات"),
    SEARCH("بحث"),
    PROFILE("حسابي")
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MovyzaTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MovyzaColors.Bg) {
                    MovyzaNativeApp()
                }
            }
        }
    }
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    companion object {
        const val HISTORY_PREFS = "movyza_watch_history"
        const val HISTORY_KEY = "entries_json"
    }

    private val api = MovyzaApi.instance
    private val prefs = app.getSharedPreferences("movyza_session", Context.MODE_PRIVATE)
    private val historyPrefs = app.getSharedPreferences(HISTORY_PREFS, Context.MODE_PRIVATE)

    private val _home = MutableStateFlow(HomeState())
    val home: StateFlow<HomeState> = _home.asStateFlow()

    private val _search = MutableStateFlow<List<Movie>>(emptyList())
    val search: StateFlow<List<Movie>> = _search.asStateFlow()

    private val _watchlist = MutableStateFlow<List<Movie>>(emptyList())
    val watchlist: StateFlow<List<Movie>> = _watchlist.asStateFlow()

    private val _watchHistory = MutableStateFlow<List<WatchHistoryEntry>>(emptyList())
    val watchHistory: StateFlow<List<WatchHistoryEntry>> = _watchHistory.asStateFlow()

    private val detailsCache = mutableMapOf<String, TmdbDetails>()
    private val episodesCache = mutableMapOf<String, List<EpisodeItem>>()

    var session by mutableStateOf(restoreSession())
        private set
    var loading by mutableStateOf(false)
        private set
    var searchLoading by mutableStateOf(false)
        private set
    var moviesPage by mutableStateOf(1)
        private set
    var seriesPage by mutableStateOf(1)
        private set
    var loadingMoreMovies by mutableStateOf(false)
        private set
    var loadingMoreSeries by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private var lastSearchQuery: String = ""
    val config = api.configStatus()

    private var initialLoadStarted = false

    init {
        refreshWatchHistory()
    }

    fun startInitialLoad() {
        if (initialLoadStarted) return
        initialLoadStarted = true
        refreshHome()
        if (session != null) {
            loadWatchlist()
        }
    }

    fun refreshWatchHistory() {
        val raw = historyPrefs.getString(HISTORY_KEY, null) ?: run {
            _watchHistory.value = emptyList()
            return
        }
        runCatching {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val id = o.optInt("id", 0)
                    if (id == 0) continue
                    add(
                        WatchHistoryEntry(
                            id = id,
                            mediaType = o.optString("mediaType", "movie"),
                            title = o.optString("title", "MOVYZA"),
                            posterPath = o.optString("posterPath").ifBlank { null },
                            backdropPath = o.optString("backdropPath").ifBlank { null },
                            rating = o.optDouble("rating", 0.0),
                            releaseDate = o.optString("releaseDate", ""),
                            season = o.optInt("season", 1),
                            episode = o.optInt("episode", 1),
                            positionMs = o.optLong("positionMs", 0L),
                            durationMs = o.optLong("durationMs", 0L),
                            updatedAt = o.optLong("updatedAt", 0L)
                        )
                    )
                }
            }.sortedByDescending { it.updatedAt }
        }.onSuccess {
            _watchHistory.value = it
        }
    }

    fun clearWatchHistory() {
        historyPrefs.edit().remove(HISTORY_KEY).apply()
        _watchHistory.value = emptyList()
    }

    fun recordMediaOpened(movie: Movie, season: Int, episode: Int) {
        val current = _watchHistory.value.toMutableList()
        val idx = current.indexOfFirst { it.id == movie.id && it.mediaType == movie.mediaType }
        val existing = if (idx >= 0) current.removeAt(idx) else null
        val updated = WatchHistoryEntry(
            id = movie.id,
            mediaType = movie.mediaType,
            title = movie.displayTitle,
            posterPath = movie.posterPath ?: existing?.posterPath,
            backdropPath = movie.backdropPath ?: existing?.backdropPath,
            rating = movie.rating,
            releaseDate = movie.releaseDate,
            season = season,
            episode = episode,
            positionMs = existing?.positionMs ?: 30_000L,
            durationMs = existing?.durationMs ?: 1_200_000L,
            updatedAt = System.currentTimeMillis()
        )
        current.add(0, updated)
        val trimmed = current.take(20)
        _watchHistory.value = trimmed
        saveHistoryList(trimmed)
    }

    private fun saveHistoryList(list: List<WatchHistoryEntry>) {
        val arr = JSONArray()
        list.forEach { item ->
            arr.put(
                JSONObject().apply {
                    put("id", item.id)
                    put("mediaType", item.mediaType)
                    put("title", item.title)
                    put("posterPath", item.posterPath.orEmpty())
                    put("backdropPath", item.backdropPath.orEmpty())
                    put("rating", item.rating)
                    put("releaseDate", item.releaseDate)
                    put("season", item.season)
                    put("episode", item.episode)
                    put("positionMs", item.positionMs)
                    put("durationMs", item.durationMs)
                    put("updatedAt", item.updatedAt)
                }
            )
        }
        historyPrefs.edit().putString(HISTORY_KEY, arr.toString()).apply()
    }

    fun refreshHome() {
        viewModelScope.launch {
            loading = true
            error = null

            // Critical path: fetch only what is needed to paint the first home screen.
            val coreResult = runCatching {
                coroutineScope {
                    val trending = async { api.trending() }
                    val movies = async { api.popularMovies(1) }
                    trending.await() to movies.await()
                }
            }

            coreResult.onSuccess { (trending, movies) ->
                moviesPage = 1
                _home.value = _home.value.copy(
                    trending = trending,
                    movies = movies
                )

                // The first screen is usable now. Fetch secondary shelves in the background
                // so startup is not blocked by five simultaneous TMDB calls.
                loading = false
                launch {
                    runCatching {
                        coroutineScope {
                            val topRated = async { api.topRatedMovies(1) }
                            val series = async { api.popularSeries(1) }
                            val topRatedSeries = async {
                                runCatching { api.topRatedSeries(1) }.getOrDefault(emptyList())
                            }
                            Triple(topRated.await(), series.await(), topRatedSeries.await())
                        }
                    }.onSuccess { (topRated, series, topRatedSeries) ->
                        moviesPage = 1
                        seriesPage = 1
                        _home.value = _home.value.copy(
                            topRated = topRated,
                            series = series,
                            topRatedSeries = topRatedSeries
                        )
                    }.onFailure {
                        // Secondary shelves are optional; keep the already-rendered home usable.
                    }
                }
            }.onFailure {
                error = it.message ?: "تعذر تحميل الكتالوج، تحقق من الاتصال بالإنترنت."
                loading = false
                return@launch
            }
        }
    }

    fun loadMoreMovies() {
        if (loadingMoreMovies || loading || moviesPage >= 8) return
        val nextPage = moviesPage + 1
        viewModelScope.launch {
            loadingMoreMovies = true
            runCatching {
                coroutineScope {
                    val morePopular = async { api.popularMovies(nextPage) }
                    val moreTop = async { runCatching { api.topRatedMovies(nextPage) }.getOrDefault(emptyList()) }
                    morePopular.await() to moreTop.await()
                }
            }.onSuccess { (morePop, moreTop) ->
                moviesPage = nextPage
                val current = _home.value
                _home.value = current.copy(
                    movies = (current.movies + morePop).distinctBy { it.id },
                    topRated = (current.topRated + moreTop).distinctBy { it.id }
                )
            }
            loadingMoreMovies = false
        }
    }

    fun loadMoreSeries() {
        if (loadingMoreSeries || loading || seriesPage >= 8) return
        val nextPage = seriesPage + 1
        viewModelScope.launch {
            loadingMoreSeries = true
            runCatching {
                coroutineScope {
                    val morePopular = async { api.popularSeries(nextPage) }
                    val moreTop = async { runCatching { api.topRatedSeries(nextPage) }.getOrDefault(emptyList()) }
                    morePopular.await() to moreTop.await()
                }
            }.onSuccess { (morePop, moreTop) ->
                seriesPage = nextPage
                val current = _home.value
                _home.value = current.copy(
                    series = (current.series + morePop).distinctBy { it.id },
                    topRatedSeries = (current.topRatedSeries + moreTop).distinctBy { it.id }
                )
            }
            loadingMoreSeries = false
        }
    }

    fun search(query: String) {
        val clean = query.trim()
        if (clean.isBlank()) {
            lastSearchQuery = ""
            _search.value = emptyList()
            searchLoading = false
            return
        }
        if (clean == lastSearchQuery && _search.value.isNotEmpty()) return
        lastSearchQuery = clean

        viewModelScope.launch {
            searchLoading = true
            runCatching { api.search(clean) }
                .onSuccess { _search.value = it }
                .onFailure { _search.value = emptyList() }
            searchLoading = false
        }
    }

    fun fetchDetails(movie: Movie, onResult: (TmdbDetails?) -> Unit) {
        val key = "${movie.mediaType}:${movie.id}"
        detailsCache[key]?.let {
            onResult(it)
            return
        }
        viewModelScope.launch {
            val loaded = runCatching { api.details(movie.id, movie.mediaType) }
                .getOrNull()
                ?.also { detailsCache[key] = it }
            onResult(loaded)
        }
    }

    fun fetchSeasonEpisodes(seriesId: Int, seasonNumber: Int, onResult: (List<EpisodeItem>) -> Unit) {
        val key = "$seriesId:$seasonNumber"
        episodesCache[key]?.let {
            onResult(it)
            return
        }
        viewModelScope.launch {
            val loaded = runCatching { api.seasonEpisodes(seriesId, seasonNumber) }
                .getOrDefault(emptyList())
                .also { if (it.isNotEmpty()) episodesCache[key] = it }
            onResult(loaded)
        }
    }

    fun loadWatchlist() {
        val current = session ?: return
        viewModelScope.launch {
            runCatching { api.watchlist(current) }
                .onSuccess { _watchlist.value = it }
        }
    }

    fun signIn(email: String, password: String, onDone: (Boolean, String) -> Unit) {
        viewModelScope.launch {
            loading = true
            api.signIn(email, password).onSuccess {
                session = it
                saveSession(it)
                loadWatchlist()
                onDone(true, "تم تسجيل الدخول بنجاح")
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
            onMessage("سجّل الدخول أولًا لحفظ العناوين في قائمتك")
            return
        }
        val currentList = _watchlist.value
        val exists = currentList.any { it.id == movie.id && it.mediaType == movie.mediaType }

        _watchlist.value = if (exists) {
            currentList.filterNot { it.id == movie.id && it.mediaType == movie.mediaType }
        } else {
            listOf(movie) + currentList
        }

        viewModelScope.launch {
            val result = if (exists) {
                api.removeFromWatchlist(current, movie)
            } else {
                api.addToWatchlist(current, movie)
            }
            result.onSuccess {
                onMessage(if (exists) "تمت الإزالة من قائمتي" else "تمت الإضافة إلى قائمتي")
            }.onFailure {
                _watchlist.value = currentList
                onMessage(it.message ?: "تعذر تحديث القائمة")
            }
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
        prefs.edit()
            .putString("token", s.accessToken)
            .putString("id", s.userId)
            .putString("email", s.email)
            .apply()
    }
}
