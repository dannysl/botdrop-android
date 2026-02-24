package app.botdrop;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Bundle;
import android.os.IBinder;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;

import com.termux.R;
import com.termux.shared.logger.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;

/**
 * Base class for channel configuration pages (Telegram/Discord/Feishu).
 */
public abstract class ChannelFormFragment extends Fragment {

    private static final String LOG_TAG = "ChannelFormFragment";

    private ChannelConfigMeta mMeta;
    private Button mOpenSetupBotButton;
    private TextView mTokenLabel;
    private EditText mTokenInput;
    private TextView mOwnerLabel;
    private EditText mOwnerInput;
    private View mOwnerRow;
    private TextView mFeishuUserIdLabel;
    private EditText mFeishuUserIdInput;
    private TextView mFeishuUserIdHelp;
    private View mFeishuUserIdRow;
    private View mDiscordGuildRow;
    private TextView mDiscordGuildLabel;
    private EditText mDiscordGuildInput;
    private View mDiscordChannelRow;
    private TextView mDiscordChannelLabel;
    private EditText mDiscordChannelInput;
    private Button mConnectButton;
    private Button mSkipButton;
    private TextView mErrorMessage;
    private TextView mSetupHelpText;

    private BotDropService mService;
    private boolean mBound;
    private boolean mHasExistingConfig;

    private ServiceConnection mConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            BotDropService.LocalBinder binder = (BotDropService.LocalBinder) service;
            mService = binder.getService();
            mBound = true;
            Logger.logDebug(LOG_TAG, "Service connected");
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            mBound = false;
            Logger.logDebug(LOG_TAG, "Service disconnected");
        }
    };

    @Override
    public void onAttach(@NonNull Context context) {
        super.onAttach(context);
        mMeta = ChannelConfigMeta.forPlatform(getPlatformId());
    }

    @Override
    public View onCreateView(
        @NonNull LayoutInflater inflater,
        @Nullable ViewGroup container,
        @Nullable Bundle savedInstanceState
    ) {
        return inflater.inflate(getLayoutResId(), container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        mOpenSetupBotButton = view.findViewById(R.id.channel_open_setup_bot);
        mTokenLabel = view.findViewById(R.id.channel_token_label);
        mTokenInput = view.findViewById(R.id.channel_token_input);
        mOwnerLabel = view.findViewById(R.id.channel_owner_label);
        mOwnerInput = view.findViewById(R.id.channel_owner_input);
        mOwnerRow = view.findViewById(R.id.channel_owner_row);
        mFeishuUserIdLabel = view.findViewById(R.id.channel_feishu_user_id_label);
        mFeishuUserIdInput = view.findViewById(R.id.channel_feishu_user_id_input);
        mFeishuUserIdHelp = view.findViewById(R.id.channel_feishu_user_id_help);
        mFeishuUserIdRow = view.findViewById(R.id.channel_feishu_user_id_row);
        mDiscordGuildRow = view.findViewById(R.id.channel_discord_guild_id_row);
        mDiscordGuildLabel = view.findViewById(R.id.channel_discord_guild_id_label);
        mDiscordGuildInput = view.findViewById(R.id.channel_discord_guild_id_input);
        mDiscordChannelRow = view.findViewById(R.id.channel_discord_channel_id_row);
        mDiscordChannelLabel = view.findViewById(R.id.channel_discord_channel_id_label);
        mDiscordChannelInput = view.findViewById(R.id.channel_discord_channel_id_input);
        mConnectButton = view.findViewById(R.id.channel_connect_button);
        mSkipButton = view.findViewById(R.id.channel_skip_button);
        mErrorMessage = view.findViewById(R.id.channel_error_message);
        mSetupHelpText = view.findViewById(R.id.channel_setup_help_text);

        if (mMeta != null) {
            if (mTokenLabel != null) {
                mTokenLabel.setText(mMeta.tokenLabel);
            }
            if (mTokenInput != null) {
                mTokenInput.setHint(mMeta.tokenHint);
            }
            if (mOwnerLabel != null) {
                mOwnerLabel.setText(mMeta.ownerLabel);
            }
            if (mOwnerInput != null) {
                mOwnerInput.setHint(mMeta.ownerHint);
            }
            if (mOwnerRow != null) {
                mOwnerRow.setVisibility(mMeta.showOwnerField ? View.VISIBLE : View.GONE);
            }
            if (mFeishuUserIdRow != null) {
                mFeishuUserIdRow.setVisibility(
                    CHANNEL_FEISHU.equals(mMeta.platform) ? View.VISIBLE : View.GONE
                );
            }
            if (mFeishuUserIdLabel != null) {
                mFeishuUserIdLabel.setText("User Open ID (Optional)");
            }
            if (mFeishuUserIdInput != null) {
                mFeishuUserIdInput.setHint("Optional User Open ID");
            }
            if (mFeishuUserIdHelp != null) {
                mFeishuUserIdHelp.setText(
                    "Leave this empty for pairing mode. Chat with the bot once to get your open_id."
                );
            }
            if (mDiscordGuildRow != null) {
                mDiscordGuildRow.setVisibility(
                    CHANNEL_DISCORD.equals(mMeta.platform) ? View.VISIBLE : View.GONE
                );
            }
            if (mDiscordGuildLabel != null) {
                mDiscordGuildLabel.setText("Discord Guild ID");
            }
            if (mDiscordGuildInput != null) {
                mDiscordGuildInput.setHint("Your guild ID");
            }
            if (mDiscordChannelRow != null) {
                mDiscordChannelRow.setVisibility(
                    CHANNEL_DISCORD.equals(mMeta.platform) ? View.VISIBLE : View.GONE
                );
            }
            if (mDiscordChannelLabel != null) {
                mDiscordChannelLabel.setText("Discord Channel ID");
            }
            if (mDiscordChannelInput != null) {
                mDiscordChannelInput.setHint("Target channel ID");
            }
            if (mSetupHelpText != null && mMeta.setupHelpText != null) {
                mSetupHelpText.setText(mMeta.setupHelpText);
            }
        }

        mOpenSetupBotButton.setOnClickListener(v -> openSetupBot());
        mConnectButton.setOnClickListener(v -> connect());
        preloadExistingConfig();
        configureSkipAction();

        Logger.logDebug(LOG_TAG, "ChannelFormFragment view created for " + (mMeta == null ? "unknown" : mMeta.platform));
    }

    @Override
    public void onStart() {
        super.onStart();
        Intent intent = new Intent(requireActivity(), BotDropService.class);
        requireActivity().bindService(intent, mConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    public void onStop() {
        super.onStop();
        if (mBound) {
            try {
                requireActivity().unbindService(mConnection);
            } catch (IllegalArgumentException e) {
                Logger.logDebug(LOG_TAG, "Service was already unbound");
            }
            mBound = false;
        }
    }

    private void openSetupBot() {
        if (mMeta == null || TextUtils.isEmpty(mMeta.setupBotUrl)) {
            return;
        }
        Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(mMeta.setupBotUrl));
        startActivity(browserIntent);
    }

    private void connect() {
        if (mMeta == null) {
            return;
        }

        mErrorMessage.setVisibility(View.GONE);

        String token = mTokenInput.getText().toString().trim();
        String ownerId = mOwnerInput != null ? mOwnerInput.getText().toString().trim() : "";
        String feishuUserId = mFeishuUserIdInput != null ? mFeishuUserIdInput.getText().toString().trim() : "";
        String guildId = mDiscordGuildInput != null ? mDiscordGuildInput.getText().toString().trim() : "";
        String channelId = mDiscordChannelInput != null ? mDiscordChannelInput.getText().toString().trim() : "";

        if (!mMeta.isTokenValid(token)) {
            if (CHANNEL_TELEGRAM.equals(mMeta.platform)) {
                showError("Please enter a valid bot token");
            } else if (CHANNEL_FEISHU.equals(mMeta.platform)) {
                showError("Please enter your App ID");
            } else {
                showError("Please enter your token");
            }
            return;
        }

        if (!mMeta.isOwnerValid(ownerId)) {
            if (CHANNEL_FEISHU.equals(mMeta.platform)) {
                showError("Please enter a valid App Secret");
            } else {
                showError("Please enter a valid owner ID");
            }
            return;
        }

        if (CHANNEL_DISCORD.equals(mMeta.platform)) {
            if (!mMeta.isDiscordGuildIdValid(guildId)) {
                showError("Please enter a valid guild ID");
                return;
            }

            if (!mMeta.isDiscordChannelIdValid(channelId)) {
                showError("Please enter a valid channel ID");
                return;
            }
        }

        mConnectButton.setEnabled(false);
        mConnectButton.setText("Connecting...");

        boolean success;
        if (CHANNEL_DISCORD.equals(mMeta.platform)) {
            success = ChannelSetupHelper.writeChannelConfig(
                mMeta.platform,
                token,
                ownerId,
                guildId,
                channelId
            );
        } else if (CHANNEL_FEISHU.equals(mMeta.platform)) {
            success = ChannelSetupHelper.writeFeishuChannelConfig(
                token,
                ownerId,
                feishuUserId
            );
        } else {
            success = ChannelSetupHelper.writeChannelConfig(
                mMeta.platform,
                token,
                ownerId
            );
        }
        if (!success) {
            showError("Failed to write configuration");
            resetButton();
            return;
        }

        if (CHANNEL_TELEGRAM.equals(mMeta.platform)) {
            try {
                ConfigTemplate template = ConfigTemplateCache.loadTemplate(requireContext());
                if (template == null) {
                    template = new ConfigTemplate();
                }
                template.tgBotToken = token;
                template.tgUserId = ownerId;
                ConfigTemplateCache.saveTemplate(requireContext(), template);
            } catch (Exception e) {
                Logger.logError(LOG_TAG, "Failed to save template: " + e.getMessage());
            }
        }

        startGateway();
    }

    private void preloadExistingConfig() {
        mHasExistingConfig = false;
        try {
            JSONObject config = BotDropConfig.readConfig();
            JSONObject channels = config != null ? config.optJSONObject("channels") : null;
            if (channels == null || mMeta == null) {
                return;
            }

            JSONObject channelConfig = channels.optJSONObject(mMeta.platform);
            if (channelConfig == null) {
                return;
            }

            String token;
            String owner;
            String feishuUserId = null;
            if (CHANNEL_FEISHU.equals(mMeta.platform)) {
                token = extractFeishuAppIdFromChannelConfig(channelConfig);
                owner = extractFeishuAppSecretFromChannelConfig(channelConfig);
                feishuUserId = extractFeishuUserIdFromChannelConfig(channelConfig);
            } else {
                token = channelConfig.optString("botToken", null);
                if (TextUtils.isEmpty(token)) {
                    token = channelConfig.optString("token", null);
                }
                owner = extractOwnerFromChannelConfig(channelConfig);
            }
            String guildId = null;
            String channelId = null;
            JSONObject guilds = channelConfig.optJSONObject("guilds");
            if (guilds != null && guilds.length() > 0) {
                Iterator<String> guildIterator = guilds.keys();
                while (guildIterator.hasNext()) {
                    String guild = guildIterator.next();
                    if (TextUtils.isEmpty(guild)) {
                        continue;
                    }
                    JSONObject guildConfig = guilds.optJSONObject(guild);
                    if (guildConfig == null) {
                        continue;
                    }
                    channels = guildConfig.optJSONObject("channels");
                    if (channels == null || channels.length() == 0) {
                        continue;
                    }
                    Iterator<String> channelIterator = channels.keys();
                    if (channelIterator.hasNext()) {
                        guildId = guild;
                        channelId = channelIterator.next();
                        break;
                    }
                }
            }
            if (CHANNEL_DISCORD.equals(mMeta.platform) && TextUtils.isEmpty(guildId)) {
                return;
            }


            if (!TextUtils.isEmpty(token)) {
                mHasExistingConfig = true;
                mTokenInput.setText(token.trim());
            }
            if (mOwnerInput != null && !TextUtils.isEmpty(owner)) {
                mOwnerInput.setText(owner.trim());
            }
            if (mFeishuUserIdInput != null && !TextUtils.isEmpty(feishuUserId)) {
                mFeishuUserIdInput.setText(feishuUserId.trim());
            }
            if (mDiscordGuildInput != null && !TextUtils.isEmpty(guildId)) {
                mDiscordGuildInput.setText(guildId.trim());
            }
            if (mDiscordChannelInput != null && !TextUtils.isEmpty(channelId)) {
                mDiscordChannelInput.setText(channelId.trim());
            }

            if (CHANNEL_DISCORD.equals(mMeta.platform)) {
                mHasExistingConfig = !TextUtils.isEmpty(token)
                    && !TextUtils.isEmpty(guildId)
                    && !TextUtils.isEmpty(channelId);
            } else if (CHANNEL_FEISHU.equals(mMeta.platform)) {
                mHasExistingConfig = !TextUtils.isEmpty(token)
                    && !TextUtils.isEmpty(owner);
                String dmPolicy = channelConfig.optString("dmPolicy", "").trim();
                if ("allowlist".equals(dmPolicy) && TextUtils.isEmpty(feishuUserId)) {
                    mHasExistingConfig = false;
                }
            }

        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to preload channel config: " + e.getMessage());
        }
    }

    private String extractOwnerFromChannelConfig(JSONObject channelConfig) {
        Object owner = channelConfig.opt("ownerId");
        if (owner != null) {
            return String.valueOf(owner);
        }

        Object appSecret = channelConfig.opt("appSecret");
        if (appSecret != null) {
            return String.valueOf(appSecret);
        }

        Object ownerFromAllowFrom = channelConfig.opt("allowFrom");
        if (ownerFromAllowFrom instanceof String) {
            return (String) ownerFromAllowFrom;
        }
        if (ownerFromAllowFrom instanceof JSONArray) {
            JSONArray ids = (JSONArray) ownerFromAllowFrom;
            if (ids.length() > 0) {
                Object first = ids.opt(0);
                return first != null ? String.valueOf(first) : null;
            }
        }
        return "";
    }

    private String extractFeishuAppIdFromChannelConfig(JSONObject channelConfig) {
        if (channelConfig == null) {
            return "";
        }

        JSONObject accounts = channelConfig.optJSONObject("accounts");
        JSONObject mainAccount = accounts != null ? accounts.optJSONObject("main") : null;
        if (mainAccount == null) {
            return "";
        }

        Object appId = mainAccount.opt("appId");
        return appId != null ? String.valueOf(appId) : "";
    }

    private String extractFeishuAppSecretFromChannelConfig(JSONObject channelConfig) {
        if (channelConfig == null) {
            return "";
        }

        JSONObject accounts = channelConfig.optJSONObject("accounts");
        JSONObject mainAccount = accounts != null ? accounts.optJSONObject("main") : null;
        if (mainAccount == null) {
            return "";
        }

        Object appSecret = mainAccount.opt("appSecret");
        return appSecret != null ? String.valueOf(appSecret) : "";
    }

    private String extractFeishuUserIdFromChannelConfig(JSONObject channelConfig) {
        if (channelConfig == null) {
            return "";
        }

        Object allowFrom = channelConfig.opt("allowFrom");
        if (allowFrom instanceof String) {
            String userId = (String) allowFrom;
            return userId != null ? userId : "";
        }
        if (allowFrom instanceof JSONArray) {
            JSONArray ids = (JSONArray) allowFrom;
            if (ids.length() > 0) {
                Object first = ids.opt(0);
                return first != null ? String.valueOf(first) : "";
            }
        }
        return "";
    }

    private void configureSkipAction() {
        if (mSkipButton == null) {
            return;
        }

        if (mHasExistingConfig) {
            mSkipButton.setText("Cancel");
            mSkipButton.setOnClickListener(v -> finishChannelSetup());
        } else {
            mSkipButton.setOnClickListener(v -> skipSetup());
        }
    }

    private void startGateway() {
        if (!mBound || mService == null) {
            showError("Service not ready, please try again");
            resetButton();
            return;
        }

        Logger.logInfo(LOG_TAG, "Starting gateway...");
        mService.startGateway(result -> {
            if (!isAdded() || getActivity() == null || getActivity().isFinishing()) {
                return;
            }

            requireActivity().runOnUiThread(() -> {
                if (!isAdded() || getActivity() == null || getActivity().isFinishing()) {
                    return;
                }

                if (result.success) {
                    Logger.logInfo(LOG_TAG, "Gateway started successfully");
                    Toast.makeText(requireContext(), "Connected! Gateway is starting...", Toast.LENGTH_LONG).show();

                    SetupActivity activity = (SetupActivity) getActivity();
                    if (activity != null && !activity.isFinishing()) {
                        activity.goToNextStep();
                    }
                } else {
                    Logger.logError(LOG_TAG, "Failed to start gateway: " + result.stderr);
                    String errorMsg = result.stderr;
                    if (TextUtils.isEmpty(errorMsg)) {
                        errorMsg = result.stdout;
                    }
                    if (TextUtils.isEmpty(errorMsg)) {
                        errorMsg = "Unknown error (exit code: " + result.exitCode + ")";
                    }
                    showError("Failed to start gateway: " + errorMsg);
                    resetButton();
                }
            });
        });
    }

    private void skipSetup() {
        if (!isAdded() || getActivity() == null || getActivity().isFinishing()) {
            return;
        }
        String platformLabel = mMeta == null ? "This channel" : mMeta.title;
        new AlertDialog.Builder(requireContext())
            .setTitle("Skip " + platformLabel + " setup?")
            .setMessage("If you skip now, " + platformLabel + " will remain unconfigured. "
                + "You can configure channels later from the OpenClaw Web UI.")
            .setPositiveButton("Skip", (dialog, which) -> {
                Logger.logInfo(LOG_TAG, "User skipped channel setup");
                SetupActivity activity = (SetupActivity) getActivity();
                if (activity == null || activity.isFinishing()) {
                    return;
                }
                activity.goToNextStep();
            })
            .setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss())
            .show();
    }

    private void finishChannelSetup() {
        if (!isAdded() || getActivity() == null || getActivity().isFinishing()) {
            return;
        }
        getActivity().finish();
    }

    private void showError(String message) {
        mErrorMessage.setText(message);
        mErrorMessage.setVisibility(View.VISIBLE);
    }

    private void resetButton() {
        mConnectButton.setEnabled(true);
        mConnectButton.setText("Connect & Start");
    }

    private static final String CHANNEL_TELEGRAM = "telegram";
    private static final String CHANNEL_DISCORD = "discord";
    private static final String CHANNEL_FEISHU = "feishu";

    protected abstract String getPlatformId();
    protected abstract int getLayoutResId();
}
