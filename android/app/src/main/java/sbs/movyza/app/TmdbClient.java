
package sbs.movyza.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class TmdbClient {
    private static final String API = "https://api.themoviedb.org/3";
    private static final String IMAGE = "https://image.tmdb.org/t/p/";
    private final String token;

    public TmdbClient() {
        token = BuildConfig.TMDB_READ_TOKEN == null ? "" : BuildConfig.TMDB_READ_TOKEN.trim();
    }

    public boolean configured() { return !token.isEmpty(); }

    private JSONObject getObject(String path, Map<String,String> params) throws Exception {
        if (!configured()) throw new Exception("TMDB is not configured");
        StringBuilder url = new StringBuilder(API).append(path).append("?language=ar-SA&region=DZ");
        if (params != null) {
            for (Map.Entry<String,String> e : params.entrySet()) {
                if (e.getValue() != null && !e.getValue().isEmpty()) {
                    url.append('&').append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8.name()))
                       .append('=').append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8.name()));
                }
            }
        }
        Map<String,String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer " + token);
        return new JSONObject(Network.get(url.toString(), headers));
    }

    private MediaItem map(JSONObject x, String fallbackType) {
        String type = x.optString("media_type", fallbackType);
        if (!"movie".equals(type) && !"tv".equals(type)) type = fallbackType;
        String title = "movie".equals(type) ? x.optString("title", x.optString("original_title","")) : x.optString("name", x.optString("original_name",""));
        String original = "movie".equals(type) ? x.optString("original_title", title) : x.optString("original_name", title);
        String date = "movie".equals(type) ? x.optString("release_date","") : x.optString("first_air_date","");
        int year = date.length() >= 4 ? safeInt(date.substring(0,4)) : 0;
        String poster = x.optString("poster_path","");
        String backdrop = x.optString("backdrop_path","");
        return new MediaItem(
                String.valueOf(x.optInt("id")),
                type, title, original,
                x.optString("overview",""),
                poster.isEmpty() ? "" : IMAGE + "w500" + poster,
                backdrop.isEmpty() ? "" : IMAGE + "w1280" + backdrop,
                year,
                x.optDouble("vote_average",0)
        );
    }

    private static int safeInt(String s) { try { return Integer.parseInt(s); } catch(Exception e){ return 0; } }

    public List<MediaItem> trending() throws Exception {
        JSONObject o = getObject("/trending/all/week", Collections.emptyMap());
        return mapResults(o, "movie");
    }

    public List<MediaItem> popularMovies() throws Exception {
        JSONObject o = getObject("/movie/popular", Collections.singletonMap("page","1"));
        return mapResults(o, "movie");
    }

    public List<MediaItem> popularSeries() throws Exception {
        JSONObject o = getObject("/tv/popular", Collections.singletonMap("page","1"));
        return mapResults(o, "tv");
    }

    public List<MediaItem> search(String q) throws Exception {
        Map<String,String> p = new HashMap<>();
        p.put("query", q);
        p.put("page","1");
        p.put("include_adult","false");
        return mapResults(getObject("/search/multi",p), "movie");
    }

    public MediaItem detail(String type, String id) throws Exception {
        Map<String,String> p = new HashMap<>();
        p.put("append_to_response","credits,similar");
        return map(getObject("/" + ("tv".equals(type) ? "tv" : "movie") + "/" + id,p), type);
    }

    private List<MediaItem> mapResults(JSONObject o, String fallback) throws Exception {
        JSONArray arr = o.optJSONArray("results");
        if (arr == null) return new ArrayList<>();
        List<MediaItem> out = new ArrayList<>();
        for (int i=0;i<arr.length() && out.size()<20;i++) {
            JSONObject x = arr.optJSONObject(i);
            if (x != null && x.optInt("id",0) > 0) out.add(map(x,fallback));
        }
        return out;
    }
}
