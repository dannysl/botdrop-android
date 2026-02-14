package app.botdrop.automation;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

final class DiagnoseAppOperation {

    private DiagnoseAppOperation() {}

    static JSONObject run(BotDropAccessibilityService svc, JSONObject req) {
        String packageName = req.optString("packageName", "").trim();
        if (packageName.isEmpty()) return err("BAD_REQUEST", "missing packageName");

        JSONObject out = new JSONObject();
        PackageManager pm = svc.getPackageManager();
        Json.put(out, "ok", true);
        Json.put(out, "requestedPackage", packageName);
        Json.put(out, "packageName", packageName);
        Json.put(out, "activePackage", svc.getActivePackageName());
        Json.put(out, "observedPackage", svc.getLastObservedPackageName());

        PackageInfo pi = getPackageInfo(pm, packageName);
        if (pi == null) {
            Json.put(out, "installed", false);
            Json.put(out, "error", "PACKAGE_NOT_FOUND");
            return out;
        }

        ApplicationInfo ai = pi.applicationInfo;
        Json.put(out, "installed", true);
        Json.put(out, "enabled", ai != null && ai.enabled);
        Json.put(out, "suspended", isSuspended(ai));
        Json.put(out, "stopped", ai != null && ((ai.flags & ApplicationInfo.FLAG_STOPPED) != 0));
        if (ai != null) {
            Json.put(out, "uid", ai.uid);
            Json.put(out, "targetSdkVersion", ai.targetSdkVersion);
        }
        Json.put(out, "versionName", pi.versionName != null ? pi.versionName : "");
        Json.put(out, "versionCode", getVersionCode(pi));

        Intent launchIntent = pm.getLaunchIntentForPackage(packageName);
        Json.put(out, "launchIntentFound", launchIntent != null);
        if (launchIntent != null && launchIntent.getComponent() != null) {
            Json.put(out, "launchComponent", launchIntent.getComponent().flattenToShortString());
        }

        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        launcher.setPackage(packageName);

        List<ResolveInfo> launcherActivities = pm.queryIntentActivities(launcher, 0);
        JSONArray arr = new JSONArray();
        if (launcherActivities != null) {
            for (ResolveInfo ri : launcherActivities) {
                ActivityInfo info = ri.activityInfo;
                if (info == null) continue;
                JSONObject one = new JSONObject();
                Json.put(one, "name", info.name != null ? info.name : "");
                Json.put(one, "packageName", info.packageName != null ? info.packageName : "");
                Json.put(one, "enabled", info.enabled);
                Json.put(one, "exported", info.exported);
                Json.put(one, "permission", info.permission != null ? info.permission : "");
                arr.put(one);
            }
        }
        Json.put(out, "launcherActivities", arr);
        Json.put(out, "launcherActivityCount", arr.length());
        Json.put(out, "launchable", launchIntent != null || arr.length() > 0);
        return out;
    }

    private static @Nullable PackageInfo getPackageInfo(PackageManager pm, String packageName) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                return pm.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_ACTIVITIES));
            }
            return pm.getPackageInfo(packageName, PackageManager.GET_ACTIVITIES);
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isSuspended(@Nullable ApplicationInfo ai) {
        if (ai == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        return (ai.flags & ApplicationInfo.FLAG_SUSPENDED) != 0;
    }

    private static long getVersionCode(PackageInfo pi) {
        if (Build.VERSION.SDK_INT >= 28) return pi.getLongVersionCode();
        return pi.versionCode;
    }

    private static JSONObject err(String code, String message) {
        JSONObject out = new JSONObject();
        Json.put(out, "ok", false);
        Json.put(out, "error", code);
        Json.put(out, "message", message == null ? "" : message);
        return out;
    }
}
