package app.botdrop;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NpmInstallProgressParserTest {

    @Test
    public void resolvePercentMapsIdealTreeStages() {
        assertEquals(5, NpmInstallProgressParser.resolvePercent("npm timing idealTree:init Completed in 4ms", 0));
        assertEquals(35, NpmInstallProgressParser.resolvePercent("npm timing idealTree:buildDeps Completed in 299ms", 0));
        assertEquals(40, NpmInstallProgressParser.resolvePercent("npm timing idealTree Completed in 305ms", 0));
    }

    @Test
    public void resolvePercentMapsReifyAndBuildStages() {
        assertEquals(50, NpmInstallProgressParser.resolvePercent("npm timing reify:loadTrees Completed in 305ms", 0));
        assertEquals(78, NpmInstallProgressParser.resolvePercent("npm timing reify:unpack Completed in 4ms", 0));
        assertEquals(88, NpmInstallProgressParser.resolvePercent("npm timing reify:build Completed in 1ms", 0));
    }

    @Test
    public void resolvePercentMapsCompletionLines() {
        assertEquals(99, NpmInstallProgressParser.resolvePercent("added 1 package, and audited 2 packages in 581ms", 0));
        assertEquals(100, NpmInstallProgressParser.resolvePercent("found 0 vulnerabilities", 99));
    }

    @Test
    public void resolvePercentKeepsCurrentForUnknownLines() {
        assertEquals(42, NpmInstallProgressParser.resolvePercent("some unrelated line", 42));
    }
}
