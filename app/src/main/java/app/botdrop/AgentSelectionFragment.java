package app.botdrop;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.Toast;
import android.text.TextUtils;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.termux.R;
import com.termux.app.TermuxInstaller;
import com.termux.shared.logger.Logger;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Step 1 of setup: Choose which agent to install.
 *
 * Currently offers:
 * - OpenClaw (available, triggers install)
 * - OwliaBot (a distinct AI agent product, not a rename leftover - coming soon, disabled)
 */
public class AgentSelectionFragment extends Fragment {

    private static final String LOG_TAG = "AgentSelectionFragment";

    public static final String PREFS_NAME = "botdrop_settings";
    public static final String KEY_OPENCLAW_VERSION = "openclaw_install_version";
    private static final String PINNED_VERSION = "openclaw@2026.2.6";
    private static final int TAP_COUNT_THRESHOLD = 10;
    private static final long TAP_WINDOW_MS = 5000;
    private static final long OPENCLAW_VERSION_CACHE_TTL_MS = TimeUnit.HOURS.toMillis(1);
    private static final String KEY_OPENCLAW_VERSION_CACHE = "openclaw_versions_cache";
    private static final String KEY_OPENCLAW_VERSION_CACHE_TIME = "openclaw_versions_cache_time";

    private BotDropService mBotDropService;
    private boolean mServiceBound = false;
    private AlertDialog mOpenclawVersionManagerDialog;
    private AlertDialog mProgressDialog;
    private boolean mOpenclawVersionActionInProgress;
    private long mOpenclawVersionRequestId;
    private int mTapCount = 0;
    private long mFirstTapTime = 0;

    private final ServiceConnection mConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            BotDropService.LocalBinder binder = (BotDropService.LocalBinder) service;
            mBotDropService = binder.getService();
            mServiceBound = true;
            Logger.logDebug(LOG_TAG, "BotDropService connected");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            mServiceBound = false;
            mBotDropService = null;
            Logger.logDebug(LOG_TAG, "BotDropService disconnected");
        }
    };

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_botdrop_agent_select, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        Button installButton = view.findViewById(R.id.agent_openclaw_install);
        View versionManagerButton = view.findViewById(R.id.agent_openclaw_version_manager);
        final boolean isOpenclawInstalled = BotDropService.isOpenclawInstalled();
        installButton.setText(isOpenclawInstalled ? "Open" : "Install");
        installButton.setOnClickListener(v -> {
            if (isOpenclawInstalled) {
                Logger.logInfo(LOG_TAG, "OpenClaw already installed, opening dashboard");
                openDashboard();
            } else {
                Logger.logInfo(LOG_TAG, "OpenClaw selected for installation");
                SetupActivity activity = (SetupActivity) getActivity();
                if (activity != null && !activity.isFinishing()) {
                    activity.goToNextStep();
                }
            }
        });

        versionManagerButton.setOnClickListener(v -> showOpenclawVersionListDialog());

        // URL click handlers
        view.findViewById(R.id.agent_openclaw_url).setOnClickListener(v -> {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://openclaw.ai")));
        });

        // Easter egg: tap OpenClaw icon 10 times to pin install version
        view.findViewById(R.id.agent_openclaw_icon).setOnClickListener(v -> {
            long now = System.currentTimeMillis();
            if (mTapCount == 0 || now - mFirstTapTime > TAP_WINDOW_MS) {
                mTapCount = 1;
                mFirstTapTime = now;
            } else {
                mTapCount++;
            }

            if (mTapCount >= TAP_COUNT_THRESHOLD) {
                mTapCount = 0;
                showVersionPinDialog();
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        if (getActivity() == null) {
            return;
        }
        Intent intent = new Intent(getActivity(), BotDropService.class);
        boolean bound = getActivity().bindService(intent, mConnection, Context.BIND_AUTO_CREATE);
        if (bound) {
            mServiceBound = true;
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        dismissOpenclawVersionManagerDialog();
        if (mProgressDialog != null) {
            mProgressDialog.dismiss();
            mProgressDialog = null;
        }
        if (mServiceBound && getActivity() != null) {
            try {
                getActivity().unbindService(mConnection);
            } catch (IllegalArgumentException ignored) {
                // Service was not bound or already unbound.
            }
            mServiceBound = false;
            mBotDropService = null;
        }
    }

    private void showOpenclawVersionListDialog() {
        Context ctx = getContext();
        if (ctx == null) {
            return;
        }

        if (!mServiceBound || mBotDropService == null) {
            new AlertDialog.Builder(ctx)
                .setTitle("OpenClaw Versions")
                .setMessage("Service not connected. Please try again later.")
                .setNegativeButton("Close", null)
                .show();
            return;
        }

        if (mOpenclawVersionActionInProgress) {
            return;
        }

        mOpenclawVersionActionInProgress = true;
        final long requestId = ++mOpenclawVersionRequestId;
        mOpenclawVersionManagerDialog = new AlertDialog.Builder(ctx)
            .setTitle("OpenClaw Versions")
            .setMessage("Loading versions…")
            .setCancelable(false)
            .setNegativeButton("Cancel", (d, w) -> {
                mOpenclawVersionActionInProgress = false;
                if (requestId == mOpenclawVersionRequestId) {
                    ++mOpenclawVersionRequestId;
                }
            })
            .create();
        mOpenclawVersionManagerDialog.show();

        fetchOpenclawVersions((versions, errorMessage) -> {
            if (requestId != mOpenclawVersionRequestId || getActivity() == null || !isAdded()) {
                mOpenclawVersionActionInProgress = false;
                return;
            }
            dismissOpenclawVersionManagerDialog();
            if (versions == null || versions.isEmpty()) {
                showOpenclawVersionManagerError(TextUtils.isEmpty(errorMessage) ? "No versions available" : errorMessage);
                return;
            }
            showOpenclawVersions(versions);
        });
    }

    private void dismissOpenclawVersionManagerDialog() {
        if (mOpenclawVersionManagerDialog != null) {
            mOpenclawVersionManagerDialog.dismiss();
            mOpenclawVersionManagerDialog = null;
        }
        mOpenclawVersionActionInProgress = false;
    }

    private void showOpenclawVersionManagerError(String message) {
        Context ctx = getContext();
        if (ctx == null) {
            mOpenclawVersionActionInProgress = false;
            return;
        }
        mOpenclawVersionManagerDialog = new AlertDialog.Builder(ctx)
            .setTitle("OpenClaw Versions")
            .setMessage(message)
            .setNegativeButton("Close", (d, w) -> mOpenclawVersionActionInProgress = false)
            .setPositiveButton("Retry", (d, w) -> showOpenclawVersionListDialog())
            .setCancelable(false)
            .setOnDismissListener(d -> mOpenclawVersionActionInProgress = false)
            .show();
    }

    private void showOpenclawVersions(List<String> versions) {
        Context ctx = getContext();
        if (ctx == null) {
            mOpenclawVersionActionInProgress = false;
            return;
        }

        List<String> normalized = OpenclawVersionUtils.normalizeVersionList(versions);
        if (normalized.isEmpty()) {
            mOpenclawVersionActionInProgress = false;
            showOpenclawVersionManagerError("No valid versions found");
            return;
        }

        String currentVersion = OpenclawVersionUtils.normalizeForSort(BotDropService.getOpenclawVersion());

        // Ensure current version is in the list
        if (!TextUtils.isEmpty(currentVersion) && !normalized.contains(currentVersion)) {
            normalized.add(currentVersion);
            normalized = new ArrayList<>(OpenclawVersionUtils.sortAndLimit(normalized));
        }
        final List<String> finalNormalized = normalized;

        String[] labels = new String[normalized.size()];
        for (int i = 0; i < normalized.size(); i++) {
            String v = normalized.get(i);
            if (!TextUtils.isEmpty(currentVersion) && TextUtils.equals(currentVersion, v)) {
                labels[i] = OpenclawVersionUtils.VERSION_PREFIX + v + "  ← installed";
            } else {
                labels[i] = OpenclawVersionUtils.VERSION_PREFIX + v;
            }
        }

        mOpenclawVersionActionInProgress = true;
        mOpenclawVersionManagerDialog = new AlertDialog.Builder(ctx)
            .setTitle("OpenClaw Versions")
            .setItems(labels, (d, which) -> {
                if (which < 0 || which >= finalNormalized.size()) {
                    mOpenclawVersionActionInProgress = false;
                    return;
                }
                handleOpenclawVersionPick(finalNormalized.get(which));
            })
            .setNegativeButton("Close", (d, w) -> mOpenclawVersionActionInProgress = false)
            .create();
        mOpenclawVersionManagerDialog.show();
    }

    private void handleOpenclawVersionPick(String version) {
        String picked = OpenclawVersionUtils.normalizeForSort(version);
        if (TextUtils.isEmpty(picked)) {
            Context ctx = getContext();
            if (ctx != null) {
                Toast.makeText(ctx, "Invalid version format", Toast.LENGTH_SHORT).show();
            }
            mOpenclawVersionActionInProgress = false;
            return;
        }

        String currentVersion = OpenclawVersionUtils.normalizeForSort(BotDropService.getOpenclawVersion());
        if (!TextUtils.isEmpty(currentVersion) && TextUtils.equals(currentVersion, picked)) {
            openDashboard();
            mOpenclawVersionActionInProgress = false;
            return;
        }

        final String installVersion = OpenclawVersionUtils.normalizeInstallVersion(picked);
        if (TextUtils.isEmpty(installVersion)) {
            Context ctx = getContext();
            if (ctx != null) {
                Toast.makeText(ctx, "Invalid install version", Toast.LENGTH_SHORT).show();
            }
            mOpenclawVersionActionInProgress = false;
            return;
        }

        Context ctx = getContext();
        if (ctx == null) {
            mOpenclawVersionActionInProgress = false;
            return;
        }

        if (BotDropService.isOpenclawInstalled()) {
            new AlertDialog.Builder(ctx)
                .setTitle("Install OpenClaw")
                .setMessage("Installed: " + (TextUtils.isEmpty(currentVersion) ? "unknown" : "v" + currentVersion) + "\n\n"
                    + "Install " + installVersion + "?")
                .setNegativeButton("Cancel", (d, w) -> mOpenclawVersionActionInProgress = false)
                .setPositiveButton("Install", (d, w) -> installOpenclawInPlace(installVersion))
                .setCancelable(false)
                .setOnDismissListener(d -> mOpenclawVersionActionInProgress = false)
                .show();
        } else {
            new AlertDialog.Builder(ctx)
                .setTitle("Install OpenClaw")
                .setMessage("OpenClaw is not installed. Install " + installVersion + "?")
                .setNegativeButton("Cancel", (d, w) -> mOpenclawVersionActionInProgress = false)
                .setPositiveButton("Install", (d, w) -> installOpenclawWithSetup(installVersion))
                .setCancelable(false)
                .setOnDismissListener(d -> mOpenclawVersionActionInProgress = false)
                .show();
        }
    }

    private void installOpenclawInPlace(String installVersion) {
        if (mBotDropService == null) {
            mOpenclawVersionActionInProgress = false;
            return;
        }

        Context ctx = getContext();
        if (ctx == null) {
            mOpenclawVersionActionInProgress = false;
            return;
        }

        // Reuse the step-based progress dialog from Dashboard
        View dialogView = LayoutInflater.from(ctx).inflate(R.layout.dialog_openclaw_update, null);
        android.widget.TextView[] stepIcons = {
            dialogView.findViewById(R.id.update_step_0_icon),
            dialogView.findViewById(R.id.update_step_1_icon),
            dialogView.findViewById(R.id.update_step_2_icon),
            dialogView.findViewById(R.id.update_step_3_icon),
            dialogView.findViewById(R.id.update_step_4_icon),
        };
        android.widget.TextView statusMessage = dialogView.findViewById(R.id.update_status_message);

        mProgressDialog = new AlertDialog.Builder(ctx)
            .setTitle("Install OpenClaw")
            .setView(dialogView)
            .setCancelable(false)
            .create();
        mProgressDialog.show();

        final String[] stepMessages = {
            "Stopping gateway...",
            "Installing update...",
            "Finalizing...",
            "Starting gateway...",
            "Refreshing model list...",
        };

        mBotDropService.updateOpenclaw(installVersion, new BotDropService.UpdateProgressCallback() {
            private int currentStep = -1;

            private void advanceTo(String message) {
                int nextStep = -1;
                for (int i = 0; i < stepMessages.length; i++) {
                    if (stepMessages[i].equals(message)) {
                        nextStep = i;
                        break;
                    }
                }
                if (nextStep < 0) return;

                for (int i = 0; i <= currentStep && i < stepIcons.length; i++) {
                    stepIcons[i].setText("\u2713");
                }
                if (nextStep < stepIcons.length) {
                    stepIcons[nextStep].setText("\u25CF");
                }
                currentStep = nextStep;
            }

            @Override
            public void onStepStart(String message) {
                advanceTo(message);
            }

            @Override
            public void onError(String error) {
                if (mProgressDialog != null && mProgressDialog.isShowing()) {
                    statusMessage.setText("Install failed: " + error);
                    mProgressDialog.setButton(AlertDialog.BUTTON_NEGATIVE, "Close",
                        (d, w) -> {
                            d.dismiss();
                            mProgressDialog = null;
                            mOpenclawVersionActionInProgress = false;
                        });
                } else {
                    mOpenclawVersionActionInProgress = false;
                }
            }

            @Override
            public void onComplete(String version) {
                for (android.widget.TextView icon : stepIcons) {
                    icon.setText("\u2713");
                }
                statusMessage.setText("Installed v" + version);

                if (getActivity() != null && isAdded()) {
                    getActivity().getWindow().getDecorView().postDelayed(() -> {
                        if (mProgressDialog != null && mProgressDialog.isShowing()) {
                            mProgressDialog.dismiss();
                            mProgressDialog = null;
                        }
                        mOpenclawVersionActionInProgress = false;
                        openDashboard();
                    }, 1500);
                    return;
                }
                mOpenclawVersionActionInProgress = false;
            }
        });
    }

    private void installOpenclawWithSetup(String installVersion) {
        mOpenclawVersionActionInProgress = false;
        Context ctx = getContext();
        if (ctx == null) {
            return;
        }
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_OPENCLAW_VERSION, installVersion).apply();
        TermuxInstaller.createBotDropScripts(installVersion);

        SetupActivity activity = (SetupActivity) getActivity();
        if (activity != null && !activity.isFinishing()) {
            activity.goToNextStep();
        }
    }

    private void fetchOpenclawVersions(OpenclawVersionUtils.VersionListCallback cb) {
        if (cb == null) {
            return;
        }

        if (mBotDropService == null || !mServiceBound) {
            String currentVersion = BotDropService.getOpenclawVersion();
            cb.onResult(OpenclawVersionUtils.buildFallback(currentVersion), "Service not connected");
            return;
        }

        List<String> cachedVersions = loadOpenclawVersionCache();
        if (cachedVersions != null && !cachedVersions.isEmpty() && isOpenclawVersionCacheFresh()) {
            Logger.logInfo(LOG_TAG, "OpenClaw versions loaded from cache");
            cb.onResult(cachedVersions, null);
            return;
        }

        String currentVersion = BotDropService.getOpenclawVersion();
        mBotDropService.executeCommand(OpenclawVersionUtils.VERSIONS_COMMAND, result -> {
            if (result == null || !result.success) {
                if (cachedVersions != null && !cachedVersions.isEmpty()) {
                    cb.onResult(cachedVersions,
                        result == null ? "Failed to fetch versions, using cache" : "Failed to fetch versions (exit " + result.exitCode + "), using cache");
                    return;
                }
                cb.onResult(OpenclawVersionUtils.buildFallback(currentVersion),
                    result == null ? "Failed to fetch versions" : "Failed to fetch versions (exit " + result.exitCode + ")");
                return;
            }

            List<String> versions = OpenclawVersionUtils.parseVersions(result.stdout);
            if (versions.isEmpty()) {
                if (cachedVersions != null && !cachedVersions.isEmpty()) {
                    cb.onResult(cachedVersions, "No versions found, using cache");
                    return;
                }
                cb.onResult(OpenclawVersionUtils.buildFallback(currentVersion), "No versions found");
                return;
            }

            persistOpenclawVersionCache(versions);
            cb.onResult(versions, null);
        });
    }

    private boolean isOpenclawVersionCacheFresh() {
        Context ctx = getContext();
        if (ctx == null) {
            return false;
        }
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long cacheTime = prefs.getLong(KEY_OPENCLAW_VERSION_CACHE_TIME, 0L);
        if (cacheTime <= 0) {
            return false;
        }
        return System.currentTimeMillis() - cacheTime <= OPENCLAW_VERSION_CACHE_TTL_MS;
    }

    private List<String> loadOpenclawVersionCache() {
        Context ctx = getContext();
        if (ctx == null) {
            return null;
        }
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String rawCache = prefs.getString(KEY_OPENCLAW_VERSION_CACHE, null);
        if (TextUtils.isEmpty(rawCache)) {
            return null;
        }

        List<String> versions = new ArrayList<>();
        try {
            JSONArray cacheArray = new JSONArray(rawCache);
            for (int i = 0; i < cacheArray.length(); i++) {
                String token = cacheArray.optString(i, null);
                String normalized = OpenclawVersionUtils.normalizeForSort(token);
                if (OpenclawVersionUtils.isStableVersion(normalized)) {
                    versions.add(normalized);
                }
            }
        } catch (Exception e) {
            return null;
        }

        return OpenclawVersionUtils.sortAndLimit(versions);
    }

    private void persistOpenclawVersionCache(List<String> versions) {
        Context ctx = getContext();
        if (ctx == null) {
            return;
        }
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (versions == null || versions.isEmpty()) {
            prefs.edit().remove(KEY_OPENCLAW_VERSION_CACHE).remove(KEY_OPENCLAW_VERSION_CACHE_TIME).apply();
            return;
        }

        List<String> stableSorted = OpenclawVersionUtils.sortAndLimit(versions);
        JSONArray cacheArray = new JSONArray();
        for (String version : stableSorted) {
            String normalized = OpenclawVersionUtils.normalizeForSort(version);
            if (!TextUtils.isEmpty(normalized)) {
                cacheArray.put(normalized);
            }
        }

        prefs.edit()
            .putString(KEY_OPENCLAW_VERSION_CACHE, cacheArray.toString())
            .putLong(KEY_OPENCLAW_VERSION_CACHE_TIME, System.currentTimeMillis())
            .apply();
    }

    private void showVersionPinDialog() {
        Context ctx = getContext();
        if (ctx == null) return;

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String current = prefs.getString(KEY_OPENCLAW_VERSION, null);
        boolean isPinned = PINNED_VERSION.equals(current);

        if (isPinned) {
            new AlertDialog.Builder(ctx)
                .setTitle("OpenClaw Version")
                .setMessage("Current install version: " + PINNED_VERSION + "\n\nReset to latest?")
                .setPositiveButton("Reset to latest", (d, w) -> {
                    prefs.edit().remove(KEY_OPENCLAW_VERSION).apply();
                    TermuxInstaller.createBotDropScripts("openclaw@latest");
                    Toast.makeText(ctx, "Reset to openclaw@latest", Toast.LENGTH_SHORT).show();
                    Logger.logInfo(LOG_TAG, "OpenClaw version reset to latest");
                })
                .setNegativeButton("Cancel", null)
                .show();
        } else {
            new AlertDialog.Builder(ctx)
                .setTitle("OpenClaw Version")
                .setMessage("Pin install version to " + PINNED_VERSION + "?")
                .setPositiveButton("Pin", (d, w) -> {
                    prefs.edit().putString(KEY_OPENCLAW_VERSION, PINNED_VERSION).apply();
                    TermuxInstaller.createBotDropScripts(PINNED_VERSION);
                    Toast.makeText(ctx, "Set to " + PINNED_VERSION, Toast.LENGTH_SHORT).show();
                    Logger.logInfo(LOG_TAG, "OpenClaw version pinned to " + PINNED_VERSION);
                })
                .setNegativeButton("Cancel", null)
                .show();
        }
    }

    private void openDashboard() {
        Context ctx = getContext();
        if (ctx == null) {
            return;
        }
        Intent dashboardIntent = new Intent(ctx, DashboardActivity.class);
        startActivity(dashboardIntent);
        android.app.Activity activity = getActivity();
        if (activity instanceof SetupActivity && !activity.isFinishing()) {
            activity.finish();
        }
    }
}
