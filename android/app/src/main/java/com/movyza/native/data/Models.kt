package com.movyza.native.data

data class Movie(
    val id: Int,
    val title: String,
    val originalTitle: String,
    val overview: String,
    val posterPath: String?,
    val backdropPath: String?,
    val releaseDate: String,
    val rating: Double,
    val mediaType: String = "movie"
) {
    val posterUrl: String?
        get() = posterPath?.let { "https://image.tmdb.org/t/p/w500" + it }

    val backdropUrl: String?
        get() = backdropPath?.let { "https://image.tmdb.org/t/p/w1280" + it }
}

data class TmdbDetails(
    val movie: Movie,
    val genres: List<String> = emptyList(),
    val runtime: Int = 0,
    val tagline: String = ""
)

data class UserSession(
    val accessToken: String,
    val userId: String,
    val email: String
)

data class AppConfigStatus(
    val configured: Boolean,
    val message: String
)
