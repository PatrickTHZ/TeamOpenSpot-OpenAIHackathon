package au.z2hs.trustlens;

import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class VisibleContentExtractor {
    private static final int MAX_TEXT_CHARS = 6000;
    private static final Pattern URL_PATTERN = Pattern.compile("(https?://[^\\s]+|www\\.[^\\s]+)");

    CapturePayload extract(AccessibilityNodeInfo root, CharSequence packageName) {
        CapturePayload payload = new CapturePayload();
        payload.packageName = packageName == null ? "" : packageName.toString();
        if (payload.packageName.contains("browser") || payload.packageName.contains("chrome")) {
            payload.contentType = "article";
        }
        if (root == null) return payload;

        StringBuilder text = new StringBuilder();
        Set<String> seenText = new HashSet<>();
        collect(root, text, seenText, payload);
        payload.visibleText = text.toString().trim();
        payload.pageTitle = firstUsefulLine(payload.visibleText);
        payload.screenshotOcrText = String.join("\n", payload.mediaSignals);

        if (!payload.packageName.isEmpty()) {
            payload.visibleProfileSignals.add("App detected: " + friendlyAppName(payload.packageName));
        }
        if (!payload.visibleLinks.isEmpty()) {
            payload.visibleProfileSignals.add(payload.visibleLinks.size() + " visible link(s) captured");
        }
        payload.visibleProfileSignals.add("Captured after scrolling paused for 1.5 seconds");
        return payload;
    }

    private void collect(
        AccessibilityNodeInfo node,
        StringBuilder text,
        Set<String> seenText,
        CapturePayload payload
    ) {
        if (node == null || text.length() >= MAX_TEXT_CHARS) return;
        if (isVisibleEnough(node)) {
            CharSequence value = node.getText();
            CharSequence description = node.getContentDescription();
            appendText(value, text, seenText, payload);
            if (description != null && description.length() > 0 && !description.toString().contentEquals(value == null ? "" : value)) {
                String signal = clean(description.toString());
                if (looksLikeMedia(node, signal)) {
                    payload.mediaSignals.add("Image or video description: " + signal);
                } else {
                    appendText(description, text, seenText, payload);
                }
            } else if (looksLikeMedia(node, "")) {
                payload.mediaSignals.add("Visible image or video has no readable description.");
            }
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            collect(node.getChild(i), text, seenText, payload);
        }
    }

    private void appendText(
        CharSequence raw,
        StringBuilder text,
        Set<String> seenText,
        CapturePayload payload
    ) {
        String value = clean(raw == null ? "" : raw.toString());
        if (value.length() < 3 || seenText.contains(value)) return;
        seenText.add(value);
        captureLinks(value, payload);
        if (text.length() + value.length() < MAX_TEXT_CHARS) {
            text.append(value).append('\n');
        }
    }

    private void captureLinks(String value, CapturePayload payload) {
        Matcher matcher = URL_PATTERN.matcher(value);
        while (matcher.find() && payload.visibleLinks.size() < 12) {
            String href = matcher.group(1);
            if (href.startsWith("www.")) href = "https://" + href;
            payload.visibleLinks.add(new VisibleLink(href, value.length() > 120 ? value.substring(0, 120) : value));
        }
    }

    private boolean isVisibleEnough(AccessibilityNodeInfo node) {
        Rect rect = new Rect();
        node.getBoundsInScreen(rect);
        return rect.width() > 0 && rect.height() > 0 && node.isVisibleToUser();
    }

    private boolean looksLikeMedia(AccessibilityNodeInfo node, String text) {
        String className = node.getClassName() == null ? "" : node.getClassName().toString().toLowerCase(Locale.US);
        String lower = text.toLowerCase(Locale.US);
        return className.contains("image")
            || className.contains("video")
            || lower.contains("photo")
            || lower.contains("image")
            || lower.contains("video");
    }

    private String firstUsefulLine(String value) {
        String[] lines = value.split("\\n");
        for (String line : lines) {
            String clean = clean(line);
            if (clean.length() >= 8) return clean.length() > 120 ? clean.substring(0, 120) : clean;
        }
        return "";
    }

    private String friendlyAppName(String packageName) {
        if (packageName.contains("facebook")) return "Facebook";
        if (packageName.contains("chrome")) return "Chrome";
        if (packageName.contains("browser")) return "Web browser";
        if (packageName.contains("instagram")) return "Instagram";
        return packageName;
    }

    private String clean(String value) {
        return value.replaceAll("\\s+", " ").trim();
    }
}
