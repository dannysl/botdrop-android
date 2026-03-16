package app.botdrop;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;

import com.termux.R;
import com.termux.app.AnalyticsManager;
import com.termux.shared.logger.Logger;

import java.util.List;

public class BotDropSettingsActivity extends Activity {

    private static final String LOG_TAG = "BotDropSettingsActivity";
    private static final int OPENCLAW_VERSION_FETCH_TIMEOUT_SECONDS = 180;
    private static final String BOTDROP_WEBSITE_URL = "https://botdrop.app/";
    private static final String BOTDROP_X_URL = "https://x.com/botdropapp";
    private static final String BOTDROP_DISCORD_URL = "https://discord.gg/w8wdnMM6Vy";
    private static final String BOTDROP_DOCS_URL = "https://docs.botdrop.app/";

    private TextView mBotDropVersionText;
    private TextView mOpenclawVersionText;
    private Button mCheckBotDropUpdateButton;
    private Button mChangeVersionButton;
    private BotDropService mBotDropService;
    private boolean mBound = false;
    private AlertDialog mOpenclawVersionManagerDialog;
    private boolean mOpenclawVersionActionInProgress;
    private final Handler mHandler = new Handler();

    private final ServiceConnection mConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            BotDropService.LocalBinder binder = (BotDropService.LocalBinder) service;
            mBotDropService = binder.getService();
            mBound = true;
            refreshCurrentVersion();
            Logger.logDebug(LOG_TAG, "BotDropService connected");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            mBound = false;
            mBotDropService = null;
            Logger.logDebug(LOG_TAG, "BotDropService disconnected");
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_botdrop_settings);

        mBotDropVersionText = findViewById(R.id.settings_botdrop_version_text);
        mOpenclawVersionText = findViewById(R.id.settings_openclaw_version_text);
        mCheckBotDropUpdateButton = findViewById(R.id.btn_check_botdrop_update);
        mChangeVersionButton = findViewById(R.id.btn_change_openclaw_version);
        ImageButton backButton = findViewById(R.id.btn_settings_back);

        if (backButton != null) {
            backButton.setOnClickListener(v -> finish());
        }

        refreshBotDropVersion();

        if (mCheckBotDropUpdateButton != null) {
            mCheckBotDropUpdateButton.setOnClickListener(v -> {
                AnalyticsManager.logEvent(this, "settings_botdrop_update_tap");
                checkBotDropUpdate();
            });
        }

        if (mChangeVersionButton != null) {
            mChangeVersionButton.setOnClickListener(v -> {
                AnalyticsManager.logEvent(this, "settings_change_version_tap");
                showOpenclawVersionManagerDialog();
            });
        }

        bindExternalLink(R.id.settings_website_row, "settings_website_tap", BOTDROP_WEBSITE_URL);
        bindExternalLink(R.id.settings_x_row, "settings_x_tap", BOTDROP_X_URL);
        bindExternalLink(R.id.settings_discord_row, "settings_discord_tap", BOTDROP_DISCORD_URL);
        bindExternalLink(R.id.settings_docs_row, "settings_docs_tap", BOTDROP_DOCS_URL);
    }

    @Override
    protected void onStart() {
        super.onStart();
        Intent intent = new Intent(this, BotDropService.class);
        bindService(intent, mConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshCurrentVersion();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (mBound) {
            unbindService(mConnection);
            mBound = false;
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        mHandler.removeCallbacksAndMessages(null);
        if (mOpenclawVersionManagerDialog != null && mOpenclawVersionManagerDialog.isShowing()) {
            mOpenclawVersionManagerDialog.dismiss();
        }
        mOpenclawVersionManagerDialog = null;
    }

    private void refreshCurrentVersion() {
        if (mOpenclawVersionText == null) {
            return;
        }
        String currentVersion = BotDropService.getOpenclawVersion();
        if (TextUtils.isEmpty(currentVersion)) {
            mOpenclawVersionText.setText(getString(R.string.botdrop_unknown));
            return;
        }
        mOpenclawVersionText.setText(currentVersion);
    }

    private void refreshBotDropVersion() {
        if (mBotDropVersionText == null) {
            return;
        }
        try {
            PackageInfo packageInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            mBotDropVersionText.setText(
                TextUtils.isEmpty(packageInfo.versionName) ? getString(R.string.botdrop_unknown) : packageInfo.versionName
            );
        } catch (Exception e) {
            mBotDropVersionText.setText(getString(R.string.botdrop_unknown));
        }
    }

    private void checkBotDropUpdate() {
        if (mCheckBotDropUpdateButton != null) {
            mCheckBotDropUpdateButton.setEnabled(false);
        }
        UpdateChecker.forceCheck(this, (version, url, notes) -> {
            if (mCheckBotDropUpdateButton != null) {
                mCheckBotDropUpdateButton.setEnabled(true);
            }
            if (version != null && !version.isEmpty()) {
                new AlertDialog.Builder(this)
                    .setTitle(getString(R.string.botdrop_update_update_available))
                    .setMessage(getString(R.string.botdrop_update_update_message, version))
                    .setPositiveButton(getString(R.string.botdrop_open_browser), (d, w) -> openBotdropUpdatePage())
                    .setNegativeButton(getString(R.string.botdrop_cancel), null)
                    .show();
            } else {
                Toast.makeText(this, getString(R.string.botdrop_no_update_available), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void openBotdropUpdatePage() {
        openExternalUrl(BOTDROP_WEBSITE_URL);
    }

    private void bindExternalLink(int viewId, String analyticsEvent, String url) {
        View view = findViewById(viewId);
        if (view == null) {
            return;
        }
        view.setOnClickListener(v -> {
            AnalyticsManager.logEvent(this, analyticsEvent);
            openExternalUrl(url);
        });
    }

    private void openExternalUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to open url: " + url + " - " + e.getMessage());
            Toast.makeText(this, getString(R.string.botdrop_failed_to_open_link), Toast.LENGTH_SHORT).show();
        }
    }

    private boolean canShowDialog() {
        return !isFinishing() && !isDestroyed();
    }

    private void showOpenclawVersionManagerDialog() {
        if (mOpenclawVersionActionInProgress) {
            return;
        }
        if (!mBound || mBotDropService == null) {
            Toast.makeText(this, getString(R.string.botdrop_service_not_connected), Toast.LENGTH_SHORT).show();
            return;
        }

        setOpenclawVersionManagerBusy(true);
        dismissVersionDialog();

        mOpenclawVersionManagerDialog = BotDropDialogStyler.createBuilder(this)
            .setTitle(getString(R.string.botdrop_openclaw_versions))
            .setMessage(getString(R.string.botdrop_loading_versions))
            .setCancelable(false)
            .setNegativeButton(R.string.botdrop_cancel, (d, w) -> setOpenclawVersionManagerBusy(false))
            .create();
        mOpenclawVersionManagerDialog.show();

        fetchOpenclawVersions((versions, errorMessage) -> {
            if (!canShowDialog()) {
                setOpenclawVersionManagerBusy(false);
                return;
            }
            dismissVersionDialog();

            if (versions == null || versions.isEmpty()) {
                showOpenclawVersionManagerErrorDialog(
                    TextUtils.isEmpty(errorMessage) ? getString(R.string.botdrop_no_versions_available) : errorMessage
                );
                return;
            }

            showOpenclawVersionListDialog(versions);
        });
    }

    private void showOpenclawVersionManagerErrorDialog(String message) {
        if (!canShowDialog()) {
            return;
        }
        if (TextUtils.isEmpty(message)) {
            message = getString(R.string.botdrop_failed_to_load_version_list);
        }

        mOpenclawVersionManagerDialog = BotDropDialogStyler.createBuilder(this)
            .setTitle(getString(R.string.botdrop_openclaw_versions))
            .setMessage(message)
            .setNegativeButton(R.string.botdrop_close, (d, w) -> setOpenclawVersionManagerBusy(false))
            .setPositiveButton(R.string.botdrop_retry, (d, w) -> showOpenclawVersionManagerDialog())
            .setOnDismissListener(d -> setOpenclawVersionManagerBusy(false))
            .create();
        mOpenclawVersionManagerDialog.show();
    }

    private void showOpenclawVersionListDialog(List<String> versions) {
        if (!canShowDialog()) {
            return;
        }
        final List<String> normalized = OpenclawVersionUtils.normalizeVersionList(versions);
        if (normalized.isEmpty()) {
            showOpenclawVersionManagerErrorDialog(getString(R.string.botdrop_no_valid_versions_found));
            return;
        }

        String currentVersion = OpenclawVersionUtils.normalizeForSort(BotDropService.getOpenclawVersion());
        String[] labels = new String[normalized.size()];
        for (int i = 0; i < normalized.size(); i++) {
            String v = normalized.get(i);
            labels[i] = !TextUtils.isEmpty(currentVersion) && TextUtils.equals(currentVersion, v)
                ? getString(R.string.botdrop_openclaw_current_version, v)
                : getString(R.string.botdrop_openclaw_version, v);
        }

        mOpenclawVersionManagerDialog = BotDropDialogStyler.createBuilder(this)
            .setTitle(getString(R.string.botdrop_openclaw_versions))
            .setItems(labels, (d, which) -> {
                if (which < 0 || which >= normalized.size()) {
                    setOpenclawVersionManagerBusy(false);
                    return;
                }
                showOpenclawVersionInstallConfirm(normalized.get(which));
            })
            .setNegativeButton(R.string.botdrop_close, (d, w) -> setOpenclawVersionManagerBusy(false))
            .create();
        mOpenclawVersionManagerDialog.show();
    }

    private void showOpenclawVersionInstallConfirm(String version) {
        if (!canShowDialog()) {
            return;
        }
        String installVersion = OpenclawVersionUtils.normalizeInstallVersion(version);
        if (TextUtils.isEmpty(installVersion)) {
            setOpenclawVersionManagerBusy(false);
            Toast.makeText(this, getString(R.string.botdrop_invalid_version_format), Toast.LENGTH_SHORT).show();
            return;
        }

        mOpenclawVersionManagerDialog = BotDropDialogStyler.createBuilder(this)
            .setTitle(getString(R.string.botdrop_install) + " " + getString(R.string.botdrop_openclaw))
            .setMessage(getString(R.string.botdrop_install_openclaw_confirm, installVersion))
            .setCancelable(false)
            .setPositiveButton(R.string.botdrop_install, (d, w) -> {
                setOpenclawVersionManagerBusy(true);
                startOpenclawUpdate(installVersion);
            })
            .setNegativeButton(R.string.botdrop_cancel, (d, w) -> setOpenclawVersionManagerBusy(false))
            .setOnDismissListener(d -> setOpenclawVersionManagerBusy(false))
            .create();
        mOpenclawVersionManagerDialog.show();
    }

    private void fetchOpenclawVersions(OpenclawVersionUtils.VersionListCallback cb) {
        if (cb == null) {
            return;
        }
        String currentVersion = BotDropService.getOpenclawVersion();

        mBotDropService.executeCommand(
            OpenclawVersionUtils.VERSIONS_COMMAND,
            OPENCLAW_VERSION_FETCH_TIMEOUT_SECONDS,
            result -> {
                if (result == null || !result.success) {
                    String fallbackError = result == null
                        ? getString(R.string.botdrop_failed_to_fetch_versions)
                        : getString(R.string.botdrop_failed_to_fetch_versions_exit, String.valueOf(result.exitCode));
                    cb.onResult(OpenclawVersionUtils.buildFallback(currentVersion), fallbackError);
                    return;
                }

                List<String> versions = OpenclawVersionUtils.parseVersions(result.stdout);
                if (versions.isEmpty()) {
                    cb.onResult(OpenclawVersionUtils.buildFallback(currentVersion), getString(R.string.botdrop_no_versions_found));
                    return;
                }
                cb.onResult(versions, null);
            }
        );
    }

    private void setOpenclawVersionManagerBusy(boolean isBusy) {
        mOpenclawVersionActionInProgress = isBusy;
        if (mChangeVersionButton != null) {
            mChangeVersionButton.setEnabled(!isBusy);
        }
    }

    private void startOpenclawUpdate(String targetVersion) {
        if (TextUtils.isEmpty(targetVersion)) {
            Toast.makeText(this, getString(R.string.botdrop_no_update_target_version), Toast.LENGTH_SHORT).show();
            setOpenclawVersionManagerBusy(false);
            return;
        }

        dismissVersionDialog();
        setOpenclawVersionManagerBusy(true);
        if (!mBound || mBotDropService == null) {
            setOpenclawVersionManagerBusy(false);
            return;
        }

        AnalyticsManager.logEvent(this, "settings_version_update_started");

        android.view.View dialogView = getLayoutInflater().inflate(R.layout.dialog_openclaw_update, null);
        TextView[] stepIcons = {
            dialogView.findViewById(R.id.update_step_0_icon),
            dialogView.findViewById(R.id.update_step_1_icon),
            dialogView.findViewById(R.id.update_step_2_icon),
            dialogView.findViewById(R.id.update_step_3_icon),
            dialogView.findViewById(R.id.update_step_4_icon),
        };
        TextView[] stepPercents = {
            dialogView.findViewById(R.id.update_step_0_percent),
            dialogView.findViewById(R.id.update_step_1_percent),
            dialogView.findViewById(R.id.update_step_2_percent),
            dialogView.findViewById(R.id.update_step_3_percent),
            dialogView.findViewById(R.id.update_step_4_percent),
        };
        TextView statusMessage = dialogView.findViewById(R.id.update_status_message);

        AlertDialog progressDialog = BotDropDialogStyler.createBuilder(this)
            .setTitle(R.string.botdrop_updating_openclaw)
            .setView(dialogView)
            .setCancelable(false)
            .create();
        progressDialog.show();
        BotDropDialogStyler.applyTransparentCardWindow(progressDialog);

        mBotDropService.updateOpenclaw(targetVersion, new BotDropService.UpdateProgressCallback() {
            private int currentStep = -1;

            private void advanceToStep(int nextStep) {
                if (nextStep < 0) {
                    return;
                }
                for (int i = 0; i < nextStep && i < stepIcons.length; i++) {
                    stepIcons[i].setText("\u2713");
                    stepPercents[i].setText(StepPercentUtils.formatPercent(100));
                }
                if (nextStep < stepIcons.length) {
                    stepIcons[nextStep].setText("\u25CF");
                    if (nextStep > currentStep) {
                        stepPercents[nextStep].setText(StepPercentUtils.formatPercent(0));
                    }
                }
                currentStep = nextStep;
            }

            @Override
            public void onStepStart(String message) {
                int nextStep = OpenclawUpdateProgress.resolveStepFromMessage(message);
                advanceToStep(nextStep);
                if (nextStep >= 0 && nextStep < stepPercents.length) {
                    stepPercents[nextStep].setText(
                        StepPercentUtils.formatPercent(
                            StepPercentUtils.extractPercent(message, 0)
                        )
                    );
                }
            }

            @Override
            public void onError(String error) {
                AnalyticsManager.logEvent(BotDropSettingsActivity.this, "settings_version_update_failed");
                progressDialog.dismiss();
                setOpenclawVersionManagerBusy(false);
                if (canShowDialog()) {
                    BotDropDialogStyler.createBuilder(BotDropSettingsActivity.this)
                        .setTitle(R.string.botdrop_update_failed)
                        .setMessage(error)
                        .setPositiveButton(android.R.string.ok, null)
                        .show();
                }
                refreshCurrentVersion();
            }

            @Override
            public void onComplete(String newVersion) {
                advanceToStep(OpenclawUpdateProgress.STEP_REFRESHING_MODELS);
                for (int i = 0; i < stepPercents.length; i++) {
                    stepPercents[i].setText(StepPercentUtils.formatPercent(100));
                }
                statusMessage.setText(getString(R.string.botdrop_updated_to_version, newVersion));
                AnalyticsManager.logEvent(BotDropSettingsActivity.this, "settings_version_update_completed");

                mHandler.postDelayed(() -> {
                    if (canShowDialog()) {
                        progressDialog.dismiss();
                    }
                    setOpenclawVersionManagerBusy(false);
                    refreshCurrentVersion();
                }, 1500);
            }
        });
    }

    private void dismissVersionDialog() {
        if (mOpenclawVersionManagerDialog != null && mOpenclawVersionManagerDialog.isShowing()) {
            mOpenclawVersionManagerDialog.dismiss();
        }
        mOpenclawVersionManagerDialog = null;
    }
}
