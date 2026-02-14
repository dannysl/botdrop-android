package app.botdrop.automation;

import org.json.JSONException;
import org.json.JSONObject;

public final class Json {

    private Json() {}

    public static void put(JSONObject object, String key, Object value) {
        if (object == null || key == null) {
            return;
        }
        try {
            object.put(key, value);
        } catch (JSONException ignored) {
        }
    }
}
