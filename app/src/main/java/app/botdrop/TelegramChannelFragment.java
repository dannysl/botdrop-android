package app.botdrop;

import com.termux.R;

/**
 * Telegram configuration page in Channel tabs.
 */
public class TelegramChannelFragment extends ChannelFormFragment {

    @Override
    protected String getPlatformId() {
        return ChannelConfigMeta.PLATFORM_TELEGRAM;
    }

    @Override
    protected int getLayoutResId() {
        return R.layout.fragment_botdrop_channel_telegram;
    }
}
