package com.termux.app;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.lang.reflect.Method;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class TermuxInstallerTest {

    @Test
    public void testBuildOpenclawInstallScriptBody_doesNotInstallQqbotPlugin() throws Exception {
        Method method = TermuxInstaller.class.getDeclaredMethod(
            "buildOpenclawInstallScriptBody",
            String.class,
            int.class
        );
        method.setAccessible(true);

        String script = (String) method.invoke(null, "openclaw@latest", 2048);

        assertTrue(script.contains("BOTDROP_STEP:2:START:Installing OpenClaw"));
        assertTrue(script.contains("ln -sfn \"$TARGET_DIR\" \"$OFFLINE_CURRENT_LINK\""));
        assertTrue(script.contains("GLOBAL_NODE_MODULES_ROOT=\"/data/data/app.botdrop/files/usr/lib/node_modules\""));
        assertTrue(script.contains("GLOBAL_OPENCLAW_LINK=\"/data/data/app.botdrop/files/usr/lib/node_modules/openclaw\""));
        assertTrue(script.contains("mkdir -p \"$GLOBAL_NODE_MODULES_ROOT\""));
        assertTrue(script.contains("ln -sfn \"$OFFLINE_CURRENT_LINK/node_modules/openclaw\" \"$GLOBAL_OPENCLAW_LINK\""));
        assertFalse(script.contains("OFFLINE_QQBOT_TARGET"));
        assertFalse(script.contains("BUNDLED_QQBOT_DIR"));
        assertFalse(script.contains("QQBOT_SOURCE="));
        assertFalse(script.contains("cp -R \"$QQBOT_SOURCE/.\" \"$OFFLINE_QQBOT_TARGET/\""));
    }
}
