package app.botdrop;

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.viewpager2.adapter.FragmentStateAdapter;

/**
 * Pager adapter for IM channel configuration tabs.
 */
public class ChannelPagerAdapter extends FragmentStateAdapter {

    public static final int PAGE_TELEGRAM = 0;
    public static final int PAGE_DISCORD = 1;
    public static final int PAGE_FEISHU = 2;
    private static final int PAGE_COUNT = 3;

    public ChannelPagerAdapter(@NonNull Fragment fragment) {
        super(fragment);
    }

    @NonNull
    @Override
    public Fragment createFragment(int position) {
        if (position == PAGE_DISCORD) {
            return new DiscordChannelFragment();
        }
        if (position == PAGE_FEISHU) {
            return new FeishuChannelFragment();
        }
        return new TelegramChannelFragment();
    }

    @Override
    public int getItemCount() {
        return PAGE_COUNT;
    }
}
