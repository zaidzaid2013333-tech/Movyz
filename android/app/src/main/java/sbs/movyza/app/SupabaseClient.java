
package sbs.movyza.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class SupabaseClient {
    private final String base;
    private final String anon;
    private final SharedPreferences prefs;

    public SupabaseClient(Context context) {
        base = BuildConfig.SUPABASE_URL == null ? "" : BuildConfig.SUPABASE_URL.replaceAll("/+$","");
        anon = BuildConfig.SUPABASE_ANON_KEY == null ? "" : BuildConfig.SUPABASE_ANON_KEY;
        prefs = context.getSharedPreferences("movyza_auth", Context.MODE_PRIVATE);
    }

    public boolean configured() { return !base.isEmpty() && !anon.isEmpty(); }
    public boolean signedIn() { return !accessToken().isEmpty(); }
    public String email() { return prefs.getString("email",""); }
    private String accessToken() { return prefs.getString("access_token",""); }

    private Map<String,String> headers(boolean auth) {
        Map<String,String> h = new HashMap<>();
        h.put("apikey", anon);
        if (auth && signedIn()) h.put("Authorization","Bearer " + accessToken());
        else h.put("Authorization","Bearer " + anon);
        return h;
    }

    public void signIn(String email, String password) throws Exception {
        if (!configured()) throw new Exception("Supabase is not configured");
        JSONObject body = new JSONObject();
        body.put("email", email);
        body.put("password", password);
        JSONObject out = new JSONObject(Network.post(base + "/auth/v1/token?grant_type=password", body.toString(), headers(false)));
        saveSession(out,email);
    }

    public void signUp(String email, String password) throws Exception {
        if (!configured()) throw new Exception("Supabase is not configured");
        JSONObject body = new JSONObject();
        body.put("email", email);
        body.put("password", password);
        JSONObject out = new JSONObject(Network.post(base + "/auth/v1/signup", body.toString(), headers(false)));
        if (out.optString("access_token","").isEmpty()) {
            throw new Exception("Account created. Check your email if confirmation is required.");
        }
        saveSession(out,email);
    }

    private void saveSession(JSONObject out, String email) {
        prefs.edit()
            .putString("access_token", out.optString("access_token",""))
            .putString("refresh_token", out.optString("refresh_token",""))
            .putString("email", email)
            .apply();
    }

    public void signOut() {
        prefs.edit().clear().apply();
    }

    public List<WatchRow> getWatchlist() throws Exception {
        List<WatchRow> out = new ArrayList<>();
        if (!signedIn()) return out;
        String userId = currentUserId();
        String url = base + "/rest/v1/watchlist?user_id=eq." + userId + "&select=id,content_id,content_type,created_at&order=created_at.desc";
        JSONArray rows = new JSONArray(Network.get(url, headers(true)));
        for (int i=0;i<rows.length();i++) {
            JSONObject r = rows.getJSONObject(i);
            out.add(new WatchRow(r.optString("content_id"),r.optString("content_type")));
        }
        return out;
    }

    public void addWatchlist(String contentId, String contentType) throws Exception {
        String userId = currentUserId();
        JSONObject body = new JSONObject();
        body.put("user_id",userId);
        body.put("content_id",contentId);
        body.put("content_type",contentType);
        Map<String,String> h = headers(true);
        h.put("Prefer","resolution=merge-duplicates,return=minimal");
        Network.post(base + "/rest/v1/watchlist", body.toString(), h);
    }

    public void removeWatchlist(String contentId) throws Exception {
        String userId = currentUserId();
        Network.delete(base + "/rest/v1/watchlist?user_id=eq." + userId + "&content_id=eq." + contentId, headers(true));
    }

    private String currentUserId() throws Exception {
        if (!signedIn()) throw new Exception("Authentication required");
        JSONObject u = new JSONObject(Network.get(base + "/auth/v1/user", headers(true)));
        return u.optString("id","");
    }

    public static final class WatchRow {
        public final String contentId;
        public final String contentType;
        public WatchRow(String contentId, String contentType) {
            this.contentId = contentId;
            this.contentType = contentType;
        }
    }
}
