package app.botdrop;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class BundledOpenclawUtilsTest {

    @Test
    public void testParseManifest_returnsExpectedFields() {
        String manifest =
            "version=2026.3.13\n" +
            "installSpec=openclaw@2026.3.13\n" +
            "runtimeArchive=openclaw-runtime.tar\n" +
            "qqbotDir=qqbot\n";

        BundledOpenclawUtils.Manifest parsed = BundledOpenclawUtils.parseManifest(manifest);

        assertNotNull(parsed);
        assertEquals("2026.3.13", parsed.version);
        assertEquals("openclaw@2026.3.13", parsed.installSpec);
        assertEquals("openclaw-runtime.tar", parsed.runtimeArchive);
        assertEquals("qqbot", parsed.qqbotDir);
    }

    @Test
    public void testResolvePreferredInstallSpec_prefersBundledVersionForLatest() {
        BundledOpenclawUtils.Manifest manifest = new BundledOpenclawUtils.Manifest(
            "2026.3.13",
            "openclaw@2026.3.13",
            "openclaw-runtime.tar",
            "qqbot"
        );

        assertEquals(
            "openclaw@2026.3.13",
            BundledOpenclawUtils.resolvePreferredInstallSpec("openclaw@latest", manifest)
        );
        assertEquals(
            "openclaw@2026.3.13",
            BundledOpenclawUtils.resolvePreferredInstallSpec("latest", manifest)
        );
    }

    @Test
    public void testResolvePreferredInstallSpec_keepsExplicitVersion() {
        BundledOpenclawUtils.Manifest manifest = new BundledOpenclawUtils.Manifest(
            "2026.3.13",
            "openclaw@2026.3.13",
            "openclaw-runtime.tar",
            "qqbot"
        );

        assertEquals(
            "openclaw@2026.2.6",
            BundledOpenclawUtils.resolvePreferredInstallSpec("openclaw@2026.2.6", manifest)
        );
    }

    @Test
    public void testShouldDisableVersionManagement_whenBundleManifestPresent() {
        BundledOpenclawUtils.Manifest manifest = new BundledOpenclawUtils.Manifest(
            "2026.3.13",
            "openclaw@2026.3.13",
            "openclaw-runtime.tar",
            "qqbot"
        );

        assertTrue(BundledOpenclawUtils.shouldDisableVersionManagement(manifest));
    }

    @Test
    public void testShouldDisableVersionManagement_withoutBundleManifest() {
        assertFalse(BundledOpenclawUtils.shouldDisableVersionManagement(null));
    }

    @Test
    public void testParseManifest_missingVersionReturnsNull() {
        String manifest =
            "installSpec=openclaw@2026.3.13\n" +
            "runtimeArchive=openclaw-runtime.tar\n";

        assertNull(BundledOpenclawUtils.parseManifest(manifest));
    }

    @Test
    public void testQqbotSourceDir_pointsToOfflineBundleRoot() {
        assertEquals(
            "/data/data/app.botdrop/files/usr/share/botdrop/offline-openclaw/qqbot",
            BundledOpenclawUtils.STAGED_QQBOT_PLUGIN_SOURCE_DIR
        );
    }

    @Test
    public void testBuildOfflineQqbotInstallCommand_usesOfflineScript() {
        assertEquals(
            "bash '/data/data/app.botdrop/files/usr/share/botdrop/install-qqbot-offline.sh'",
            BundledOpenclawUtils.buildOfflineQqbotInstallCommand()
        );
    }

    @Test
    public void testBuildOfflineQqbotInstallScriptBody_copiesBundledPluginWithoutNpm() {
        String script = BundledOpenclawUtils.buildOfflineQqbotInstallScriptBody();

        assertTrue(script.contains("QQBOT_SOURCE=\"/data/data/app.botdrop/files/usr/share/botdrop/offline-openclaw/qqbot\""));
        assertTrue(script.contains("QQBOT_TARGET=\"/data/data/app.botdrop/files/home/.openclaw/extensions/qqbot\""));
        assertTrue(script.contains("CONFIG_PATH=\"/data/data/app.botdrop/files/home/.openclaw/openclaw.json\""));
        assertTrue(script.contains("cp -R \"$QQBOT_SOURCE/.\" \"$QQBOT_TARGET/\""));
        assertTrue(script.contains("config.plugins.entries.qqbot"));
        assertTrue(script.contains("QQBOT_OFFLINE_INSTALL_COMPLETE"));
        assertFalse(script.contains("npm install"));
        assertFalse(script.contains("openclaw plugins install"));
    }
}
