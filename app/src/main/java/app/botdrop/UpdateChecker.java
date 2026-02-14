package app.botdrop;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;

import com.termux.shared.logger.Logger;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Lightweight version checker that queries the BotDrop API for the latest release.
 * Throttled to once per 24 hours. Fails silently — never blocks app usage.
 *
 * Results are persisted to SharedPreferences so any Activity can display the banner.
 */
public class UpdateChecker {

    private static final String LOG_TAG = "UpdateChecker";
    private static final String CHECK_URL = "https://api.botdrop.app/version";
    private static final long CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L; // 6 hours
    private static final int CONNECT_TIMEOUT_MS = 10000;
    private static final int READ_TIMEOUT_MS = 10000;
    private static final String PREFS_NAME = "botdrop_update";
    private static final String KEY_LAST_CHECK = "last_check_time";
    private static final String KEY_DISMISSED_VERSION = "dismissed_version";
    private static final String KEY_LATEST_VERSION = "latest_version";
    private static final String KEY_DOWNLOAD_URL = "download_url";
    private static final String KEY_RELEASE_NOTES = "release_notes";
    private static final String KEY_CHECKED_VERSION = "checked_version";

    interface UpdateCallback {
        void onUpdateAvailable(String latestVersion, String downloadUrl, String notes);

        default void onNoUpdate() {
        }
    }

    public interface ForceCheckCallback {
        void onComplete(boolean updateAvailable, String latestVersion, String downloadUrl, String notes, String message);
    }

    /**
     * Run a background check and persist results. Optionally calls back on the main thread.
     */
    static void check(Context ctx, UpdateCallback cb) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String currentVersion;
        int currentVersionCode;
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            currentVersion = pi.versionName;
            currentVersionCode = pi.versionCode;
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to get package info: " + e.getMessage());
            return;
        }

        // Throttle: skip if checked within the last 24 hours
        String lastCheckedVersion = prefs.getString(KEY_CHECKED_VERSION, null);
        long lastCheck = prefs.getLong(KEY_LAST_CHECK, 0);
        long elapsed = System.currentTimeMillis() - lastCheck;
        if (!TextUtils.equals(currentVersion, lastCheckedVersion) || lastCheckedVersion == null) {
            Logger.logInfo(LOG_TAG, "App version changed, bypassing check throttle");
        } else if (elapsed < CHECK_INTERVAL_MS) {
            Logger.logInfo(LOG_TAG, "Skipping check, last check was " + (elapsed / 1000) + "s ago");
            // Still notify from stored result if available
            if (cb != null) notifyFromStored(ctx, prefs, cb);
            return;
        }

        Logger.logInfo(LOG_TAG, "Starting update check, current=" + currentVersion + " vc=" + currentVersionCode);

        new Thread(() -> {
            try {
                String urlStr = CHECK_URL + "?v=" + currentVersion + "&vc=" + currentVersionCode;
                Logger.logInfo(LOG_TAG, "Fetching " + urlStr);
                HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setRequestMethod("GET");

                int responseCode = conn.getResponseCode();
                Logger.logInfo(LOG_TAG, "Response code: " + responseCode);
                if (responseCode != 200) {
                    conn.disconnect();
                    return;
                }

                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                conn.disconnect();

                // Record successful check
                prefs.edit()
                    .putLong(KEY_LAST_CHECK, System.currentTimeMillis())
                    .putString(KEY_CHECKED_VERSION, currentVersion)
                    .apply();

                JSONObject json = new JSONObject(sb.toString());
                String latestVersion = json.optString("latest_version", "");
                String downloadUrl = json.optString("download_url", "");
                String notes = json.optString("release_notes", "");

                Logger.logInfo(LOG_TAG, "API returned latest=" + latestVersion + " current=" + currentVersion);

                if (latestVersion.isEmpty() || latestVersion.equals(currentVersion)) {
                    Logger.logInfo(LOG_TAG, "No update available");
                    clearStored(prefs);
                    if (cb != null) {
                        notifyNoUpdate(cb);
                    }
                    return;
                }

                String dismissedVersion = prefs.getString(KEY_DISMISSED_VERSION, null);
                if (latestVersion.equals(dismissedVersion)) {
                    Logger.logInfo(LOG_TAG, "Version " + latestVersion + " was dismissed");
                    if (cb != null) {
                        notifyNoUpdate(cb);
                    }
                    return;
                }

                if (isNewer(latestVersion, currentVersion)) {
                    Logger.logInfo(LOG_TAG, "Update available: " + latestVersion);
                    // Persist for any Activity to read
                    prefs.edit()
                        .putString(KEY_LATEST_VERSION, latestVersion)
                        .putString(KEY_DOWNLOAD_URL, downloadUrl)
                        .putString(KEY_RELEASE_NOTES, notes)
                        .apply();
                    if (cb != null) {
                        new Handler(Looper.getMainLooper()).post(() -> cb.onUpdateAvailable(latestVersion, downloadUrl, notes));
                    }
                } else {
                    Logger.logInfo(LOG_TAG, "Latest " + latestVersion + " is not newer than " + currentVersion);
                    clearStored(prefs);
                    if (cb != null) {
                        notifyNoUpdate(cb);
                    }
                }
            } catch (Exception e) {
                Logger.logError(LOG_TAG, "Update check failed: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Force an immediate update check, ignoring the 24-hour throttle.
     * Used for manual update button.
     */
    public static void forceCheck(Context ctx, UpdateCallback cb) {
        forceCheckWithFeedback(ctx, (updateAvailable, latestVersion, downloadUrl, notes, message) -> {
            if (cb == null) return;
            if (updateAvailable) {
                cb.onUpdateAvailable(latestVersion, downloadUrl, notes);
            } else {
                cb.onUpdateAvailable(null, null, null);
            }
        });
    }

    /**
     * Force an immediate update check and always invoke callback (success/no-update/error).
     */
    public static void forceCheckWithFeedback(Context ctx, ForceCheckCallback cb) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(KEY_LAST_CHECK, 0).apply();

        String currentVersion;
        int currentVersionCode;
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            currentVersion = pi.versionName;
            currentVersionCode = pi.versionCode;
        } catch (Exception e) {
            notifyForceResult(cb, false, null, null, null, "Failed to read current app version");
            return;
        }

        Logger.logInfo(LOG_TAG, "Forcing update check, current=" + currentVersion + " vc=" + currentVersionCode);

        new Thread(() -> {
            try {
                String urlStr = CHECK_URL + "?v=" + currentVersion + "&vc=" + currentVersionCode;
                HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setRequestMethod("GET");

                int responseCode = conn.getResponseCode();
                if (responseCode != 200) {
                    conn.disconnect();
                    notifyForceResult(cb, false, null, null, null, "Update check failed (HTTP " + responseCode + ")");
                    return;
                }

                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                conn.disconnect();

                prefs.edit()
                    .putLong(KEY_LAST_CHECK, System.currentTimeMillis())
                    .putString(KEY_CHECKED_VERSION, currentVersion)
                    .apply();

                JSONObject json = new JSONObject(sb.toString());
                String latestVersion = json.optString("latest_version", "");
                String downloadUrl = json.optString("download_url", "");
                String notes = json.optString("release_notes", "");

                if (latestVersion.isEmpty() || latestVersion.equals(currentVersion) || !isNewer(latestVersion, currentVersion)) {
                    clearStored(prefs);
                    notifyForceResult(cb, false, null, null, null, "No updates available");
                    return;
                }

                prefs.edit()
                    .putString(KEY_LATEST_VERSION, latestVersion)
                    .putString(KEY_DOWNLOAD_URL, downloadUrl)
                    .putString(KEY_RELEASE_NOTES, notes)
                    .apply();

                notifyForceResult(cb, true, latestVersion, downloadUrl, notes, "Update available: v" + latestVersion);
            } catch (Exception e) {
                Logger.logError(LOG_TAG, "Forced update check failed: " + e.getMessage());
                notifyForceResult(cb, false, null, null, null, "Update check failed: " + e.getMessage());
            }
        }).start();
    }

    private static void notifyForceResult(ForceCheckCallback cb, boolean updateAvailable,
                                          String latestVersion, String downloadUrl, String notes,
                                          String message) {
        if (cb == null) return;
        new Handler(Looper.getMainLooper()).post(() ->
            cb.onComplete(updateAvailable, latestVersion, downloadUrl, notes, message));
    }

    /**
     * Get stored update info, or null if no update is available.
     * Returns [latestVersion, downloadUrl, releaseNotes] or null.
     */
    static String[] getAvailableUpdate(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String latestVersion = prefs.getString(KEY_LATEST_VERSION, null);
        if (latestVersion == null) return null;

        // Check if dismissed
        String dismissed = prefs.getString(KEY_DISMISSED_VERSION, null);
        if (latestVersion.equals(dismissed)) return null;

        // Check if still newer than current
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (!isNewer(latestVersion, pi.versionName)) {
                clearStored(prefs);
                return null;
            }
        } catch (Exception e) {
            return null;
        }

        return new String[]{
            latestVersion,
            prefs.getString(KEY_DOWNLOAD_URL, ""),
            prefs.getString(KEY_RELEASE_NOTES, "")
        };
    }

    /**
     * Mark a version as dismissed so the banner won't show again for it.
     */
    static void dismiss(Context ctx, String version) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DISMISSED_VERSION, version)
            .apply();
    }

    private static void notifyFromStored(Context ctx, SharedPreferences prefs, UpdateCallback cb) {
        String[] update = getAvailableUpdate(ctx);
        if (update != null) {
            new Handler(Looper.getMainLooper()).post(() -> cb.onUpdateAvailable(update[0], update[1], update[2]));
            return;
        }
        notifyNoUpdate(cb);
    }

    private static void notifyNoUpdate(UpdateCallback cb) {
        if (cb == null) return;
        new Handler(Looper.getMainLooper()).post(cb::onNoUpdate);
    }

    private static void clearStored(SharedPreferences prefs) {
        prefs.edit()
            .remove(KEY_LATEST_VERSION)
            .remove(KEY_DOWNLOAD_URL)
            .remove(KEY_RELEASE_NOTES)
            .apply();
    }

    /**
     * Simple semver comparison: returns true if latest > current.
     */
    private static boolean isNewer(String latest, String current) {
        try {
            int[] l = parseSemver(latest);
            int[] c = parseSemver(current);
            for (int i = 0; i < 3; i++) {
                if (l[i] > c[i]) return true;
                if (l[i] < c[i]) return false;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private static int[] parseSemver(String v) {
        if (v == null) {
            throw new IllegalArgumentException("version is null");
        }

        String trimmed = v.trim();
        if (trimmed.startsWith("v")) {
            trimmed = trimmed.substring(1);
        }

        int suffixIndex = trimmed.indexOf('-');
        int buildMetadataIndex = trimmed.indexOf('+');
        int trimIndex = suffixIndex;
        if (buildMetadataIndex >= 0 && (trimIndex < 0 || buildMetadataIndex < trimIndex)) {
            trimIndex = buildMetadataIndex;
        }
        if (trimIndex >= 0) {
            trimmed = trimmed.substring(0, trimIndex);
        }

        String[] parts = trimmed.split("\\.");
        int major = parts.length > 0 ? Integer.parseInt(parts[0]) : 0;
        int minor = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
        int patch = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
        return new int[]{
            major,
            minor,
            patch
        };
    }
}
