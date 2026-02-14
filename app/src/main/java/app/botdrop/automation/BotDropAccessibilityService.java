package app.botdrop.automation;

import android.content.pm.PackageManager;

public interface BotDropAccessibilityService {
    PackageManager getPackageManager();
    String getActivePackageName();
    String getLastObservedPackageName();
}
