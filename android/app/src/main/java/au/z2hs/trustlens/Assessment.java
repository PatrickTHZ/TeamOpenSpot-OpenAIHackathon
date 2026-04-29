package au.z2hs.trustlens;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class Assessment {
    int score = 0;
    String band = "gray";
    String riskLevel = "unknown";
    String label = "Waiting";
    String confidence = "low";
    String plainLanguageSummary = "Open Facebook or a web feed, then pause scrolling.";
    String advice = "TrustLens will wait until scrolling stops before checking visible content.";
    final List<String> why = new ArrayList<>();
    final List<String> evidenceFor = new ArrayList<>();
    final List<String> evidenceAgainst = new ArrayList<>();
    final List<String> missingSignals = new ArrayList<>();
    final List<String> riskSignals = new ArrayList<>();
    final List<String> requestedActions = new ArrayList<>();
    final List<VisibleLink> visibleLinks = new ArrayList<>();
    long assessedAtMillis = 0L;

    static Assessment waiting(String summary) {
        Assessment assessment = new Assessment();
        assessment.band = "gray";
        assessment.riskLevel = "unknown";
        assessment.label = "Waiting";
        assessment.plainLanguageSummary = summary;
        assessment.why.add("No content is captured while you are scrolling.");
        return assessment;
    }

    static Assessment loading() {
        Assessment assessment = new Assessment();
        assessment.band = "yellow";
        assessment.riskLevel = "unknown";
        assessment.label = "Checking";
        assessment.plainLanguageSummary = "Checking the visible post area now.";
        assessment.advice = "Wait a moment before clicking or sharing.";
        assessment.why.add("You paused for 1.5 seconds, so TrustLens captured visible text and links.");
        return assessment;
    }

    static Assessment fallback(String message) {
        Assessment assessment = new Assessment();
        assessment.score = 52;
        assessment.band = "yellow";
        assessment.riskLevel = "medium";
        assessment.label = "Medium risk";
        assessment.confidence = "low";
        assessment.plainLanguageSummary = "TrustLens could not reach the analysis service, so this is a cautious fallback.";
        assessment.advice = "Do not click links or share yet. Check an official source or ask someone you trust.";
        assessment.why.add("The backend assessment was unavailable.");
        assessment.missingSignals.add(message);
        assessment.assessedAtMillis = System.currentTimeMillis();
        return assessment;
    }

    static Assessment fromJson(JSONObject json, List<VisibleLink> links) {
        Assessment assessment = new Assessment();
        assessment.score = json.optInt("score", 0);
        assessment.band = json.optString("band", "gray");
        assessment.riskLevel = json.optString("riskLevel", "unknown");
        assessment.label = riskLabel(assessment.riskLevel, json.optString("label", "Cannot verify"));
        assessment.confidence = json.optString("confidence", "low");
        assessment.plainLanguageSummary = json.optString(
            "plainLanguageSummary",
            "This is a credibility estimate based on the visible post area."
        );
        assessment.advice = json.optString(
            "advice",
            json.optString("recommendedAction", "Check another trusted source before sharing.")
        );
        addArray(assessment.why, json.optJSONArray("why"));
        addArray(assessment.evidenceFor, json.optJSONArray("evidenceFor"));
        addArray(assessment.evidenceAgainst, json.optJSONArray("evidenceAgainst"));
        addArray(assessment.missingSignals, json.optJSONArray("missingSignals"));
        addRiskSignals(assessment.riskSignals, json.optJSONArray("riskSignals"));
        addRequestedActions(assessment.requestedActions, json.optJSONArray("requestedActions"));
        assessment.visibleLinks.addAll(links);
        assessment.assessedAtMillis = System.currentTimeMillis();
        return assessment;
    }

    JSONObject toJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("score", score);
            json.put("band", band);
            json.put("riskLevel", riskLevel);
            json.put("label", label);
            json.put("confidence", confidence);
            json.put("plainLanguageSummary", plainLanguageSummary);
            json.put("advice", advice);
            json.put("why", toArray(why));
            json.put("evidenceFor", toArray(evidenceFor));
            json.put("evidenceAgainst", toArray(evidenceAgainst));
            json.put("missingSignals", toArray(missingSignals));
            json.put("riskSignals", toArray(riskSignals));
            json.put("requestedActions", toArray(requestedActions));
            JSONArray links = new JSONArray();
            for (VisibleLink link : visibleLinks) links.put(link.toJson());
            json.put("visibleLinks", links);
            json.put("assessedAtMillis", assessedAtMillis);
        } catch (Exception ignored) {
        }
        return json;
    }

    static Assessment fromStoredJson(String stored) {
        if (stored == null || stored.trim().isEmpty()) return waiting("No assessment yet.");
        try {
            JSONObject json = new JSONObject(stored);
            Assessment assessment = new Assessment();
            assessment.score = json.optInt("score", 0);
            assessment.band = json.optString("band", "gray");
            assessment.riskLevel = json.optString("riskLevel", "unknown");
            assessment.label = json.optString("label", "Waiting");
            assessment.confidence = json.optString("confidence", "low");
            assessment.plainLanguageSummary = json.optString("plainLanguageSummary", "");
            assessment.advice = json.optString("advice", "");
            addArray(assessment.why, json.optJSONArray("why"));
            addArray(assessment.evidenceFor, json.optJSONArray("evidenceFor"));
            addArray(assessment.evidenceAgainst, json.optJSONArray("evidenceAgainst"));
            addArray(assessment.missingSignals, json.optJSONArray("missingSignals"));
            addArray(assessment.riskSignals, json.optJSONArray("riskSignals"));
            addArray(assessment.requestedActions, json.optJSONArray("requestedActions"));
            JSONArray links = json.optJSONArray("visibleLinks");
            if (links != null) {
                for (int i = 0; i < links.length(); i++) {
                    assessment.visibleLinks.add(VisibleLink.fromJson(links.optJSONObject(i)));
                }
            }
            assessment.assessedAtMillis = json.optLong("assessedAtMillis", 0L);
            return assessment;
        } catch (Exception ignored) {
            return waiting("No assessment yet.");
        }
    }

    private static String riskLabel(String riskLevel, String fallback) {
        if ("low".equals(riskLevel)) return "Low risk";
        if ("medium".equals(riskLevel)) return "Medium risk";
        if ("high".equals(riskLevel)) return "High risk";
        return fallback;
    }

    private static void addArray(List<String> target, JSONArray array) {
        if (array == null) return;
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "").trim();
            if (!value.isEmpty()) target.add(value);
        }
    }

    private static void addRiskSignals(List<String> target, JSONArray array) {
        if (array == null) return;
        for (int i = 0; i < array.length(); i++) {
            JSONObject signal = array.optJSONObject(i);
            if (signal == null) continue;
            String message = signal.optString("message", "").trim();
            String severity = signal.optString("severity", "").trim();
            String category = signal.optString("category", "").trim();
            if (!message.isEmpty()) target.add(severity + " " + category + ": " + message);
        }
    }

    private static void addRequestedActions(List<String> target, JSONArray array) {
        if (array == null) return;
        for (int i = 0; i < array.length(); i++) {
            JSONObject action = array.optJSONObject(i);
            if (action == null) continue;
            String advice = action.optString("advice", "").trim();
            String risk = action.optString("risk", "").trim();
            String targetValue = action.optString("target", "").trim();
            if (!advice.isEmpty()) {
                target.add(targetValue.isEmpty() ? risk + ": " + advice : risk + " " + targetValue + ": " + advice);
            }
        }
    }

    private static JSONArray toArray(List<String> values) {
        JSONArray array = new JSONArray();
        for (String value : values) array.put(value);
        return array;
    }
}
