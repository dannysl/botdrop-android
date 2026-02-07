package app.botdrop;

import com.termux.shared.logger.Logger;
import com.termux.shared.termux.TermuxConstants;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

/**
 * Helper class for reading and writing OpenClaw configuration.
 * Handles openclaw.json at ~/.openclaw/openclaw.json
 *
 * Thread-safe: All file operations are synchronized.
 */
public class BotDropConfig {

    private static final String LOG_TAG = "BotDropConfig";
    private static final String CONFIG_DIR = TermuxConstants.TERMUX_HOME_DIR_PATH + "/.openclaw";
    private static final String CONFIG_FILE = CONFIG_DIR + "/openclaw.json";
    
    // Lock for thread-safe file operations
    private static final Object CONFIG_LOCK = new Object();
    
    /**
     * Read the current configuration
     * @return JSONObject of config, or empty config if not found
     */
    public static JSONObject readConfig() {
        synchronized (CONFIG_LOCK) {
            File configFile = new File(CONFIG_FILE);
            
            if (!configFile.exists()) {
                Logger.logDebug(LOG_TAG, "Config file does not exist: " + CONFIG_FILE);
                return new JSONObject();
            }
            
            try (FileReader reader = new FileReader(configFile)) {
                StringBuilder sb = new StringBuilder();
                char[] buffer = new char[1024];
                int read;
                while ((read = reader.read(buffer)) != -1) {
                    sb.append(buffer, 0, read);
                }
                
                JSONObject config = new JSONObject(sb.toString());
                Logger.logDebug(LOG_TAG, "Config loaded successfully");
                return config;
                
            } catch (IOException | JSONException e) {
                Logger.logError(LOG_TAG, "Failed to read config: " + e.getMessage());
                return new JSONObject();
            }
        }
    }
    
    /**
     * Write configuration to file
     * @param config JSONObject to write
     * @return true if successful
     */
    public static boolean writeConfig(JSONObject config) {
        synchronized (CONFIG_LOCK) {
            // Create parent directories if needed
            File configDir = new File(CONFIG_DIR);
            if (!configDir.exists()) {
                if (!configDir.mkdirs()) {
                    Logger.logError(LOG_TAG, "Failed to create config directory: " + CONFIG_DIR);
                    return false;
                }
            }
            
            File configFile = new File(CONFIG_FILE);
            
            try (FileWriter writer = new FileWriter(configFile)) {
                // Pretty print JSON with 2-space indent
                String jsonString = config.toString(2);
                writer.write(jsonString);
                
                // Set file permissions to owner-only (prevent other apps from reading API keys)
                configFile.setReadable(false, false);
                configFile.setReadable(true, true);
                configFile.setWritable(false, false);
                configFile.setWritable(true, true);
                
                Logger.logInfo(LOG_TAG, "Config written successfully");
                return true;
                
            } catch (IOException | JSONException e) {
                Logger.logError(LOG_TAG, "Failed to write config: " + e.getMessage());
                return false;
            }
        }
    }
    
    /**
     * Set the default AI provider and model
     * @param provider Provider ID (e.g., "anthropic")
     * @param model Model name (e.g., "claude-sonnet-4-5")
     * @return true if successful
     */
    public static boolean setProvider(String provider, String model) {
        try {
            JSONObject config = readConfig();
            
            // Create agents.defaults structure if not exists
            if (!config.has("agents")) {
                config.put("agents", new JSONObject());
            }
            
            JSONObject agents = config.getJSONObject("agents");
            if (!agents.has("defaults")) {
                agents.put("defaults", new JSONObject());
            }
            
            JSONObject defaults = agents.getJSONObject("defaults");

            // Set model as object: { primary: "provider/model" }
            JSONObject modelObj = new JSONObject();
            modelObj.put("primary", provider + "/" + model);
            defaults.put("model", modelObj);
            
            // Set workspace if not already set
            if (!defaults.has("workspace")) {
                defaults.put("workspace", "~/botdrop");
            }

            // Ensure gateway config for Android
            if (!config.has("gateway")) {
                config.put("gateway", new JSONObject());
            }
            JSONObject gateway = config.getJSONObject("gateway");
            if (!gateway.has("mode")) {
                gateway.put("mode", "local");
            }
            // Gateway requires auth token
            if (!gateway.has("auth")) {
                JSONObject auth = new JSONObject();
                auth.put("token", "botdrop-local-token");
                gateway.put("auth", auth);
            }

            return writeConfig(config);
            
        } catch (JSONException e) {
            Logger.logError(LOG_TAG, "Failed to set provider: " + e.getMessage());
            return false;
        }
    }
    
    private static final String AUTH_PROFILES_DIR = CONFIG_DIR + "/agents/main/agent";
    private static final String AUTH_PROFILES_FILE = AUTH_PROFILES_DIR + "/auth-profiles.json";

    /**
     * Set the API key for a provider.
     * Writes to ~/.openclaw/agents/main/agent/auth-profiles.json
     */
    public static boolean setApiKey(String provider, String credential) {
        synchronized (CONFIG_LOCK) {
            try {
                File dir = new File(AUTH_PROFILES_DIR);
                if (!dir.exists()) dir.mkdirs();

                // Read existing auth profiles or create new
                JSONObject authProfiles;
                File authFile = new File(AUTH_PROFILES_FILE);
                if (authFile.exists()) {
                    try (FileReader reader = new FileReader(authFile)) {
                        StringBuilder sb = new StringBuilder();
                        char[] buffer = new char[1024];
                        int read;
                        while ((read = reader.read(buffer)) != -1) {
                            sb.append(buffer, 0, read);
                        }
                        authProfiles = new JSONObject(sb.toString());
                    }
                } else {
                    authProfiles = new JSONObject();
                    authProfiles.put("version", 1);
                    authProfiles.put("profiles", new JSONObject());
                }

                // Add/update profile: "provider:default" -> { type, provider, key }
                JSONObject profiles = authProfiles.getJSONObject("profiles");
                JSONObject profile = new JSONObject();
                profile.put("type", "api_key");
                profile.put("provider", provider);
                profile.put("key", credential);
                profiles.put(provider + ":default", profile);

                // Write
                try (FileWriter writer = new FileWriter(authFile)) {
                    writer.write(authProfiles.toString(2));
                }
                authFile.setReadable(false, false);
                authFile.setReadable(true, true);
                authFile.setWritable(false, false);
                authFile.setWritable(true, true);

                Logger.logInfo(LOG_TAG, "Auth profile written for provider: " + provider);
                return true;

            } catch (IOException | JSONException e) {
                Logger.logError(LOG_TAG, "Failed to write auth profile: " + e.getMessage());
                return false;
            }
        }
    }

    /**
     * Check if config file exists and has basic structure
     * @return true if configured
     */
    public static boolean isConfigured() {
        File configFile = new File(CONFIG_FILE);
        if (!configFile.exists()) {
            return false;
        }
        
        try {
            JSONObject config = readConfig();
            // Check if it has agents.defaults.model.primary set
            if (config.has("agents")) {
                JSONObject agents = config.getJSONObject("agents");
                if (agents.has("defaults")) {
                    JSONObject defaults = agents.getJSONObject("defaults");
                    if (defaults.has("model")) {
                        Object model = defaults.get("model");
                        if (model instanceof JSONObject) {
                            return ((JSONObject) model).has("primary");
                        }
                    }
                }
            }
            return false;
            
        } catch (JSONException e) {
            Logger.logError(LOG_TAG, "Failed to check config: " + e.getMessage());
            return false;
        }
    }
}
