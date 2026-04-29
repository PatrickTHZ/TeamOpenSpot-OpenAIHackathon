package au.z2hs.trustlens;

import android.net.Uri;

import org.json.JSONObject;

final class VisibleLink {
    final String href;
    final String text;
    final String host;
    final boolean isShortener;

    VisibleLink(String href, String text) {
        this.href = href == null ? "" : href;
        this.text = text == null ? "" : text;
        String parsedHost = "";
        try {
            parsedHost = Uri.parse(this.href).getHost();
        } catch (Exception ignored) {
        }
        this.host = parsedHost == null ? "" : parsedHost;
        this.isShortener = host.contains("bit.ly")
            || host.contains("tinyurl")
            || host.equals("t.co")
            || host.contains("goo.gl")
            || host.contains("ow.ly");
    }

    JSONObject toJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("href", href);
            json.put("text", text);
            json.put("host", host);
            json.put("isShortener", isShortener);
        } catch (Exception ignored) {
        }
        return json;
    }

    JSONObject toExtractedLinkJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("href", href);
            json.put("text", text);
            json.put("source", "visible");
        } catch (Exception ignored) {
        }
        return json;
    }

    static VisibleLink fromJson(JSONObject json) {
        if (json == null) return new VisibleLink("", "");
        return new VisibleLink(json.optString("href", ""), json.optString("text", ""));
    }
}
