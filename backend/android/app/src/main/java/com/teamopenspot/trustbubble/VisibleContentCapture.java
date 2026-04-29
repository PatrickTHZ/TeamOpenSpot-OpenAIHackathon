package com.teamopenspot.trustbubble;

import android.graphics.Rect;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class VisibleContentCapture {
    private static final int MAX_TREE_DEPTH = 24;
    private static final int MAX_SCANNED_NODES = 700;
    private static final int MAX_VISIBLE_TEXT_CHARS = 6000;
    private static final int MAX_CONTENT_DESCRIPTIONS = 24;
    private static final int MAX_LINKS = 20;
    private static final Pattern URL_PATTERN = Pattern.compile(
            "(https?://[^\\s)\\]}>,]+|www\\.[^\\s)\\]}>,]+)",
            Pattern.CASE_INSENSITIVE
    );

    public CapturedVisibleContent capture(
            AccessibilityNodeInfo rootNode,
            String packageName,
            long lastScrollUptimeMillis
    ) {
        CaptureAccumulator accumulator = new CaptureAccumulator();

        if (rootNode != null) {
            traverse(rootNode, 0, accumulator);
        }

        return new CapturedVisibleContent(
                packageName,
                SystemClock.uptimeMillis(),
                lastScrollUptimeMillis,
                accumulator.visibleText.toString().trim(),
                new ArrayList<>(accumulator.contentDescriptions),
                new ArrayList<>(accumulator.links),
                accumulator.scannedNodeCount,
                accumulator.capturedTextNodeCount
        );
    }

    private void traverse(AccessibilityNodeInfo node, int depth, CaptureAccumulator accumulator) {
        if (
                node == null ||
                        depth > MAX_TREE_DEPTH ||
                        accumulator.scannedNodeCount >= MAX_SCANNED_NODES ||
                        accumulator.visibleText.length() >= MAX_VISIBLE_TEXT_CHARS
        ) {
            return;
        }

        accumulator.scannedNodeCount++;

        if (!isUsefulVisibleNode(node)) {
            return;
        }

        CharSequence text = node.getText();
        CharSequence description = node.getContentDescription();
        addText(text, accumulator);
        addContentDescription(description, accumulator);
        extractLinks(text, accumulator);
        extractLinks(description, accumulator);

        int childCount = node.getChildCount();
        for (int index = 0; index < childCount && accumulator.scannedNodeCount < MAX_SCANNED_NODES; index++) {
            AccessibilityNodeInfo child = node.getChild(index);
            try {
                traverse(child, depth + 1, accumulator);
            } finally {
                if (child != null) {
                    child.recycle();
                }
            }
        }
    }

    private boolean isUsefulVisibleNode(AccessibilityNodeInfo node) {
        if (!node.isVisibleToUser()) {
            return false;
        }

        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.width() <= 0 || bounds.height() <= 0) {
            return false;
        }

        CharSequence className = node.getClassName();
        String classText = className == null ? "" : className.toString().toLowerCase();
        return !classText.contains("toast");
    }

    private void addText(CharSequence text, CaptureAccumulator accumulator) {
        String normalized = normalize(text);
        if (normalized.isEmpty() || accumulator.seenText.contains(normalized)) {
            return;
        }

        accumulator.seenText.add(normalized);
        appendWithLimit(accumulator.visibleText, normalized);
        accumulator.capturedTextNodeCount++;
    }

    private void addContentDescription(CharSequence description, CaptureAccumulator accumulator) {
        String normalized = normalize(description);
        if (
                normalized.isEmpty() ||
                        normalized.length() < 3 ||
                        accumulator.contentDescriptions.size() >= MAX_CONTENT_DESCRIPTIONS
        ) {
            return;
        }
        accumulator.contentDescriptions.add(normalized);
    }

    private void extractLinks(CharSequence source, CaptureAccumulator accumulator) {
        String normalized = normalize(source);
        if (normalized.isEmpty() || accumulator.links.size() >= MAX_LINKS) {
            return;
        }

        Matcher matcher = URL_PATTERN.matcher(normalized);
        while (matcher.find() && accumulator.links.size() < MAX_LINKS) {
            String rawUrl = trimTrailingPunctuation(matcher.group(1));
            String href = rawUrl.toLowerCase().startsWith("www.") ? "https://" + rawUrl : rawUrl;
            if (accumulator.seenLinks.add(href)) {
                accumulator.links.add(new CapturedLink(rawUrl, href, "visible"));
            }
        }
    }

    private void appendWithLimit(StringBuilder builder, String text) {
        if (builder.length() >= MAX_VISIBLE_TEXT_CHARS) {
            return;
        }
        if (builder.length() > 0) {
            builder.append('\n');
        }

        int remaining = MAX_VISIBLE_TEXT_CHARS - builder.length();
        if (text.length() <= remaining) {
            builder.append(text);
        } else {
            builder.append(text, 0, Math.max(0, remaining));
        }
    }

    private String normalize(CharSequence value) {
        if (TextUtils.isEmpty(value)) {
            return "";
        }
        return value.toString().replaceAll("\\s+", " ").trim();
    }

    private String trimTrailingPunctuation(String value) {
        return value.replaceAll("[.,;:!?]+$", "");
    }

    private static class CaptureAccumulator {
        private final StringBuilder visibleText = new StringBuilder();
        private final Set<String> seenText = new HashSet<>();
        private final LinkedHashSet<String> contentDescriptions = new LinkedHashSet<>();
        private final List<CapturedLink> links = new ArrayList<>();
        private final Set<String> seenLinks = new HashSet<>();
        private int scannedNodeCount;
        private int capturedTextNodeCount;
    }
}
