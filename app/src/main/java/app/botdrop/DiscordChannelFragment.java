package app.botdrop;

import com.termux.R;

/**
 * Discord configuration page in Channel tabs.
 */
public class DiscordChannelFragment extends ChannelFormFragment {

    @Override
    protected String getPlatformId() {
        return ChannelConfigMeta.PLATFORM_DISCORD;
    }

    @Override
    protected int getLayoutResId() {
        return R.layout.fragment_botdrop_channel_discord;
    }
}
