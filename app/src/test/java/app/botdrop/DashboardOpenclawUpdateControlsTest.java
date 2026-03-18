package app.botdrop;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import android.view.View;
import android.widget.TextView;

import com.termux.R;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class DashboardOpenclawUpdateControlsTest {

    @Test
    public void dashboardDisablesOpenclawUpdateChecks() {
        assertFalse(DashboardActivity.isDashboardOpenclawUpdateCheckEnabled());
    }

    @Test
    public void dashboardHidesOpenclawCheckUpdateButton() {
        DashboardActivity activity = Robolectric.buildActivity(DashboardActivity.class)
            .create()
            .get();

        TextView checkButton = activity.findViewById(R.id.btn_check_openclaw_update);

        assertEquals(View.GONE, checkButton.getVisibility());

        activity.finish();
    }
}
