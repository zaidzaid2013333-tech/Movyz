package sbs.movyza.app;

import android.content.Context;
import com.google.firebase.FirebaseApp;

public final class FirebaseBootstrap {
    private FirebaseBootstrap() {}

    public static void initialize(Context context) {
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(context);
            }
        } catch (Exception ignored) {
            // Local APK remains usable before Firebase credentials are attached.
        }
    }
}
