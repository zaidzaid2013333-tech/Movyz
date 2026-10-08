
package sbs.movyza.app;

public final class MediaItem {
    public final String id;
    public final String type;
    public final String title;
    public final String originalTitle;
    public final String overview;
    public final String posterUrl;
    public final String backdropUrl;
    public final int year;
    public final double rating;

    public MediaItem(String id, String type, String title, String originalTitle,
                     String overview, String posterUrl, String backdropUrl,
                     int year, double rating) {
        this.id = id;
        this.type = type;
        this.title = title;
        this.originalTitle = originalTitle;
        this.overview = overview;
        this.posterUrl = posterUrl;
        this.backdropUrl = backdropUrl;
        this.year = year;
        this.rating = rating;
    }
}
