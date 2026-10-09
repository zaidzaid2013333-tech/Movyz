package com.movyza.app.data

import com.movyza.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class MovyzaApi {
    companion object {
        val instance: MovyzaApi by lazy { MovyzaApi() }

        private val sharedClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(12, TimeUnit.SECONDS)
                .readTimeout(18, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }
    }

    private val client: OkHttpClient = sharedClient
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

    suspend fun popularMovies(page: Int = 1): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("movie/popular?language=ar-SA&page=${page.coerceAtLeast(1)}"), "movie")
    }

    suspend fun topRatedMovies(page: Int = 1): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("movie/top_rated?language=ar-SA&page=${page.coerceAtLeast(1)}"), "movie")
    }

    suspend fun popularSeries(page: Int = 1): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("tv/popular?language=ar-SA&page=${page.coerceAtLeast(1)}"), "series")
    }

    suspend fun topRatedSeries(page: Int = 1): List<Movie> = withContext(Dispatchers.IO) {
        parseMovies(tmdb("tv/top_rated?language=ar-SA&page=${page.coerceAtLeast(1)}"), "series")
    }

    suspend fun search(query: String): List<Movie> = withContext(Dispatchers.IO) {
        val clean = query.trim()
        if (clean.isBlank()) return@withContext emptyList()
        val encoded = java.net.URLEncoder.encode(clean, "UTF-8")
        parseMovies(tmdb("search/multi?query=$encoded&language=ar-SA&include_adult=false&page=1"))
    }

    suspend fun details(id: Int, mediaType: String): TmdbDetails = withContext(Dispatchers.IO) {
        val isSeries = mediaType == "series" || mediaType == "tv"
        val normalizedType = if (isSeries) "series" else "movie"
        val endpoint = if (isSeries) {
            "tv/$id?language=ar-SA&append_to_response=credits,similar"
        } else {
            "movie/$id?language=ar-SA&append_to_response=credits,similar"
        }
        val obj = JSONObject(tmdb(endpoint))
        val title = obj.optString(if (isSeries) "name" else "title")
        val originalTitle = obj.optString(if (isSeries) "original_name" else "original_title")
        val genresArray = obj.optJSONArray("genres")
        val genreIds = buildList {
            if (genresArray != null) {
                for (i in 0 until genresArray.length()) {
                    val gid = genresArray.optJSONObject(i)?.optInt("id", 0) ?: 0
                    if (gid != 0) add(gid)
                }
            }
        }
        val movie = Movie(
            id = id,
            title = title,
            originalTitle = originalTitle,
            overview = obj.optString("overview"),
            posterPath = obj.optString("poster_path").ifBlank { null },
            backdropPath = obj.optString("backdrop_path").ifBlank { null },
            releaseDate = obj.optString(if (isSeries) "first_air_date" else "release_date"),
            rating = obj.optDouble("vote_average", 0.0),
            mediaType = normalizedType,
            genreIds = genreIds
        )
        val genres = buildList {
            if (genresArray == null) return@buildList
            for (i in 0 until genresArray.length()) {
                val g = genresArray.optJSONObject(i)?.optString("name").orEmpty()
                if (g.isNotBlank()) add(g)
            }
        }
        val runtime = if (isSeries) {
            val runTimes = obj.optJSONArray("episode_run_time")
            if (runTimes != null && runTimes.length() > 0) runTimes.optInt(0, 0) else 0
        } else {
            obj.optInt("runtime", 0)
        }

        val creditsObj = obj.optJSONObject("credits")
        val director = if (isSeries) {
            val createdBy = obj.optJSONArray("created_by")
            if (createdBy != null && createdBy.length() > 0) {
                createdBy.optJSONObject(0)?.optString("name").orEmpty()
            } else ""
        } else {
            val crew = creditsObj?.optJSONArray("crew")
            var dirName = ""
            if (crew != null) {
                for (i in 0 until crew.length()) {
                    val member = crew.optJSONObject(i) ?: continue
                    if (member.optString("job") == "Director") {
                        dirName = member.optString("name")
                        break
                    }
                }
            }
            dirName
        }

        val cast = buildList {
            val castArr = creditsObj?.optJSONArray("cast") ?: return@buildList
            for (i in 0 until minOf(castArr.length(), 14)) {
                val c = castArr.optJSONObject(i) ?: continue
                val name = c.optString("name")
                if (name.isBlank()) continue
                add(
                    CastMemberItem(
                        id = c.optInt("id", i),
                        name = name,
                        character = c.optString("character"),
                        profilePath = c.optString("profile_path").ifBlank { null }
                    )
                )
            }
        }

        val seasons = buildList {
            if (!isSeries) return@buildList
            val arr = obj.optJSONArray("seasons") ?: return@buildList
            for (i in 0 until arr.length()) {
                val s = arr.optJSONObject(i) ?: continue
                val seasonNum = s.optInt("season_number", 0)
                val epCount = s.optInt("episode_count", 0)
                if (seasonNum <= 0 || epCount <= 0) continue
                add(
                    SeasonSummary(
                        seasonNumber = seasonNum,
                        name = s.optString("name").ifBlank { "الموسم $seasonNum" },
                        episodeCount = epCount,
                        posterPath = s.optString("poster_path").ifBlank { null }
                    )
                )
            }
        }
        val similarObj = obj.optJSONObject("similar")
        val similar = if (similarObj != null) {
            parseMovies(similarObj.toString(), normalizedType).take(12)
        } else {
            emptyList()
        }

        TmdbDetails(
            movie = movie,
            genres = genres,
            runtime = runtime,
            tagline = obj.optString("tagline"),
            director = director,
            cast = cast,
            seasons = seasons,
            similar = similar
        )
    }

    suspend fun seasonEpisodes(seriesId: Int, seasonNumber: Int): List<EpisodeItem> = withContext(Dispatchers.IO) {
        val safeSeason = seasonNumber.coerceAtLeast(1)
        val obj = JSONObject(tmdb("tv/$seriesId/season/$safeSeason?language=ar-SA"))
        val arr = obj.optJSONArray("episodes") ?: return@withContext emptyList()
        buildList {
            for (i in 0 until arr.length()) {
                val e = arr.optJSONObject(i) ?: continue
                val epNum = e.optInt("episode_number", i + 1)
                add(
                    EpisodeItem(
                        id = e.optInt("id", epNum),
                        episodeNumber = epNum,
                        seasonNumber = safeSeason,
                        name = e.optString("name").ifBlank { "الحلقة $epNum" },
                        overview = e.optString("overview"),
                        stillPath = e.optString("still_path").ifBlank { null },
                        runtime = e.optInt("runtime", 0)
                    )
                )
            }
        }
    }

    suspend fun signIn(email: String, password: String): Result<UserSession> = withContext(Dispatchers.IO) {
        runCatching {
            validateEmail(email)
            if (password.isBlank()) throw IOException("أدخل كلمة المرور.")
            val body = JSONObject().apply {
                put("email", email.trim())
                put("password", password)
            }
            val obj = supabaseRequest("POST", "/auth/v1/token?grant_type=password", body)
            sessionFromAuthResponse(obj, email)
        }
    }

    suspend fun signUp(displayName: String, email: String, password: String): Result<UserSession?> = withContext(Dispatchers.IO) {
        runCatching {
            validateEmail(email)
            if (displayName.trim().isBlank()) throw IOException("أدخل الاسم الذي سيظهر في حسابك.")
            if (password.length < 8) throw IOException("كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل.")
            val body = JSONObject().apply {
                put("email", email.trim())
                put("password", password)
                put("data", JSONObject().put("display_name", displayName.trim()))
            }
            val obj = supabaseRequest("POST", "/auth/v1/signup", body)
            val accessToken = obj.optString("access_token")
            if (accessToken.isBlank()) null else sessionFromAuthResponse(obj, email)
        }
    }

    suspend fun verifyEmailOtp(email: String, token: String, type: String): Result<UserSession> =
        withContext(Dispatchers.IO) {
            runCatching {
                validateEmail(email)
                val cleanToken = token.trim().replace(" ", "")
                if (cleanToken.length != 6 || cleanToken.any { !it.isDigit() }) {
                    throw IOException("أدخل رمز التحقق المكوّن من 6 أرقام.")
                }
                val cleanType = type.trim().lowercase()
                if (cleanType !in setOf("signup", "recovery")) {
                    throw IOException("نوع التحقق غير صالح. أعد المحاولة.")
                }
                val payload = JSONObject()
                    .put("email", email.trim())
                    .put("token", cleanToken)
                    .put("type", cleanType)
                val response = supabaseRequest("POST", "/auth/v1/verify", payload)
                sessionFromAuthResponse(response, email)
            }
        }

    suspend fun resendSignupOtp(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            validateEmail(email)
            supabaseRequest(
                "POST",
                "/auth/v1/resend",
                JSONObject().put("email", email.trim()).put("type", "signup")
            )
        }.map { Unit }
    }

    suspend fun requestPasswordRecovery(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            validateEmail(email)
            supabaseRequest("POST", "/auth/v1/recover", JSONObject().put("email", email.trim()))
        }.map { Unit }
    }

    private fun sessionFromAuthResponse(obj: JSONObject, fallbackEmail: String): UserSession {
        val accessToken = obj.optString("access_token").trim()
        val user = obj.optJSONObject("user")
        if (accessToken.isBlank() || user == null || user.optString("id").isBlank()) {
            throw IOException("لم تُكتمل جلسة الحساب. تأكد من الرمز أو أعد المحاولة.")
        }
        return UserSession(
            accessToken = accessToken,
            userId = user.getString("id"),
            email = user.optString("email", fallbackEmail).ifBlank { fallbackEmail }
        )
    }

    private fun validateEmail(email: String) {
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()) {
            throw IOException("أدخل عنوان بريد إلكتروني صحيحًا.")
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
                "/rest/v1/watchlist?user_id=eq.${session.userId}&content_type=eq.$type&content_id=eq.${movie.id}",
                token = session.accessToken
            )
        }.map { Unit }
    }

    suspend fun watchlist(session: UserSession): List<Movie> = withContext(Dispatchers.IO) {
        val path = "/rest/v1/watchlist?select=content_type,content_id&user_id=eq.${session.userId}&order=created_at.desc"
        val rows = supabaseArrayRequest(path, session.accessToken)
        val entries = buildList {
            for (i in 0 until minOf(rows.length(), 40)) {
                val row = rows.optJSONObject(i) ?: continue
                val id = row.optString("content_id").toIntOrNull() ?: continue
                val type = row.optString("content_type").ifBlank { "movie" }
                add(id to type)
            }
        }
        coroutineScope {
            entries.map { (id, type) ->
                async {
                    runCatching { details(id, type).movie }.getOrNull()
                }
            }.awaitAll().filterNotNull()
        }
    }

    private fun tmdb(path: String): String {
        if (BuildConfig.TMDB_TOKEN.isBlank()) throw IOException("TMDB token is missing")
        val request = Request.Builder()
            .url("$tmdbBase/$path")
            .header("Authorization", "Bearer ${BuildConfig.TMDB_TOKEN}")
            .header("Accept", "application/json")
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("TMDB ${response.code}: $text")
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
            "PUT" -> requestBuilder.put(requestBody).build()
            "DELETE" -> requestBuilder.delete().build()
            else -> requestBuilder.get().build()
        }
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val detail = if (path.startsWith("/auth/v1/")) {
                    friendlyAuthError(response.code, text)
                } else {
                    text.ifBlank { "تعذر إتمام الطلب." }
                }
                throw IOException("Supabase ${response.code}: $detail")
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun friendlyAuthError(status: Int, body: String): String {
        val json = runCatching { JSONObject(body) }.getOrNull()
        val raw = listOf("message", "msg", "error_description", "error", "code")
            .mapNotNull { key -> json?.optString(key)?.trim()?.takeIf { it.isNotBlank() && it != "null" } }
            .firstOrNull()
            .orEmpty()
        val message = raw.lowercase()

        return when {
            status == 429 || "rate limit" in message || "too many" in message ->
                "وصلنا إلى حدّ المحاولات المؤقت. انتظر قليلًا ثم حاول مجددًا."
            "already registered" in message || "already exists" in message || "user already" in message ->
                "هذا البريد الإلكتروني مسجّل بالفعل. جرّب تسجيل الدخول بدلًا من إنشاء حساب جديد."
            "invalid login credentials" in message || "invalid credentials" in message ->
                "البريد الإلكتروني أو كلمة المرور غير صحيحة."
            "email not confirmed" in message ->
                "يجب تأكيد البريد الإلكتروني أولًا. اطلب رمز تحقق جديدًا."
            ("otp" in message || "token" in message) &&
                ("invalid" in message || "expired" in message || "incorrect" in message || "bad" in message) ->
                "رمز التحقق غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا."
            "invalid email" in message || "email address" in message && "invalid" in message ->
                "أدخل عنوان بريد إلكتروني صحيحًا."
            "password" in message && ("weak" in message || "short" in message || "minimum" in message) ->
                "كلمة المرور ضعيفة أو قصيرة. استخدم كلمة مرور أقوى."
            status >= 500 ->
                "خدمة الحسابات تواجه مشكلة مؤقتة. حاول مجددًا بعد قليل."
            status == 400 || status == 422 ->
                "تعذر إتمام الطلب. تحقّق من البيانات أو رمز التحقق ثم حاول مجددًا."
            status == 401 || status == 403 ->
                "تعذّر التحقق من الحساب. أعد المحاولة أو راجع إعدادات تسجيل الدخول."
            else ->
                "تعذّر إتمام طلب الحساب (HTTP $status). حاول مجددًا."
        }
    }

    private fun supabaseArrayRequest(path: String, token: String): JSONArray {
        val request = Request.Builder()
            .url(supabaseBase + path)
            .header("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("Supabase ${response.code}: $text")
            return JSONArray(text)
        }
    }

    private fun parseMovies(json: String, forcedType: String? = null): List<Movie> {
        val arr = JSONObject(json).optJSONArray("results") ?: return emptyList()
        val result = ArrayList<Movie>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val type = forcedType ?: o.optString("media_type")
            if (type != "movie" && type != "tv" && type != "series") continue
            val series = type == "tv" || type == "series"
            val id = o.optInt("id", 0)
            val posterPath = o.optString("poster_path").ifBlank { null }
            if (id == 0 || posterPath == null) continue
            val genreArr = o.optJSONArray("genre_ids")
            val genreIds = buildList {
                if (genreArr != null) {
                    for (g in 0 until genreArr.length()) {
                        val gid = genreArr.optInt(g, 0)
                        if (gid != 0) add(gid)
                    }
                }
            }
            result += Movie(
                id = id,
                title = o.optString(if (series) "name" else "title"),
                originalTitle = o.optString(if (series) "original_name" else "original_title"),
                overview = o.optString("overview"),
                posterPath = posterPath,
                backdropPath = o.optString("backdrop_path").ifBlank { null },
                releaseDate = o.optString(if (series) "first_air_date" else "release_date"),
                rating = o.optDouble("vote_average", 0.0),
                mediaType = if (series) "series" else "movie",
                genreIds = genreIds
            )
        }
        return result
    }
}
