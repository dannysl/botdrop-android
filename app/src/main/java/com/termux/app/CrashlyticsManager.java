package com.termux.app;

import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.FirebaseApp;
import com.google.firebase.crashlytics.FirebaseCrashlytics;
import com.termux.BuildConfig;
import com.termux.shared.logger.Logger;
import com.termux.shared.termux.settings.preferences.TermuxAppSharedPreferences;

public final class CrashlyticsManager {

    private static final String LOG_TAG = "CrashlyticsManager";

    private CrashlyticsManager() {}

    public static void applyCollectionState(@NonNull Context context) {
        if (FirebaseApp.initializeApp(context) == null) {
            Logger.logInfo(LOG_TAG, "Skipping Crashlytics init: google-services.json config not found.");
            return;
        }

        TermuxAppSharedPreferences preferences = TermuxAppSharedPreferences.build(context);
        boolean enabled = preferences != null
            ? preferences.isCrashlyticsCollectionEnabled(BuildConfig.CRASHLYTICS_DEFAULT_ENABLED)
            : BuildConfig.CRASHLYTICS_DEFAULT_ENABLED;

        FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(enabled);
        Logger.logInfo(LOG_TAG, "Crashlytics collection " + (enabled ? "enabled" : "disabled") + ".");
    }

}
