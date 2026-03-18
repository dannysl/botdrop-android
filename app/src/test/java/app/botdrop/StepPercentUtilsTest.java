package app.botdrop;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class StepPercentUtilsTest {

    @Test
    public void extractPercentReturnsEmbeddedValue() {
        assertEquals(68, StepPercentUtils.extractPercent("Installing update... 68%", 0));
    }

    @Test
    public void extractPercentFallsBackWhenMissing() {
        assertEquals(25, StepPercentUtils.extractPercent("Installing update...", 25));
    }

    @Test
    public void extractPercentClampsOutOfRangeValues() {
        assertEquals(100, StepPercentUtils.extractPercent("Progress 120%", 0));
        assertEquals(0, StepPercentUtils.extractPercent(null, -5));
    }

    @Test
    public void formatPercentClampsAndFormats() {
        assertEquals("100%", StepPercentUtils.formatPercent(150));
        assertEquals("0%", StepPercentUtils.formatPercent(-1));
    }

    @Test
    public void stripTrailingPercentTextRemovesSuffixOnly() {
        assertEquals("Installing OpenClaw", StepPercentUtils.stripTrailingPercentText("Installing OpenClaw 68%"));
        assertEquals("Installing OpenClaw", StepPercentUtils.stripTrailingPercentText("Installing OpenClaw"));
    }
}
