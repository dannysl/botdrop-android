package app.botdrop;

import android.text.TextUtils;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Static utility for OpenClaw version parsing, normalization, and comparison.
 * Shared between AgentSelectionFragment and DashboardActivity.
 */
public final class OpenclawVersionUtils {

    public static final String VERSION_PREFIX = "openclaw@";
    public static final String VERSIONS_COMMAND = "npm view openclaw versions --json";
    public static final int VERSION_LIST_LIMIT = 20;

    public interface VersionListCallback {
        void onResult(List<String> versions, String errorMessage);
    }

    private OpenclawVersionUtils() {}

    /**
     * Parse npm JSON output (or line-based fallback) into a sorted list of stable versions.
     */
    public static List<String> parseVersions(String output) {
        List<String> versions = new ArrayList<>();
        if (TextUtils.isEmpty(output)) {
            return versions;
        }

        String trimmed = output.trim();
        try {
            if (trimmed.startsWith("[")) {
                JSONArray json = new JSONArray(trimmed);
                for (int i = 0; i < json.length(); i++) {
                    String token = json.optString(i, null);
                    String normalized = normalizeForSort(token);
                    if (isStableVersion(normalized)) {
                        versions.add(normalized);
                    }
                }
            }
        } catch (Exception ignored) {
        }

        if (!versions.isEmpty()) {
            return sortAndLimit(versions);
        }

        String[] lines = trimmed.split("\\r?\\n");
        for (String line : lines) {
            String normalized = normalizeForSort(line);
            if (isStableVersion(normalized)) {
                versions.add(normalized);
            }
        }
        return sortAndLimit(versions);
    }

    /**
     * Build a fallback list with "latest" and the current version.
     */
    public static List<String> buildFallback(String currentVersion) {
        List<String> fallback = new ArrayList<>();
        fallback.add("latest");
        String current = normalizeForSort(currentVersion);
        if (!TextUtils.isEmpty(current)) {
            fallback.add(current);
        }
        return sortAndLimit(fallback);
    }

    /**
     * Filter and normalize a version list, keeping only "latest" and stable versions.
     */
    public static List<String> normalizeVersionList(List<String> versions) {
        if (versions == null || versions.isEmpty()) {
            return new ArrayList<>();
        }

        List<String> normalized = new ArrayList<>();
        for (String version : versions) {
            String normalizedVersion = normalizeForSort(version);
            if (!TextUtils.isEmpty(normalizedVersion)
                && (TextUtils.equals("latest", normalizedVersion) || isStableVersion(normalizedVersion))) {
                normalized.add(normalizedVersion);
            }
        }
        return sortAndLimit(normalized);
    }

    /**
     * Returns "openclaw@version" format for installation.
     */
    public static String normalizeInstallVersion(String version) {
        String normalized = normalizeForSort(version);
        if (TextUtils.isEmpty(normalized)) {
            return null;
        }
        if (TextUtils.equals("latest", normalized)) {
            return VERSION_PREFIX + "latest";
        }
        return VERSION_PREFIX + normalized;
    }

    /**
     * Strip "openclaw@", "v" prefixes and quotes for bare version comparison.
     */
    public static String normalizeForSort(String version) {
        if (TextUtils.isEmpty(version)) {
            return null;
        }
        String v = version.trim().replace("\"", "").replace("'", "").trim();
        if (v.startsWith(VERSION_PREFIX)) {
            v = v.substring(VERSION_PREFIX.length());
        }
        v = v.trim();
        if (v.startsWith("v")) {
            v = v.substring(1).trim();
        }
        if (TextUtils.isEmpty(v)) {
            return null;
        }
        return v;
    }

    /**
     * Returns true if the version string is a stable semver (no pre-release suffix).
     */
    public static boolean isStableVersion(String version) {
        if (TextUtils.isEmpty(version)) {
            return false;
        }
        if (TextUtils.equals("latest", version)) {
            return false;
        }
        if (version.contains("-") || version.contains("+")) {
            return false;
        }
        try {
            OpenClawUpdateChecker.parseSemver(version);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Deduplicate, sort descending by semver, and limit to VERSION_LIST_LIMIT.
     */
    public static List<String> sortAndLimit(List<String> versions) {
        List<String> unique = new ArrayList<>();
        for (String version : versions) {
            String normalized = normalizeForSort(version);
            if (!TextUtils.isEmpty(normalized) && !unique.contains(normalized)) {
                unique.add(normalized);
            }
        }

        Collections.sort(unique, OpenclawVersionUtils::compareDesc);
        if (unique.size() > VERSION_LIST_LIMIT) {
            unique = new ArrayList<>(unique.subList(0, VERSION_LIST_LIMIT));
        }
        return unique;
    }

    /**
     * Compare two version strings in descending order. "latest" sorts first.
     */
    public static int compareDesc(String a, String b) {
        if (TextUtils.equals(a, b)) {
            return 0;
        }
        if (TextUtils.equals("latest", a)) {
            return -1;
        }
        if (TextUtils.equals("latest", b)) {
            return 1;
        }
        try {
            int[] av = OpenClawUpdateChecker.parseSemver(a);
            int[] bv = OpenClawUpdateChecker.parseSemver(b);
            for (int i = 0; i < 3; i++) {
                if (av[i] != bv[i]) {
                    return Integer.compare(bv[i], av[i]);
                }
            }
            return 0;
        } catch (Exception ignored) {
            return b.compareToIgnoreCase(a);
        }
    }
}
