package com.teamopenspot.trustbubble;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class CapturedVisibleContent {
    private final String packageName;
    private final long capturedAtUptimeMillis;
    private final long lastScrollUptimeMillis;
    private final String visibleText;
    private final List<String> contentDescriptions;
    private final List<CapturedLink> extractedLinks;
    private final int scannedNodeCount;
    private final int capturedTextNodeCount;

    public CapturedVisibleContent(
            String packageName,
            long capturedAtUptimeMillis,
            long lastScrollUptimeMillis,
            String visibleText,
            List<String> contentDescriptions,
            List<CapturedLink> extractedLinks,
            int scannedNodeCount,
            int capturedTextNodeCount
    ) {
        this.packageName = packageName;
        this.capturedAtUptimeMillis = capturedAtUptimeMillis;
        this.lastScrollUptimeMillis = lastScrollUptimeMillis;
        this.visibleText = visibleText == null ? "" : visibleText;
        this.contentDescriptions = immutableCopy(contentDescriptions);
        this.extractedLinks = immutableCopy(extractedLinks);
        this.scannedNodeCount = scannedNodeCount;
        this.capturedTextNodeCount = capturedTextNodeCount;
    }

    public String getPackageName() {
        return packageName;
    }

    public long getCapturedAtUptimeMillis() {
        return capturedAtUptimeMillis;
    }

    public long getLastScrollUptimeMillis() {
        return lastScrollUptimeMillis;
    }

    public String getVisibleText() {
        return visibleText;
    }

    public List<String> getContentDescriptions() {
        return contentDescriptions;
    }

    public List<CapturedLink> getExtractedLinks() {
        return extractedLinks;
    }

    public int getScannedNodeCount() {
        return scannedNodeCount;
    }

    public int getCapturedTextNodeCount() {
        return capturedTextNodeCount;
    }

    public String getTextPreview() {
        String compact = visibleText.replaceAll("\\s+", " ").trim();
        if (compact.length() <= 240) {
            return compact;
        }
        return compact.substring(0, 240) + "...";
    }

    public JSONObject toBackendAssessRequestJson() throws JSONException {
        JSONObject object = new JSONObject();
        object.put("client", "android");
        object.put("visibleText", visibleText);
        object.put("screenshotOcrText", "");
        object.put("contentType", "post");
        object.put("locale", "en-AU");

        JSONArray profileSignals = new JSONArray();
        for (String description : contentDescriptions) {
            profileSignals.put(description);
        }
        object.put("visibleProfileSignals", profileSignals);

        JSONArray links = new JSONArray();
        for (CapturedLink link : extractedLinks) {
            links.put(link.toJson());
        }
        object.put("extractedLinks", links);

        return object;
    }

    public String toBackendAssessRequestJsonString() {
        try {
            return toBackendAssessRequestJson().toString();
        } catch (JSONException error) {
            return "{}";
        }
    }

    private static <T> List<T> immutableCopy(List<T> values) {
        if (values == null || values.isEmpty()) {
            return Collections.emptyList();
        }
        return Collections.unmodifiableList(new ArrayList<>(values));
    }
}
