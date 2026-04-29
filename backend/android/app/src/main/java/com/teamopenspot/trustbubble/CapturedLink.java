package com.teamopenspot.trustbubble;

import org.json.JSONException;
import org.json.JSONObject;

public class CapturedLink {
    private final String text;
    private final String href;
    private final String source;

    public CapturedLink(String text, String href, String source) {
        this.text = text;
        this.href = href;
        this.source = source;
    }

    public String getText() {
        return text;
    }

    public String getHref() {
        return href;
    }

    public String getSource() {
        return source;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject object = new JSONObject();
        if (text != null && !text.isEmpty()) {
            object.put("text", text);
        }
        object.put("href", href);
        object.put("source", source);
        return object;
    }
}
