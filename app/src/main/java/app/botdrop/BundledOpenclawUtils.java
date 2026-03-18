package app.botdrop;

import android.content.Context;
import android.text.TextUtils;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.termux.shared.termux.TermuxConstants;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

public final class BundledOpenclawUtils {

    public static final String ASSET_ROOT = "offline-openclaw";
    public static final String MANIFEST_ASSET_PATH = ASSET_ROOT + "/manifest.properties";
    public static final String DEFAULT_RUNTIME_ARCHIVE_NAME = "openclaw-runtime.tar";
    public static final String DEFAULT_QQBOT_DIR_NAME = "qqbot";
    public static final String STAGED_ROOT = TermuxConstants.TERMUX_PREFIX_DIR_PATH + "/share/botdrop/offline-openclaw";
    public static final String STAGED_RUNTIME_ROOT = TermuxConstants.TERMUX_PREFIX_DIR_PATH + "/share/botdrop/openclaw-runtime";
    public static final String STAGED_CURRENT_RUNTIME_LINK = STAGED_RUNTIME_ROOT + "/current";
    public static final String GLOBAL_NODE_MODULES_ROOT =
        TermuxConstants.TERMUX_PREFIX_DIR_PATH + "/lib/node_modules";
    public static final String STAGED_QQBOT_PLUGIN_SOURCE_DIR = STAGED_ROOT + "/" + DEFAULT_QQBOT_DIR_NAME;
    public static final String STAGED_QQBOT_PLUGIN_DIR = TermuxConstants.TERMUX_HOME_DIR_PATH + "/.openclaw/extensions/qqbot";
    public static final String OFFLINE_QQBOT_INSTALL_SCRIPT_PATH =
        TermuxConstants.TERMUX_PREFIX_DIR_PATH + "/share/botdrop/install-qqbot-offline.sh";

    private BundledOpenclawUtils() {
    }

    @Nullable
    public static Manifest loadManifest(@NonNull Context context) {
        try (InputStream input = context.getAssets().open(MANIFEST_ASSET_PATH)) {
            return parseManifest(readFully(input));
        } catch (IOException e) {
            return null;
        }
    }

    @Nullable
    public static Manifest parseManifest(@Nullable String rawManifest) {
        if (TextUtils.isEmpty(rawManifest)) {
            return null;
        }

        Properties properties = new Properties();
        try {
            properties.load(new StringReader(rawManifest));
        } catch (IOException e) {
            return null;
        }

        String version = trimToNull(properties.getProperty("version"));
        String installSpec = trimToNull(properties.getProperty("installSpec"));
        String runtimeArchive = trimToNull(properties.getProperty("runtimeArchive"));
        String qqbotDir = trimToNull(properties.getProperty("qqbotDir"));

        if (version == null || installSpec == null || runtimeArchive == null) {
            return null;
        }

        return new Manifest(
            version,
            installSpec,
            runtimeArchive,
            qqbotDir != null ? qqbotDir : DEFAULT_QQBOT_DIR_NAME
        );
    }

    @Nullable
    public static String resolvePreferredInstallSpec(
        @Nullable String requestedInstallSpec,
        @Nullable Manifest manifest
    ) {
        String normalizedRequested = OpenclawVersionUtils.normalizeInstallVersion(requestedInstallSpec);
        if (manifest == null) {
            return normalizedRequested;
        }

        if (normalizedRequested == null || "openclaw@latest".equals(normalizedRequested)) {
            return manifest.installSpec;
        }

        return normalizedRequested;
    }

    public static boolean isBundledVersionRequested(
        @Nullable String requestedInstallSpec,
        @Nullable Manifest manifest
    ) {
        if (manifest == null || TextUtils.isEmpty(manifest.installSpec)) {
            return false;
        }
        String resolved = resolvePreferredInstallSpec(requestedInstallSpec, manifest);
        return manifest.installSpec.equals(resolved);
    }

    public static boolean shouldDisableUpdateManagement(@Nullable Manifest manifest) {
        return false;
    }

    public static boolean shouldDisableUpdateManagement(@NonNull Context context) {
        return shouldDisableUpdateManagement(loadManifest(context));
    }

    public static boolean shouldDisableVersionManagement(@Nullable Manifest manifest) {
        return false;
    }

    @NonNull
    public static String buildOfflineQqbotInstallCommand() {
        return "bash '" + OFFLINE_QQBOT_INSTALL_SCRIPT_PATH + "'";
    }

    @NonNull
    public static String buildOfflineQqbotInstallScriptBody() {
        return "#!" + TermuxConstants.TERMUX_BIN_PREFIX_DIR_PATH + "/bash\n"
            + "QQBOT_SOURCE=\"" + STAGED_QQBOT_PLUGIN_SOURCE_DIR + "\"\n"
            + "QQBOT_TARGET=\"" + STAGED_QQBOT_PLUGIN_DIR + "\"\n"
            + "CONFIG_PATH=\"" + TermuxConstants.TERMUX_HOME_DIR_PATH + "/.openclaw/openclaw.json\"\n"
            + "NODE_BIN=\"" + TermuxConstants.TERMUX_BIN_PREFIX_DIR_PATH + "/node\"\n"
            + "if [ ! -f \"$QQBOT_SOURCE/openclaw.plugin.json\" ]; then\n"
            + "  echo \"BOTDROP_ERROR:Bundled QQ Bot plugin source is missing\"\n"
            + "  exit 1\n"
            + "fi\n"
            + "rm -rf \"$QQBOT_TARGET\"\n"
            + "mkdir -p \"$QQBOT_TARGET\"\n"
            + "cp -R \"$QQBOT_SOURCE/.\" \"$QQBOT_TARGET/\"\n"
            + "if [ ! -f \"$QQBOT_TARGET/openclaw.plugin.json\" ]; then\n"
            + "  echo \"BOTDROP_ERROR:Bundled QQ Bot plugin copy failed\"\n"
            + "  exit 1\n"
            + "fi\n"
            + "if [ -f \"$CONFIG_PATH\" ] && [ -x \"$NODE_BIN\" ]; then\n"
            + "  \"$NODE_BIN\" -e 'const fs=require(\"fs\");"
            + "const path=process.argv[1];"
            + "const config=JSON.parse(fs.readFileSync(path,\"utf8\"));"
            + "config.plugins=config.plugins||{};"
            + "config.plugins.entries=config.plugins.entries||{};"
            + "const entry=config.plugins.entries.qqbot;"
            + "config.plugins.entries.qqbot=(entry&&typeof entry===\"object\")"
            + "?Object.assign({},entry,{enabled:true}):{enabled:true};"
            + "fs.writeFileSync(path,JSON.stringify(config,null,2)+\"\\\\n\");'"
            + " \"$CONFIG_PATH\" || {\n"
            + "    echo \"BOTDROP_ERROR:Failed to register QQ Bot plugin in openclaw.json\"\n"
            + "    exit 1\n"
            + "  }\n"
            + "fi\n"
            + "echo \"QQBOT_OFFLINE_INSTALL_COMPLETE\"\n";
    }

    @Nullable
    private static String trimToNull(@Nullable String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    @NonNull
    private static String readFully(@NonNull InputStream input) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(input, StandardCharsets.UTF_8)
        )) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    public static final class Manifest {
        public final String version;
        public final String installSpec;
        public final String runtimeArchive;
        public final String qqbotDir;

        public Manifest(
            @NonNull String version,
            @NonNull String installSpec,
            @NonNull String runtimeArchive,
            @NonNull String qqbotDir
        ) {
            this.version = version;
            this.installSpec = installSpec;
            this.runtimeArchive = runtimeArchive;
            this.qqbotDir = qqbotDir;
        }
    }
}
