package au.z2hs.trustlens;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class CapturePayload {
    String packageName = "";
    String pageTitle = "";
    String visibleText = "";
    String screenshotOcrText = "";
    String screenshotDataUrl = "";
    String contentType = "post";
    final List<String> visibleProfileSignals = new ArrayList<>();
    final List<String> mediaSignals = new ArrayList<>();
    final List<VisibleLink> visibleLinks = new ArrayList<>();

    JSONObject toAssessJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("client", "android");
            json.put("pageTitle", pageTitle);
            json.put("visibleText", visibleText);
            json.put("screenshotOcrText", screenshotOcrText);
            json.put("contentType", contentType);
            json.put("visibleProfileSignals", stringArray(visibleProfileSignals));
            JSONArray links = new JSONArray();
            for (VisibleLink link : visibleLinks) links.put(link.toExtractedLinkJson());
            json.put("extractedLinks", links);
            if (!screenshotOcrText.trim().isEmpty() || !mediaSignals.isEmpty()) {
                JSONObject imageCrop = new JSONObject();
                imageCrop.put("description", screenshotOcrText.trim().isEmpty() ? String.join("\n", mediaSignals) : screenshotOcrText);
                imageCrop.put("mediaType", screenshotDataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png");
                if (!screenshotDataUrl.trim().isEmpty()) {
                    imageCrop.put("dataUrl", screenshotDataUrl);
                }
                json.put("imageCrop", imageCrop);
            } else if (!screenshotDataUrl.trim().isEmpty()) {
                JSONObject imageCrop = new JSONObject();
                imageCrop.put("dataUrl", screenshotDataUrl);
                imageCrop.put("mediaType", screenshotDataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png");
                imageCrop.put("description", "Android screen capture after the user paused scrolling.");
                json.put("imageCrop", imageCrop);
            }
            json.put("verificationMode", "fast");
            json.put("consentToStoreEvidence", false);
        } catch (Exception ignored) {
        }
        return json;
    }

    JSONObject toDebugJson() {
        JSONObject json = toAssessJson();
        try {
            JSONObject imageCrop = json.optJSONObject("imageCrop");
            if (imageCrop != null && imageCrop.has("dataUrl")) {
                String dataUrl = imageCrop.optString("dataUrl", "");
                imageCrop.put("dataUrl", "[redacted screenshot dataUrl, chars=" + dataUrl.length() + "]");
            }
        } catch (Exception ignored) {
        }
        return json;
    }

    static CapturePayload mockPost() {
        CapturePayload payload = new CapturePayload();
        payload.packageName = "mock.facebook.feed";
        payload.pageTitle = "Carol Johnson";
        payload.contentType = "post";
        payload.visibleText =
            "Carol Johnson\n"
                + "Walking 10,000 steps a day can reverse aging and add 10 years to your life, new study claims.\n"
                + "Limited time health report. Click the link now before it is removed.";
        payload.screenshotOcrText = "Image description: smiling older couple walking in a park.";
        payload.screenshotDataUrl = "";
        payload.visibleLinks.add(new VisibleLink("https://bit.ly/secret-health-report", "View official study"));
        payload.visibleProfileSignals.add("Mock Facebook-style post");
        payload.visibleProfileSignals.add("Captured after scrolling paused for 1.5 seconds");
        payload.mediaSignals.add("Image description: smiling older couple walking in a park.");
        return payload;
    }

    String signature() {
        return packageName + "::" + pageTitle + "::" + visibleText.hashCode() + "::" + screenshotOcrText.hashCode() + "::" + visibleLinks.size();
    }

    boolean hasUsefulEvidence() {
        return visibleText.trim().length() > 20
            || screenshotOcrText.trim().length() > 20
            || !screenshotDataUrl.trim().isEmpty()
            || !visibleLinks.isEmpty();
    }

    private static JSONArray stringArray(List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        return array;
    }
}
