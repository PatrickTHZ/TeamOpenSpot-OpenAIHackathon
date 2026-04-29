package au.z2hs.trustlens;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.format.DateFormat;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ImageView;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.util.Date;
import java.io.File;
import java.util.List;

public final class MainActivity extends Activity {
    static final String EXTRA_SHOW_DETAILS = "show_details";

    private LinearLayout root;
    private BackendClient backendClient;
    private OverlayBubbleController overlayController;
    private SharedPreferences.OnSharedPreferenceChangeListener preferenceListener;
    private ScrollView scrollView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable deferredRender = this::renderPreservingScroll;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        backendClient = new BackendClient(this);
        overlayController = new OverlayBubbleController(this);
        preferenceListener = (sharedPreferences, key) -> {
            if (!"last_assessment".equals(key) && !"last_screenshot_path".equals(key)) return;
            runOnUiThread(() -> {
                handler.removeCallbacks(deferredRender);
                handler.postDelayed(deferredRender, 350);
            });
        };
        TrustLensPrefs.prefs(this).registerOnSharedPreferenceChangeListener(preferenceListener);
        render();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(deferredRender);
        TrustLensPrefs.prefs(this).unregisterOnSharedPreferenceChangeListener(preferenceListener);
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    private void render() {
        scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(color("#FFFCF6"));

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(34));
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        scrollView.addView(root);
        setContentView(scrollView);

        addBrandHeader();
        if (!TrustLensPrefs.onboardingDone(this)) {
            addOnboardingPanel();
            return;
        }
        addAssessmentDetails();
        addStatusPanel();
    }

    private void renderPreservingScroll() {
        int scrollY = scrollView == null ? 0 : scrollView.getScrollY();
        render();
        if (scrollView != null) {
            scrollView.post(() -> scrollView.scrollTo(0, scrollY));
        }
    }

    private void addBrandHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER);
        header.setPadding(0, dp(18), 0, dp(24));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_launcher);
        logo.setAdjustViewBounds(true);
        logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(48), dp(48));
        logoParams.setMargins(0, 0, dp(12), 0);
        header.addView(logo, logoParams);

        TextView title = text("TrustLens", 36, "#182235", true);
        title.setGravity(Gravity.CENTER);
        header.addView(title);
        root.addView(header, matchWrap());
    }

    private void addOnboardingPanel() {
        LinearLayout panel = panel();
        panel.addView(text("Let's set up TrustLens", 28, "#182235", true));
        TextView intro = text(
            "TrustLens needs two Android permissions so the small bubble can check posts while you browse.",
            19,
            "#4F5B6C",
            false
        );
        intro.setPadding(0, dp(14), 0, dp(10));
        panel.addView(intro);

        panel.addView(section("Step 1", listOfOne("Allow the floating bubble so TrustLens can show a simple score over Facebook or Chrome.")));
        Button overlay = button(hasOverlayPermission() ? "Floating bubble is ready" : "Allow floating bubble");
        overlay.setEnabled(!hasOverlayPermission());
        overlay.setOnClickListener(view -> startActivity(OverlayBubbleController.overlaySettingsIntent(this)));
        panel.addView(overlay);

        panel.addView(section("Step 2", listOfOne("Turn on TrustLens feed helper in Accessibility settings. This lets TrustLens take a screenshot after you pause.")));
        Button accessibility = button("Open Accessibility settings");
        accessibility.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        panel.addView(accessibility);

        panel.addView(section("Step 3", listOfOne("Open Facebook or Chrome, scroll normally, then pause for a moment. TrustLens checks once and explains the result.")));
        Button done = button("I finished setup");
        done.setOnClickListener(view -> {
            TrustLensPrefs.setOnboardingDone(this, true);
            render();
        });
        panel.addView(done);

        root.addView(panel, matchWrap());
    }

    private void addStatusPanel() {
        LinearLayout panel = panel();
        TextView heading = text("Setup", 20, "#182235", true);
        panel.addView(heading);

        Switch enabled = new Switch(this);
        enabled.setText("Trust Bubble on");
        enabled.setTextSize(20);
        enabled.setTextColor(color("#182235"));
        enabled.setChecked(TrustLensPrefs.isEnabled(this));
        enabled.setPadding(0, dp(10), 0, dp(10));
        enabled.setOnCheckedChangeListener((CompoundButton buttonView, boolean isChecked) -> TrustLensPrefs.setEnabled(this, isChecked));
        panel.addView(enabled);

        Button overlay = button(hasOverlayPermission() ? "Overlay permission ready" : "Allow floating bubble");
        overlay.setEnabled(!hasOverlayPermission());
        overlay.setOnClickListener(view -> startActivity(OverlayBubbleController.overlaySettingsIntent(this)));
        panel.addView(overlay);

        Button accessibility = button("Open accessibility settings");
        accessibility.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        panel.addView(accessibility);

        panel.addView(debugStatusSection());
        root.addView(panel, matchWrap());
    }

    private void addFlowPreview() {
        LinearLayout panel = panel();
        panel.addView(text("How it works", 20, "#182235", true));
        panel.addView(step("1", "Open Facebook or a web feed"));
        panel.addView(step("2", "Trust Bubble appears and waits"));
        panel.addView(step("3", "Scroll normally. Nothing is captured"));
        panel.addView(step("4", "Pause for 1.5 seconds"));
        panel.addView(step("5", "Visible text, image descriptions, and links are sent to the risk agent"));
        panel.addView(step("6", "Tap the bubble for plain advice"));
        root.addView(panel, matchWrap());
    }

    private void addAssessmentDetails() {
        Assessment assessment = TrustLensPrefs.lastAssessment(this);
        LinearLayout panel = panel();
        panel.addView(text("Result", 24, "#182235", true));

        TextView badge = text(assessment.label, 34, colorForRisk(assessment), true);
        badge.setPadding(0, dp(14), 0, dp(4));
        panel.addView(badge);
        panel.addView(text(scoreLine(assessment), 28, colorForRisk(assessment), true));
        TextView summary = text(assessment.plainLanguageSummary, 19, "#4F5B6C", false);
        summary.setPadding(0, dp(12), 0, dp(8));
        panel.addView(summary);

        LinearLayout metrics = new LinearLayout(this);
        metrics.setOrientation(LinearLayout.HORIZONTAL);
        metrics.setPadding(0, dp(18), 0, dp(12));
        metrics.addView(metric("Risk", capitalize(assessment.riskLevel)), weightWrap());
        metrics.addView(metric("Score", assessment.score > 0 ? String.valueOf(assessment.score) : "-"), weightWrap());
        metrics.addView(metric("Confidence", capitalize(assessment.confidence)), weightWrap());
        panel.addView(metrics);

        panel.addView(section("Why this score", assessment.why));
        panel.addView(section("What to do", listOfOne(assessment.advice)));
        panel.addView(screenshotPreviewSection());

        if (assessment.assessedAtMillis > 0) {
            panel.addView(text(
                "Updated " + DateFormat.getDateFormat(this).format(new Date(assessment.assessedAtMillis))
                    + " " + DateFormat.getTimeFormat(this).format(new Date(assessment.assessedAtMillis)),
                15,
                "#697589",
                false
            ));
        }
        root.addView(panel, matchWrap());
    }

    private void runMockPostTest() {
        CapturePayload payload = CapturePayload.mockPost();
        TrustLensPrefs.storeCapture(this, payload);
        TrustLensPrefs.storeAssessment(this, Assessment.loading());
        if (overlayController.canDraw()) {
            overlayController.show(Assessment.loading());
        } else {
            TrustLensPrefs.storeDebugStatus(this, "Mock test started, but floating bubble permission is not enabled.");
        }
        render();
        backendClient.assess(payload, assessment -> runOnUiThread(() -> {
            if (overlayController.canDraw()) overlayController.show(assessment);
            render();
        }));
    }

    private void testFloatingBubble() {
        if (!overlayController.canDraw()) {
            TrustLensPrefs.storeDebugStatus(this, "Floating bubble test failed: overlay permission is not enabled.");
            render();
            return;
        }
        Assessment assessment = new Assessment();
        assessment.score = 82;
        assessment.band = "green";
        assessment.riskLevel = "low";
        assessment.label = "Low risk";
        assessment.plainLanguageSummary = "Overlay test is working.";
        assessment.advice = "Now test Accessibility capture in Facebook or Chrome.";
        assessment.why.add("This confirms Android can draw the floating Trust Bubble.");
        overlayController.show(assessment);
        TrustLensPrefs.storeDebugStatus(this, "Floating bubble test passed. If real pauses still do not work, the issue is Accessibility capture or backend.");
        render();
    }

    private View step(String number, String label) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(8), 0, dp(8));
        TextView dot = text(number, 16, "#FFFFFF", true);
        dot.setGravity(Gravity.CENTER);
        dot.setBackgroundResource(R.drawable.circle_teal);
        row.addView(dot, new LinearLayout.LayoutParams(dp(34), dp(34)));
        TextView copy = text(label, 16, "#182235", false);
        copy.setPadding(dp(12), 0, 0, 0);
        row.addView(copy, weightWrap());
        return row;
    }

    private LinearLayout metric(String label, String value) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(8), 0, dp(8), 0);
        TextView labelView = text(label, 15, "#697589", true);
        TextView valueView = text(value, 20, "#182235", true);
        box.addView(labelView);
        box.addView(valueView);
        return box;
    }

    private LinearLayout section(String title, List<String> values) {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(20), 0, 0);
        section.addView(text(title, 21, "#182235", true));
        if (values.isEmpty()) values = listOfOne("No details captured yet.");
        for (String value : values) {
            TextView item = text("- " + value, 18, "#4F5B6C", false);
            item.setPadding(0, dp(8), 0, 0);
            section.addView(item);
        }
        return section;
    }

    private LinearLayout rawCaptureSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(16), 0, 0);
        section.addView(text("Last captured payload", 18, "#182235", true));
        TextView raw = text(TrustLensPrefs.lastCapture(this), 14, "#4F5B6C", false);
        raw.setPadding(dp(10), dp(8), dp(10), dp(8));
        raw.setBackgroundColor(color("#F4F6F8"));
        section.addView(raw, matchWrap());
        return section;
    }

    private LinearLayout screenshotPreviewSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(22), 0, 0);
        section.addView(text("Picture checked", 21, "#182235", true));

        String path = TrustLensPrefs.lastScreenshotPath(this);
        boolean isContentUri = path.startsWith("content://");
        File file = path.isEmpty() || isContentUri ? null : new File(path);
        if (isContentUri || (file != null && file.exists())) {
            ImageView image = new ImageView(this);
            if (isContentUri) {
                image.setImageURI(Uri.parse(path));
            } else {
                image.setImageBitmap(BitmapFactory.decodeFile(file.getAbsolutePath()));
            }
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setBackgroundColor(color("#F4F6F8"));
            image.setPadding(dp(6), dp(6), dp(6), dp(6));
            section.addView(image, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(360)
            ));
            section.addView(text("Saved at: " + path, 13, "#697589", false));
            section.addView(text(
                isContentUri ? "Open your Photos/Gallery app and look in Pictures/TrustLens." : "Open this file with Android Studio Device Explorer.",
                14,
                "#697589",
                false
            ));
        } else {
            section.addView(text(
                path.isEmpty()
                    ? "No screenshot preview saved yet. Pause on Facebook/Chrome until diagnostics says screenshot=true."
                    : "Screenshot path was saved, but the file was not found: " + path,
                16,
                "#697589",
                false
            ));
        }
        return section;
    }

    private LinearLayout debugStatusSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(18), 0, 0);
        section.addView(text("Status", 19, "#182235", true));
        TextView status = text(friendlyStatus(), 16, "#4F5B6C", false);
        status.setPadding(dp(10), dp(8), dp(10), dp(8));
        status.setBackgroundColor(color("#F4F6F8"));
        section.addView(status, matchWrap());
        return section;
    }

    private String friendlyStatus() {
        String status = TrustLensPrefs.debugStatus(this);
        if (status.contains("Backend returned")) return "TrustLens checked the latest screen.";
        if (status.contains("Screenshot captured") || status.contains("Sending backend request")) {
            return "TrustLens is checking the latest screen.";
        }
        if (status.contains("Accessibility service connected")) return "TrustLens is ready.";
        if (status.contains("overlay permission is not enabled")) return "Please allow the floating bubble.";
        if (status.contains("Screenshot capture failed")) return "TrustLens could not take a picture on this screen.";
        return "Open Facebook or Chrome, scroll, then pause for a moment.";
    }

    private LinearLayout panel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(22), dp(22), dp(22), dp(22));
        panel.setBackgroundResource(R.drawable.trust_panel_bg);
        LinearLayout.LayoutParams params = matchWrap();
        params.setMargins(0, dp(18), 0, 0);
        panel.setLayoutParams(params);
        return panel;
    }

    private TextView label(String value) {
        TextView view = text(value, 16, "#697589", true);
        view.setPadding(0, dp(14), 0, dp(6));
        return view;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(18);
        button.setAllCaps(false);
        return button;
    }

    private TextView text(String value, int size, String color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color(color));
        view.setLineSpacing(dp(2), 1.0f);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
    }

    private LinearLayout.LayoutParams weightWrap() {
        return new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    }

    private List<String> mergeEvidence(Assessment assessment) {
        java.util.ArrayList<String> merged = new java.util.ArrayList<>();
        merged.addAll(assessment.evidenceAgainst);
        merged.addAll(assessment.missingSignals);
        merged.addAll(assessment.evidenceFor);
        return merged;
    }

    private List<String> linkText(List<VisibleLink> links) {
        java.util.ArrayList<String> values = new java.util.ArrayList<>();
        for (VisibleLink link : links) values.add(link.text.isEmpty() ? link.href : link.text + " -> " + link.host);
        return values;
    }

    private List<String> listOfOne(String value) {
        java.util.ArrayList<String> values = new java.util.ArrayList<>();
        if (value != null && !value.trim().isEmpty()) values.add(value);
        return values;
    }

    private boolean hasOverlayPermission() {
        return android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M || Settings.canDrawOverlays(this);
    }

    private String colorForRisk(Assessment assessment) {
        if ("low".equals(assessment.riskLevel)) return "#2E9D57";
        if ("medium".equals(assessment.riskLevel)) return "#B88400";
        if ("high".equals(assessment.riskLevel)) return "#D14B48";
        return "#928BDD";
    }

    private String scoreLine(Assessment assessment) {
        if (assessment.score <= 0) return "Waiting for a result";
        if ("low".equals(assessment.riskLevel)) return assessment.score + "% Reliable";
        if ("medium".equals(assessment.riskLevel)) return assessment.score + "% Needs context";
        if ("high".equals(assessment.riskLevel)) return assessment.score + "% Misleading";
        return assessment.score + "%";
    }

    private String capitalize(String value) {
        if (value == null || value.isEmpty()) return "-";
        return value.substring(0, 1).toUpperCase() + value.substring(1);
    }

    private int color(String value) {
        return Color.parseColor(value);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
