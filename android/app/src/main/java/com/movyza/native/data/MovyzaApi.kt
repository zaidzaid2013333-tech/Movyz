package com.movyza.app.data

import com.movyza.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class MovyzaApi {
    private val client = OkHttpClient.Builder().build()
    private val tmdbBase = "https://api.themoviedb.org/3"
    private val supabaseBase = BuildConfig.SUPABASE_URL.trimEnd('/')

    fun configStatus(): AppConfigStatus {
        val hasTmdb = BuildConfig.TMDB_TOKEN.isNotBlank()
        val hasSupabase = supabaseBase.isNotBlank() && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()
        return if (hasTmdb && hasSupabase) {
            AppConfigStatus(true, "TMDB + Supabase جاهزان")
        } else {
            val missing = buildList {
                if (!hasTmdb) add("TMDB token")
                if (!hasSupabase) add("Supabase")
            }.joinToString("، ")
            AppConfigStatus(false, "الإعدادات الناقصة: $missing")
        }
    }

    suspend fun trending(): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("trending/all/week?language=ar-SA"))
    }

    suspend fun popularMovies(): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("movie/popular?language=ar-SA&page=1"), "movie")
    }

    suspend fun topRatedMovies(): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("movie/top_rated?language=ar-SA&page=1"), "movie")
    }

    suspend fun popularSeries(): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("tv/popular?language=ar-SA&page=1"), "series")
    }

    suspend fun search(query: String): List<Movie> = withContext(Dispatchers.IO) {
        if (query.isBlank()) return@withContext emptyList()
        parseMovies(tmdb("search/multi?query=" + java.net.URLEncoder.encode(query, "UTF-8") + "&language=ar-SA&include_adult=false&page=1"))
    }

    suspend fun details(id: Int, mediaType: String): TmdbDetails = withContext(Dispatchers.IO) {
        val path = if (mediaType == "series") "tv/" + id + "?language=ar-SA" else "movie/" + id + "?language=ar-SA"
        val obj = JSONObject(tmdb(path))
        val title = obj.optString(if (mediaType == "series") "name" else "title")
        val originalTitle = obj.optString(if (mediaType == "series") "original_name" else "original_title")
        val movie = Movie(
            id = id,
            title = title,
            originalTitle = originalTitle,
            overview = obj.optString("overview"),
            posterPath = obj.optString("poster_path").ifBlank { null },
            backdropPath = obj.optString("backdrop_path").ifBlank { null },
            releaseDate = obj.optString(if (mediaType == "series") "first_air_date" else "release_date"),
            rating = obj.optDouble("vote_average", 0.0),
            mediaType = mediaType
        )
        val genres = buildList {
            val arr = obj.optJSONArray("genres") ?: return@buildList
            for (i in 0 until arr.length()) add(arr.getJSONObject(i).optString("name"))
        }
        TmdbDetails(
            movie = movie,
            genres = genres,
            runtime = obj.optInt(if (mediaType == "series") "runtime" else "runtime", 0),
            tagline = obj.optString("tagline")
        )
    }

    suspend fun signIn(email: String, password: String): Result<UserSession> = withContext(Dispatchers.IO) {
        runCatching {
            val body = JSONObject().apply {
                put("email", email.trim())
                put("password", password)
            }
            val obj = supabaseRequest("POST", "/auth/v1/token?grant_type=password", body)
            val user = obj.getJSONObject("user")
            UserSession(obj.getString("access_token"), user.getString("id"), user.optString("email", email))
        }
    }

    suspend fun signUp(displayName: String, email: String, password: String): Result<UserSession?> = withContext(Dispatchers.IO) {
        runCatching {
            val body = JSONObject().apply {
                put("email", email.trim())
                put("password", password)
                put("data", JSONObject().put("display_name", displayName.trim()))
            }
            val obj = supabaseRequest("POST", "/auth/v1/signup", body)
            val accessToken = obj.optString("access_token")
            if (accessToken.isBlank()) null else {
                val user = obj.getJSONObject("user")
                UserSession(accessToken, user.getString("id"), user.optString("email", email))
            }
        }
    }

    suspend fun addToWatchlist(session: UserSession, movie: Movie): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val body = JSONObject()
                .put("user_id", session.userId)
                .put("content_type", if (movie.mediaType == "series") "series" else "movie")
                .put("content_id", movie.id.toString())
            supabaseRequest(
                "POST",
                "/rest/v1/watchlist",
                body,
                session.accessToken,
                mapOf("Prefer" to "resolution=merge-duplicates")
            )
        }.map { Unit }
    }

    suspend fun removeFromWatchlist(session: UserSession, movie: Movie): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val type = if (movie.mediaType == "series") "series" else "movie"
            supabaseRequest(
                "DELETE",
                "/rest/v1/watchlist?user_id=eq." + session.userId +
                    "&content_type=eq." + type +
                    "&content_id=eq." + movie.id,
                token = session.accessToken
            )
        }.map { Unit }
    }

    suspend fun watchlist(session: UserSession): List<Movie> = withContext(Dispatchers.IO) {
        val path = "/rest/v1/watchlist?select=content_type,content_id&user_id=eq." +
            session.userId + "&order=created_at.desc"
        val rows = supabaseArrayRequest(path, session.accessToken)
        val result = ArrayList<Movie>()
        for (i in 0 until rows.length()) {
            val row = rows.getJSONObject(i)
            val id = row.optString("content_id").toIntOrNull() ?: continue
            val type = row.optString("content_type").ifBlank { "movie" }
            runCatching { details(id, type) }.getOrNull()?.let { result += it.movie }
        }
        result
    }

    private fun tmdb(path: String): String {
        if (BuildConfig.TMDB_TOKEN.isBlank()) throw IOException("TMDB token is missing")
        val request = Request.Builder()
            .url(tmdbBase + "/" + path)
            .header("Authorization", "Bearer " + BuildConfig.TMDB_TOKEN)
            .header("Accept", "application/json")
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("TMDB " + response.code + ": " + text)
            return text
        }
    }

    private fun supabaseRequest(
        method: String,
        path: String,
        body: JSONObject? = null,
        token: String? = null,
        extraHeaders: Map<String, String> = emptyMap()
    ): JSONObject {
        require(supabaseBase.isNotBlank()) { "Supabase URL is missing" }
        require(BuildConfig.SUPABASE_ANON_KEY.isNotBlank()) { "Supabase anon key is missing" }
        val requestBuilder = Request.Builder()
            .url(supabaseBase + path)
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Authorization", "Bearer " + (token ?: BuildConfig.SUPABASE_ANON_KEY))
            .header("Content-Type", "application/json")
        extraHeaders.forEach { (key, value) -> requestBuilder.header(key, value) }
        val requestBody = (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType())
        val request = when (method) {
            "POST" -> requestBuilder.post(requestBody).build()
            "DELETE" -> requestBuilder.delete().build()
            else -> requestBuilder.get().build()
        }
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("Supabase " + response.code + ": " + text)
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun supabaseArrayRequest(path: String, token: String): JSONArray {
        val request = Request.Builder()
            .url(supabaseBase + path)
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Authorization", "Bearer " + token)
            .header("Accept", "application/json")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("Supabase " + response.code + ": " + text)
            return JSONArray(text)
        }
    }

    private fun parseMovies(json: String, forcedType: String? = null): List<Movie> {
        val arr = JSONObject(json).optJSONArray("results") ?: return emptyList()
        val result = ArrayList<Movie>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val type = forcedType ?: o.optString("media_type")
            if (type != "movie" && type != "tv" && type != "series") continue
            val series = type == "tv" || type == "series"
            result += Movie(
                id = o.optInt("id"),
                title = o.optString(if (series) "name" else "title"),
                originalTitle = o.optString(if (series) "original_name" else "original_title"),
                overview = o.optString("overview"),
                posterPath = o.optString("poster_path").ifBlank { null },
                backdropPath = o.optString("backdrop_path").ifBlank { null },
                releaseDate = o.optString(if (series) "first_air_date" else "release_date"),
                rating = o.optDouble("vote_average", 0.0),
                mediaType = if (series) "series" else "movie"
            )
        }
        return result.filter { it.id != 0 && !it.posterPath.isNullOrBlank() }
    }
}
