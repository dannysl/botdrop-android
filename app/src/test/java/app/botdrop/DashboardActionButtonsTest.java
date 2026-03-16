package app.botdrop;

import static org.junit.Assert.assertNotNull;

import android.widget.ImageView;

import androidx.appcompat.app.AppCompatActivity;

import com.termux.R;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class DashboardActionButtonsTest {

    @Test
    public void dashboardActionButtonsShowLeadingIcons() {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class)
            .setup()
            .get();

        activity.setContentView(R.layout.activity_botdrop_dashboard);

        assertHasImage(activity.findViewById(R.id.btn_start_icon));
        assertHasImage(activity.findViewById(R.id.btn_stop_icon));
        assertHasImage(activity.findViewById(R.id.btn_restart_icon));
    }

    private static void assertHasImage(ImageView imageView) {
        assertNotNull(imageView);
        assertNotNull("Expected icon drawable on " + imageView.getId(), imageView.getDrawable());
    }
}
