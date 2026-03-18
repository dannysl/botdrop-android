package app.botdrop;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class StepPercentUtils {

    private static final Pattern PERCENT_PATTERN = Pattern.compile("(\\d{1,3})%");
    private static final Pattern TRAILING_PERCENT_TEXT_PATTERN = Pattern.compile("\\s+\\d{1,3}%\\s*$");

    private StepPercentUtils() {}

    public static int clampPercent(int percent) {
        return Math.max(0, Math.min(100, percent));
    }

    public static int extractPercent(String message, int fallbackPercent) {
        if (message == null) {
            return clampPercent(fallbackPercent);
        }

        Matcher matcher = PERCENT_PATTERN.matcher(message);
        if (matcher.find()) {
            try {
                return clampPercent(Integer.parseInt(matcher.group(1)));
            } catch (NumberFormatException ignored) {
                // Fall through to the provided fallback.
            }
        }

        return clampPercent(fallbackPercent);
    }

    public static String formatPercent(int percent) {
        return clampPercent(percent) + "%";
    }

    public static String stripTrailingPercentText(String text) {
        if (text == null) {
            return null;
        }
        return TRAILING_PERCENT_TEXT_PATTERN.matcher(text).replaceFirst("");
    }
}
