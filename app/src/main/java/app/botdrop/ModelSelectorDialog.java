package app.botdrop;

import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.termux.R;
import com.termux.shared.logger.Logger;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Dialog for selecting a model with search capability.
 * Uses cached OpenClaw model list when possible and fallbacks to static catalog.
 */
public class ModelSelectorDialog extends Dialog {

    private static final String LOG_TAG = "ModelSelectorDialog";
    private static final String PREFS_NAME = "openclaw_model_cache_v1";
    private static final String KEY_CACHE_PREFS_NAME = "openclaw_model_key_cache_v1";
    private static final String STATIC_MODELS_ASSET = "openclaw-models-all.keys";
    private static final String CACHE_KEY_PREFIX = "models_by_version_";
    private static final String KEY_CACHE_PREFIX = "recent_keys_by_provider_";
    private static final String KEY_CACHE_PREFIX_LEGACY = "recent_keys_by_model_";
    private static final int MAX_CACHED_KEYS_PER_MODEL = 8;

    // Cached in-memory for the currently active OpenClaw version.
    private static List<ModelInfo> sCachedAllModels;
    private static String sCachedVersion;

    private final BotDropService mService;
    private final boolean mPromptForApiKey;
    private ModelSelectedCallback mCallback;

    private TextView mTitleText;
    private TextView mStepHint;
    private ImageButton mBackButton;
    private EditText mSearchBox;
    private RecyclerView mModelList;
    private TextView mStatusText;
    private Button mRetryButton;

    private ModelListAdapter mAdapter;
    private List<ModelInfo> mAllModels = new ArrayList<>();
    private List<ModelInfo> mCurrentItems = new ArrayList<>();
    private boolean mSelectingProvider = true;
    private String mCurrentProvider;

    public interface ModelSelectedCallback {
        void onModelSelected(String provider, String model, String apiKey);
    }

    public ModelSelectorDialog(@NonNull Context context, BotDropService service) {
        this(context, service, false);
    }

    public ModelSelectorDialog(@NonNull Context context, BotDropService service, boolean promptForApiKey) {
        super(context);
        this.mService = service;
        this.mPromptForApiKey = promptForApiKey;
    }

    public void show(ModelSelectedCallback callback) {
        this.mCallback = callback;
        super.show();
    }

    static void cacheProviderApiKey(@NonNull Context context, String provider, String key) {
        if (TextUtils.isEmpty(provider) || TextUtils.isEmpty(key) || context == null) {
            return;
        }

        try {
            SharedPreferences prefs = context.getSharedPreferences(KEY_CACHE_PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(keyCacheKey(provider), null);
            List<String> existing = new ArrayList<>();

            if (!TextUtils.isEmpty(raw)) {
                JSONArray list = new JSONArray(raw);
                for (int i = 0; i < list.length(); i++) {
                    String item = list.optString(i, "").trim();
                    if (!TextUtils.isEmpty(item) && !existing.contains(item)) {
                        existing.add(item);
                    }
                }
            }

            String normalized = key.trim();
            if (TextUtils.isEmpty(normalized)) return;

            existing.remove(normalized);
            existing.add(0, normalized);
            while (existing.size() > MAX_CACHED_KEYS_PER_MODEL) {
                existing.remove(existing.size() - 1);
            }

            JSONArray merged = new JSONArray();
            for (String item : existing) {
                if (!TextUtils.isEmpty(item)) {
                    merged.put(item);
                }
            }
            prefs.edit().putString(keyCacheKey(provider), merged.toString()).apply();
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to cache API key: " + e.getMessage());
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setContentView(R.layout.dialog_model_selector);

        Window window = getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            window.setBackgroundDrawableResource(android.R.color.transparent);
        }

        mTitleText = findViewById(R.id.model_title);
        mStepHint = findViewById(R.id.model_step_hint);
        mBackButton = findViewById(R.id.model_back_button);
        mSearchBox = findViewById(R.id.model_search);
        mModelList = findViewById(R.id.model_list);
        mStatusText = findViewById(R.id.model_status);
        mRetryButton = findViewById(R.id.model_retry);
        ImageButton closeButton = findViewById(R.id.model_close_button);

        closeButton.setOnClickListener(v -> {
            if (mCallback != null) {
                mCallback.onModelSelected(null, null, null);
            }
            dismiss();
        });

        mAdapter = new ModelListAdapter(model -> {
            if (mCallback == null) {
                return;
            }

            if (mSelectingProvider) {
                if (model != null && !TextUtils.isEmpty(model.provider) && TextUtils.isEmpty(model.model)) {
                    showModelSelection(model.provider);
                }
                return;
            }

            if (model != null && !TextUtils.isEmpty(model.provider) && !TextUtils.isEmpty(model.model)) {
                confirmSelection(model.provider, model.model);
            }
        });

        mModelList.setLayoutManager(new LinearLayoutManager(getContext()));
        mModelList.setAdapter(mAdapter);

        mSearchBox.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                filterModels(s.toString());
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });

        mRetryButton.setOnClickListener(v -> loadModels(true));
        mBackButton.setOnClickListener(v -> showProviderSelection());

        loadModels();
    }

    private void loadModels() {
        loadModels(false);
    }

    private void loadModels(boolean forceRefresh) {
        showLoading();

        String openclawVersion = BotDropService.getOpenclawVersion();
        if (TextUtils.isEmpty(openclawVersion)) {
            openclawVersion = "unknown";
        }
        String normalizedVersion = normalizeCacheKey(openclawVersion);
        final String versionForLog = openclawVersion;

        if (!forceRefresh && TextUtils.equals(normalizedVersion, sCachedVersion) && sCachedAllModels != null && !sCachedAllModels.isEmpty()) {
            showModelsFromCache(sCachedAllModels, true);
            return;
        }

        if (!forceRefresh) {
            List<ModelInfo> cached = loadCachedModels(normalizedVersion);
            if (!cached.isEmpty()) {
                sCachedVersion = normalizedVersion;
                sCachedAllModels = cached;
                showModelsFromCache(cached, true);
                return;
            }
        }

        if (mService == null) {
            List<ModelInfo> models = readModelsFromAsset();
            if (!models.isEmpty()) {
                showModelsFromList("Fallback to bundled catalog", models);
                return;
            }
            showError("Failed to load model catalog.");
            return;
        }

        mService.executeCommand("openclaw models list --all --plain", result -> {
            if (!result.success) {
                Logger.logError(LOG_TAG, "Failed to load models from OpenClaw: exit " + result.exitCode);
                List<ModelInfo> cached = loadCachedModels(normalizedVersion);
                if (!cached.isEmpty()) {
                    sCachedVersion = normalizedVersion;
                    sCachedAllModels = cached;
                    showModelsFromCache(cached, true);
                    return;
                }
                List<ModelInfo> fallback = readModelsFromAsset();
                if (!fallback.isEmpty()) {
                    showModelsFromList("Failed to load from OpenClaw; using bundled catalog", fallback);
                    return;
                }
                showError("Failed to load model catalog.");
                return;
            }

            List<ModelInfo> models = parseModelList(result.stdout);
            if (models.isEmpty()) {
                Logger.logError(LOG_TAG, "Model list command returned empty output");
                List<ModelInfo> fallback = readModelsFromAsset();
                if (!fallback.isEmpty()) {
                    showModelsFromList("Failed to parse command output; using bundled catalog", fallback);
                    return;
                }
                showError("No model list available.");
                return;
            }

            Collections.sort(models,
                (a, b) -> {
                    if (a == null || b == null || a.fullName == null || b.fullName == null) return 0;
                    return b.fullName.compareToIgnoreCase(a.fullName);
                }
            );
            cacheModels(normalizedVersion, models);
            sCachedVersion = normalizedVersion;
            sCachedAllModels = models;
            Logger.logInfo(LOG_TAG, "Loaded " + models.size() + " models for OpenClaw v" + versionForLog);
            showModelsFromList("Loaded " + models.size() + " models from OpenClaw", models);
        });
    }

    private List<ModelInfo> parseModelList(String output) {
        List<ModelInfo> models = new ArrayList<>();
        if (TextUtils.isEmpty(output)) {
            return models;
        }

        try {
            String[] lines = output.split("\\r?\\n");
            for (String line : lines) {
                String trimmed = line == null ? "" : line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }
                if (trimmed.startsWith("#") || trimmed.startsWith("Model ")) {
                    continue;
                }

                String token = trimmed;
                if (trimmed.contains(" ")) {
                    token = trimmed.split("\\s+")[0];
                }

                if (isModelToken(token)) {
                    models.add(new ModelInfo(token));
                }
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to parse model list output: " + e.getMessage());
        }
        return models;
    }

    private void showModelsFromCache(List<ModelInfo> models, boolean fromCache) {
        mAllModels = new ArrayList<>(models);
        if (fromCache) {
            Logger.logInfo(LOG_TAG, "Using cached model list (" + models.size() + ")");
        }
        showProviderSelection();
    }

    private void showModelsFromList(String sourceMessage, List<ModelInfo> models) {
        if (models.isEmpty()) {
            showError(sourceMessage.isEmpty() ? "No model list available." : sourceMessage);
            return;
        }

        if (!TextUtils.isEmpty(sourceMessage)) {
            Logger.logInfo(LOG_TAG, sourceMessage);
        }
        mAllModels = new ArrayList<>(models);
        showProviderSelection();
    }

    private void confirmSelection(String provider, String model) {
        if (TextUtils.isEmpty(provider) || TextUtils.isEmpty(model) || mCallback == null) {
            return;
        }

        if (!mPromptForApiKey) {
            mCallback.onModelSelected(provider, model, null);
            dismiss();
            return;
        }

        showApiKeyPrompt(provider, model);
    }

    private void showApiKeyPrompt(String provider, String model) {
        if (TextUtils.isEmpty(provider) || TextUtils.isEmpty(model) || mCallback == null) {
            return;
        }

        String fullModel = provider + "/" + model;
        boolean hasExistingKey = BotDropConfig.hasApiKey(provider);
        View content = LayoutInflater.from(getContext())
            .inflate(R.layout.dialog_change_model_api_key, null);
        if (content == null) return;

        TextView selectedModelText = content.findViewById(R.id.change_model_selected_text);
        TextView noteText = content.findViewById(R.id.change_model_note);
        TextView cachedTitle = content.findViewById(R.id.change_model_cached_title);
        LinearLayout cachedKeysContainer = content.findViewById(R.id.change_model_cached_keys_container);
        EditText apiKeyInput = content.findViewById(R.id.change_model_api_key_input);
        if (selectedModelText == null || noteText == null || cachedTitle == null
            || cachedKeysContainer == null || apiKeyInput == null) {
            return;
        }

        selectedModelText.setText(fullModel);
        noteText.setText(hasExistingKey
            ? "Enter a new API key if you want to replace the current one."
            : "No API key found for provider \"" + provider + "\". Please enter one.");

        apiKeyInput.setHint(hasExistingKey ? "Leave empty to keep current key" : "Enter API key");
        apiKeyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        apiKeyInput.setTextColor(getContext().getColor(R.color.botdrop_on_background));
        apiKeyInput.setText("");

        String currentProviderKey = BotDropConfig.getApiKey(provider);
        if (!TextUtils.isEmpty(currentProviderKey)) {
            cacheApiKey(provider, currentProviderKey);
        }

        renderCachedKeys(provider, apiKeyInput, cachedKeysContainer, cachedTitle);

        android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(getContext())
            .setTitle("Change model")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save & Apply", null)
            .setView(content)
            .create();

        dialog.setOnShowListener(d -> dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String newApiKey = apiKeyInput.getText().toString().trim();
            if (!hasExistingKey && TextUtils.isEmpty(newApiKey)) {
                apiKeyInput.setError("API key is required for this provider");
                return;
            }
            if (!TextUtils.isEmpty(newApiKey)) {
                cacheApiKey(provider, newApiKey);
            }
            mCallback.onModelSelected(provider, model, newApiKey);
            dialog.dismiss();
            dismiss();
        }));
        dialog.setOnDismissListener(d -> dismiss());

        dialog.show();
    }

    private void renderCachedKeys(String provider, EditText apiKeyInput, LinearLayout container, TextView titleText) {
        if (container == null || TextUtils.isEmpty(provider) || getContext() == null) {
            return;
        }

        List<String> cachedKeys = loadCachedApiKeys(provider);
        container.removeAllViews();
        if (titleText != null) {
            titleText.setVisibility(View.GONE);
        }
        if (cachedKeys.isEmpty()) {
            return;
        }
        if (titleText != null) {
            titleText.setVisibility(View.VISIBLE);
            titleText.setText("Cached keys");
        }

        for (String key : cachedKeys) {
            if (TextUtils.isEmpty(key)) {
                continue;
            }

            LinearLayout row = new LinearLayout(getContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(
                (int) (12 * getContext().getResources().getDisplayMetrics().density),
                (int) (10 * getContext().getResources().getDisplayMetrics().density),
                (int) (12 * getContext().getResources().getDisplayMetrics().density),
                (int) (10 * getContext().getResources().getDisplayMetrics().density)
            );
            LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            rowLp.setMargins(0, 0, 0, (int) (10 * getContext().getResources().getDisplayMetrics().density));
            row.setLayoutParams(rowLp);

            TextView keyText = new TextView(getContext());
            keyText.setText(maskApiKey(key));
            keyText.setTextColor(getContext().getColor(R.color.botdrop_on_background));
            keyText.setLayoutParams(new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f
            ));
            row.addView(keyText);

            TextView useAction = new TextView(getContext());
            useAction.setText("Use");
            useAction.setTextSize(12f);
            useAction.setTextColor(getContext().getColor(R.color.botdrop_accent));
            useAction.setPadding((int) (12 * getContext().getResources().getDisplayMetrics().density),
                (int) (4 * getContext().getResources().getDisplayMetrics().density),
                (int) (12 * getContext().getResources().getDisplayMetrics().density),
                (int) (4 * getContext().getResources().getDisplayMetrics().density));
            useAction.setOnClickListener(v -> {
                apiKeyInput.setText(key);
                apiKeyInput.setSelection(key.length());
                apiKeyInput.setError(null);
            });

            ImageButton deleteAction = new ImageButton(getContext());
            deleteAction.setImageResource(android.R.drawable.ic_menu_delete);
            deleteAction.setContentDescription("Delete cached key");
            deleteAction.setColorFilter(getContext().getColor(R.color.status_disconnected));
            deleteAction.setBackgroundColor(0x00000000);
            int iconSize = (int) (22 * getContext().getResources().getDisplayMetrics().density);
            LinearLayout.LayoutParams deleteLp = new LinearLayout.LayoutParams(iconSize, iconSize);
            deleteLp.setMarginStart((int) (4 * getContext().getResources().getDisplayMetrics().density));
            deleteAction.setLayoutParams(deleteLp);
            deleteAction.setOnClickListener(v -> {
                removeCachedApiKey(provider, key);
                renderCachedKeys(provider, apiKeyInput, container, titleText);
            });
            row.addView(deleteAction);

            View spacer = new View(getContext());
            spacer.setLayoutParams(new LinearLayout.LayoutParams(
                0,
                0,
                1f
            ));
            row.addView(spacer);
            row.addView(useAction);

            LinearLayout.LayoutParams useLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            );
            useAction.setLayoutParams(useLp);

            container.addView(row);
        }
    }

    private String maskApiKey(String key) {
        if (TextUtils.isEmpty(key)) return "••••";
        String trimmed = key.trim();
        if (trimmed.length() <= 8) {
            return "••••••••";
        }
        return "•••• •••• " + trimmed.substring(trimmed.length() - 4);
    }

    private void cacheApiKey(String provider, String key) {
        if (TextUtils.isEmpty(provider) || TextUtils.isEmpty(key) || getContext() == null) {
            return;
        }

        try {
            List<String> existing = loadCachedApiKeys(provider);
            String normalized = key.trim();
            if (TextUtils.isEmpty(normalized)) return;

            existing.remove(normalized);
            existing.add(0, normalized);
            while (existing.size() > MAX_CACHED_KEYS_PER_MODEL) {
                existing.remove(existing.size() - 1);
            }

            JSONArray list = new JSONArray();
            for (String item : existing) {
                if (!TextUtils.isEmpty(item)) {
                    list.put(item);
                }
            }
            getContext().getSharedPreferences(KEY_CACHE_PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(keyCacheKey(provider), list.toString())
                .apply();
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to cache API key: " + e.getMessage());
        }
    }

    private void removeCachedApiKey(String provider, String key) {
        if (TextUtils.isEmpty(provider) || TextUtils.isEmpty(key) || getContext() == null) {
            return;
        }

        try {
            List<String> existing = loadCachedApiKeys(provider);
            if (existing.remove(key)) {
                JSONArray list = new JSONArray();
                for (String item : existing) {
                    if (!TextUtils.isEmpty(item)) {
                        list.put(item);
                    }
                }
                getContext().getSharedPreferences(KEY_CACHE_PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(keyCacheKey(provider), list.toString())
                    .apply();
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to remove cached API key: " + e.getMessage());
        }
    }

    private List<String> loadCachedApiKeys(String provider) {
        List<String> keys = new ArrayList<>();
        if (TextUtils.isEmpty(provider) || getContext() == null) {
            return keys;
        }

        try {
            SharedPreferences prefs = getContext().getSharedPreferences(KEY_CACHE_PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(keyCacheKey(provider), null);
            if (!TextUtils.isEmpty(raw)) {
                JSONArray list = new JSONArray(raw);
                for (int i = 0; i < list.length(); i++) {
                    String item = list.optString(i, "").trim();
                    if (!TextUtils.isEmpty(item) && !keys.contains(item)) {
                        keys.add(item);
                    }
                }
            }

            List<String> legacyKeys = loadLegacyCachedApiKeys(prefs, provider);
            for (String item : legacyKeys) {
                if (!TextUtils.isEmpty(item) && !keys.contains(item)) {
                    keys.add(item);
                }
            }

            if (keys.size() > MAX_CACHED_KEYS_PER_MODEL) {
                keys = new ArrayList<>(keys.subList(0, MAX_CACHED_KEYS_PER_MODEL));
            }

            if (!TextUtils.isEmpty(raw) || !legacyKeys.isEmpty()) {
                JSONArray merged = new JSONArray();
                for (String item : keys) {
                    if (!TextUtils.isEmpty(item)) {
                        merged.put(item);
                    }
                }
                SharedPreferences.Editor editor = prefs.edit().putString(keyCacheKey(provider), merged.toString());

                if (!legacyKeys.isEmpty()) {
                    cleanupLegacyCachedApiKeys(editor, provider);
                }
                editor.apply();
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to load cached API keys: " + e.getMessage());
        }

        return keys;
    }

    private List<String> loadLegacyCachedApiKeys(SharedPreferences prefs, String provider) {
        List<String> keys = new ArrayList<>();
        if (prefs == null || TextUtils.isEmpty(provider)) {
            return keys;
        }

        String normalizedProvider = normalizeCacheSegment(provider) + "_";
        String legacyPrefix = KEY_CACHE_PREFIX_LEGACY + normalizedProvider;
        try {
            for (String key : prefs.getAll().keySet()) {
                if (!key.startsWith(legacyPrefix)) {
                    continue;
                }

                Object value = prefs.getAll().get(key);
                if (!(value instanceof String)) {
                    continue;
                }

                JSONArray list = new JSONArray((String) value);
                for (int i = 0; i < list.length(); i++) {
                    String item = list.optString(i, "").trim();
                    if (!TextUtils.isEmpty(item) && !keys.contains(item)) {
                        keys.add(item);
                    }
                }
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to load legacy cached API keys: " + e.getMessage());
        }
        return keys;
    }

    private void cleanupLegacyCachedApiKeys(SharedPreferences.Editor editor, String provider) {
        if (editor == null || TextUtils.isEmpty(provider)) {
            return;
        }

        String normalizedProvider = normalizeCacheSegment(provider) + "_";
        String legacyPrefix = KEY_CACHE_PREFIX_LEGACY + normalizedProvider;
        try {
            for (String key : getContext().getSharedPreferences(KEY_CACHE_PREFS_NAME, Context.MODE_PRIVATE).getAll().keySet()) {
                if (key.startsWith(legacyPrefix)) {
                    editor.remove(key);
                }
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to cleanup legacy cached API keys: " + e.getMessage());
        }
    }

    private static String keyCacheKey(String provider) {
        return KEY_CACHE_PREFIX + normalizeCacheSegment(provider);
    }

    private static String normalizeCacheSegment(String value) {
        if (TextUtils.isEmpty(value)) {
            return "unknown";
        }
        return value.trim().replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private void showProviderSelection() {
        mSelectingProvider = true;
        mCurrentProvider = null;
        mCurrentItems = new ArrayList<>();

        List<String> providers = new ArrayList<>();
        for (ModelInfo model : mAllModels) {
            if (model != null && !TextUtils.isEmpty(model.provider) && !providers.contains(model.provider)) {
                providers.add(model.provider);
            }
        }
        Collections.sort(providers, String::compareToIgnoreCase);

        for (String provider : providers) {
            mCurrentItems.add(new ModelInfo(provider, provider, ""));
        }

        mSearchBox.setText("");
        mSearchBox.setHint("Search provider...");
        mBackButton.setVisibility(View.GONE);
        if (mStepHint != null) {
            mStepHint.setText("Step 1 of 2");
        }
        mTitleText.setText("Select Provider");

        mAdapter.updateList(mCurrentItems);
        if (mCurrentItems.isEmpty()) {
            showError("No provider available.");
            return;
        }
        showList();
    }

    private void showModelSelection(String provider) {
        if (TextUtils.isEmpty(provider)) {
            showProviderSelection();
            return;
        }

        mSelectingProvider = false;
        mCurrentProvider = provider;

        List<ModelInfo> models = new ArrayList<>();
        for (ModelInfo model : mAllModels) {
            if (model != null && TextUtils.equals(provider, model.provider)) {
                models.add(model);
            }
        }

        Collections.sort(models, Comparator.comparing((ModelInfo m) -> m.fullName == null ? "" : m.fullName, String::compareToIgnoreCase).reversed());

        mCurrentItems = new ArrayList<>(models);
        mSearchBox.setText("");
        mSearchBox.setHint("Search model...");
        mBackButton.setVisibility(View.VISIBLE);
        if (mStepHint != null) {
            mStepHint.setText("Step 2 of 2");
        }
        mTitleText.setText(provider + " models");

        mAdapter.updateList(mCurrentItems);
        if (mCurrentItems.isEmpty()) {
            showError("No models available for " + provider);
            return;
        }
        showList();
    }

    private List<ModelInfo> readModelsFromAsset() {
        List<ModelInfo> models = new ArrayList<>();

        try (InputStream is = getContext().getAssets().open(STATIC_MODELS_ASSET);
             BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String key = line.trim();
                if (isModelToken(key)) {
                    models.add(new ModelInfo(key));
                }
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to read static model catalog: " + e.getMessage());
        }

        Logger.logInfo(LOG_TAG, "Static catalog loaded: " + models.size() + " models");
        return models;
    }

    private List<ModelInfo> loadCachedModels(String version) {
        List<ModelInfo> models = new ArrayList<>();
        if (TextUtils.isEmpty(version)) {
            return models;
        }

        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(cacheKey(version), null);
            if (TextUtils.isEmpty(raw)) return models;

            JSONObject root = new JSONObject(raw);
            String cachedVersion = root.optString("version", "");
            if (!TextUtils.equals(cachedVersion, version)) return models;

            JSONArray list = root.optJSONArray("models");
            if (list == null || list.length() == 0) return models;

            for (int i = 0; i < list.length(); i++) {
                String modelName = list.optString(i, "");
                if (isModelToken(modelName)) {
                    models.add(new ModelInfo(modelName));
                }
            }
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to read cached model list: " + e.getMessage());
        }

        return models;
    }

    private void cacheModels(String version, List<ModelInfo> models) {
        if (TextUtils.isEmpty(version) || models == null || models.isEmpty()) return;

        try {
            JSONArray list = new JSONArray();
            for (ModelInfo model : models) {
                if (model != null && !TextUtils.isEmpty(model.fullName)) {
                    list.put(model.fullName);
                }
            }

            JSONObject root = new JSONObject();
            root.put("version", version);
            root.put("updated_at", System.currentTimeMillis());
            root.put("models", list);

            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(cacheKey(version), root.toString()).apply();
        } catch (Exception e) {
            Logger.logError(LOG_TAG, "Failed to cache model list: " + e.getMessage());
        }
    }

    private String cacheKey(String version) {
        return CACHE_KEY_PREFIX + normalizeCacheKey(version);
    }

    private String normalizeCacheKey(String version) {
        if (TextUtils.isEmpty(version)) {
            return "unknown";
        }
        return version.trim().replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private boolean isModelToken(String token) {
        if (token == null || token.isEmpty()) return false;
        if (!token.contains("/")) return false;
        return token.matches("[A-Za-z0-9._-]+/[A-Za-z0-9._:/-]+");
    }

    private void filterModels(String query) {
        if (query == null || query.isEmpty()) {
            mAdapter.updateList(mCurrentItems);
            return;
        }

        String lower = query.toLowerCase();
        List<ModelInfo> filtered = mCurrentItems.stream()
            .filter(m -> {
                if (mSelectingProvider) {
                    return !TextUtils.isEmpty(m.provider) && m.provider.toLowerCase().contains(lower);
                }

                return (!TextUtils.isEmpty(m.fullName) && m.fullName.toLowerCase().contains(lower))
                    || (!TextUtils.isEmpty(m.model) && m.model.toLowerCase().contains(lower));
            })
            .collect(Collectors.toList());

        mAdapter.updateList(filtered);
    }

    private void showLoading() {
        mModelList.setVisibility(View.GONE);
        mRetryButton.setVisibility(View.GONE);
        mStatusText.setVisibility(View.VISIBLE);
        mStatusText.setText("Loading models...");
    }

    private void showError(String message) {
        mModelList.setVisibility(View.GONE);
        mRetryButton.setVisibility(View.VISIBLE);
        mStatusText.setVisibility(View.VISIBLE);
        mStatusText.setText(message);
    }

    private void showList() {
        mModelList.setVisibility(View.VISIBLE);
        mRetryButton.setVisibility(View.GONE);
        mStatusText.setVisibility(View.GONE);
    }
}
