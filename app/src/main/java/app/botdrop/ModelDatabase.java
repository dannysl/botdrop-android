package app.botdrop;

import java.util.ArrayList;
import java.util.List;

/**
 * Static database of common AI models.
 * Used during setup when openclaw is not yet installed.
 */
public class ModelDatabase {

    public static List<ModelInfo> getAllModels() {
        List<ModelInfo> models = new ArrayList<>();

        // OpenAI models
        models.add(new ModelInfo("openai/gpt-4.5-turbo", "openai", "gpt-4.5-turbo"));
        models.add(new ModelInfo("openai/gpt-4.5", "openai", "gpt-4.5"));
        models.add(new ModelInfo("openai/gpt-4-turbo", "openai", "gpt-4-turbo"));
        models.add(new ModelInfo("openai/gpt-4o", "openai", "gpt-4o"));
        models.add(new ModelInfo("openai/gpt-4o-mini", "openai", "gpt-4o-mini"));
        models.add(new ModelInfo("openai/o1", "openai", "o1"));
        models.add(new ModelInfo("openai/o1-mini", "openai", "o1-mini"));
        models.add(new ModelInfo("openai/o3-mini", "openai", "o3-mini"));

        // Anthropic models
        models.add(new ModelInfo("anthropic/claude-opus-4.6", "anthropic", "claude-opus-4.6"));
        models.add(new ModelInfo("anthropic/claude-sonnet-4.5", "anthropic", "claude-sonnet-4.5"));
        models.add(new ModelInfo("anthropic/claude-haiku-4.5", "anthropic", "claude-haiku-4.5"));
        models.add(new ModelInfo("anthropic/claude-3.5-sonnet", "anthropic", "claude-3.5-sonnet"));
        models.add(new ModelInfo("anthropic/claude-3.5-haiku", "anthropic", "claude-3.5-haiku"));

        // Google models
        models.add(new ModelInfo("google/gemini-3-flash-preview", "google", "gemini-3-flash-preview"));
        models.add(new ModelInfo("google/gemini-2.0-flash-exp", "google", "gemini-2.0-flash-exp"));
        models.add(new ModelInfo("google/gemini-1.5-pro", "google", "gemini-1.5-pro"));
        models.add(new ModelInfo("google/gemini-1.5-flash", "google", "gemini-1.5-flash"));

        // DeepSeek models
        models.add(new ModelInfo("deepseek/deepseek-chat", "deepseek", "deepseek-chat"));
        models.add(new ModelInfo("deepseek/deepseek-reasoner", "deepseek", "deepseek-reasoner"));

        // xAI models
        models.add(new ModelInfo("xai/grok-beta", "xai", "grok-beta"));
        models.add(new ModelInfo("xai/grok-vision-beta", "xai", "grok-vision-beta"));

        // Mistral models
        models.add(new ModelInfo("mistral/mistral-large-latest", "mistral", "mistral-large-latest"));
        models.add(new ModelInfo("mistral/pixtral-large-latest", "mistral", "pixtral-large-latest"));

        // Cohere models
        models.add(new ModelInfo("cohere/command-r-plus", "cohere", "command-r-plus"));
        models.add(new ModelInfo("cohere/command-r", "cohere", "command-r"));

        // Meta models
        models.add(new ModelInfo("meta/llama-3.3-70b-instruct", "meta", "llama-3.3-70b-instruct"));
        models.add(new ModelInfo("meta/llama-3.1-405b-instruct", "meta", "llama-3.1-405b-instruct"));

        return models;
    }
}
