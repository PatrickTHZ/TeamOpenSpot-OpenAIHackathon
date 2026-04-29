package au.z2hs.trustlens;

import android.content.Context;
import android.content.SharedPreferences;

final class TrustLensPrefs {
    private static final String PREFS = "trustlens";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_BACKEND_URL = "backend_url";
    private static final String KEY_LAST_ASSESSMENT = "last_assessment";
    private static final String KEY_LAST_CAPTURE = "last_capture";
    private static final String KEY_DEBUG_STATUS = "debug_status";
    private static final String KEY_LAST_SCREENSHOT_PATH = "last_screenshot_path";
    static final String DEFAULT_BACKEND_URL = "https://trustlens.z2hs.au";

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, true);
    }

    static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    static String backendUrl(Context context) {
        String stored = prefs(context).getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL);
        if ("http://10.0.2.2:8787".equals(stored)) {
            setBackendUrl(context, DEFAULT_BACKEND_URL);
            return DEFAULT_BACKEND_URL;
        }
        return stored;
    }

    static void setBackendUrl(Context context, String value) {
        String normalized = value == null || value.trim().isEmpty() ? DEFAULT_BACKEND_URL : value.trim();
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        prefs(context).edit().putString(KEY_BACKEND_URL, normalized).apply();
    }

    static void storeAssessment(Context context, Assessment assessment) {
        prefs(context).edit().putString(KEY_LAST_ASSESSMENT, assessment.toJson().toString()).apply();
    }

    static Assessment lastAssessment(Context context) {
        return Assessment.fromStoredJson(prefs(context).getString(KEY_LAST_ASSESSMENT, null));
    }

    static void storeCapture(Context context, CapturePayload payload) {
        prefs(context).edit().putString(KEY_LAST_CAPTURE, payload.toDebugJson().toString()).apply();
    }

    static String lastCapture(Context context) {
        return prefs(context).getString(KEY_LAST_CAPTURE, "No captured payload yet.");
    }

    static void storeDebugStatus(Context context, String status) {
        prefs(context).edit().putString(KEY_DEBUG_STATUS, status).apply();
    }

    static String debugStatus(Context context) {
        return prefs(context).getString(
            KEY_DEBUG_STATUS,
            "No accessibility event seen yet. Enable TrustLens feed helper, then scroll in Facebook or Chrome."
        );
    }

    static void storeLastScreenshotPath(Context context, String path) {
        prefs(context).edit().putString(KEY_LAST_SCREENSHOT_PATH, path).apply();
    }

    static String lastScreenshotPath(Context context) {
        return prefs(context).getString(KEY_LAST_SCREENSHOT_PATH, "");
    }
}
