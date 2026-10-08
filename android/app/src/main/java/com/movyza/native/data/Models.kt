package com.movyza.app.data

import androidx.compose.runtime.Immutable

@Immutable
data class Movie(
    val id: Int,
    val title: String,
    val originalTitle: String,
    val overview: String,
    val posterPath: String?,
    val backdropPath: String?,
    val releaseDate: String,
    val rating: Double,
    val mediaType: String = "movie",
    val genreIds: List<Int> = emptyList()
) {
    val posterUrl: String?
        get() = posterPath?.let { "https://image.tmdb.org/t/p/w500$it" }

    val backdropUrl: String?
        get() = backdropPath?.let { "https://image.tmdb.org/t/p/w1280$it" }

    val yearText: String
        get() = releaseDate.takeIf { it.length >= 4 }?.take(4).orEmpty()

    val displayTitle: String
        get() = title.ifBlank { originalTitle }.ifBlank { "بدون عنوان" }
}

@Immutable
data class CastMemberItem(
    val id: Int,
    val name: String,
    val character: String,
    val profilePath: String? = null
) {
    val profileUrl: String?
        get() = profilePath?.let { "https://image.tmdb.org/t/p/w185$it" }
}

@Immutable
data class SeasonSummary(
    val seasonNumber: Int,
    val name: String,
    val episodeCount: Int,
    val posterPath: String? = null
) {
    val posterUrl: String?
        get() = posterPath?.let { "https://image.tmdb.org/t/p/w342$it" }
}

@Immutable
data class EpisodeItem(
    val id: Int,
    val episodeNumber: Int,
    val seasonNumber: Int,
    val name: String,
    val overview: String,
    val stillPath: String? = null,
    val runtime: Int = 0
) {
    val stillUrl: String?
        get() = stillPath?.let { "https://image.tmdb.org/t/p/w500$it" }
}

@Immutable
data class TmdbDetails(
    val movie: Movie,
    val genres: List<String> = emptyList(),
    val runtime: Int = 0,
    val tagline: String = "",
    val director: String = "",
    val cast: List<CastMemberItem> = emptyList(),
    val seasons: List<SeasonSummary> = emptyList(),
    val similar: List<Movie> = emptyList()
)

@Immutable
data class WatchHistoryEntry(
    val id: Int,
    val mediaType: String,
    val title: String,
    val posterPath: String?,
    val backdropPath: String?,
    val rating: Double,
    val releaseDate: String,
    val season: Int = 1,
    val episode: Int = 1,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val updatedAt: Long = 0L
) {
    val progressFraction: Float
        get() = if (durationMs > 0L) (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0.02f, 1f) else 0f

    fun toMovie(): Movie = Movie(
        id = id,
        title = title,
        originalTitle = title,
        overview = "",
        posterPath = posterPath,
        backdropPath = backdropPath,
        releaseDate = releaseDate,
        rating = rating,
        mediaType = mediaType
    )
}

@Immutable
data class UserSession(
    val accessToken: String,
    val userId: String,
    val email: String
)

@Immutable
data class AppConfigStatus(
    val configured: Boolean,
    val message: String
)
