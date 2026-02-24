package app.botdrop;

import com.termux.R;

/**
 * Feishu configuration page in Channel tabs.
 */
public class FeishuChannelFragment extends ChannelFormFragment {

    @Override
    protected String getPlatformId() {
        return ChannelConfigMeta.PLATFORM_FEISHU;
    }

    @Override
    protected int getLayoutResId() {
        return R.layout.fragment_botdrop_channel_feishu;
    }
}
