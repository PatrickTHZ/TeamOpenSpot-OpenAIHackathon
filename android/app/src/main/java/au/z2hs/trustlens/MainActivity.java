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
import android.widget.EditText;
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
    private EditText backendInput;
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
        root.setPadding(dp(22), dp(24), dp(22), dp(28));
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        scrollView.addView(root);
        setContentView(scrollView);

        addBrandHeader();
        addStatusPanel();
        if (getIntent().getBooleanExtra(EXTRA_SHOW_DETAILS, false)) {
            addAssessmentDetails();
        } else {
            addFlowPreview();
            addAssessmentDetails();
        }
    }

    private void renderPreservingScroll() {
        int scrollY = scrollView == null ? 0 : scrollView.getScrollY();
        render();
        if (scrollView != null) {
            scrollView.post(() -> scrollView.scrollTo(0, scrollY));
        }
    }

    private void addBrandHeader() {
        TextView logo = text("[ ]", 28, "#63B5B0", true);
        logo.setGravity(Gravity.CENTER);
        root.addView(logo);

        TextView title = text("TrustLens", 34, "#182235", true);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        TextView tagline = text("See the truth.\nShare with confidence.", 28, "#182235", true);
        tagline.setGravity(Gravity.CENTER);
        tagline.setPadding(0, dp(8), 0, dp(8));
        root.addView(tagline);

        TextView intro = text(
            "A floating risk bubble appears over Facebook or your browser. It waits while you scroll, then checks the visible post after you pause.",
            16,
            "#4F5B6C",
            false
        );
        intro.setGravity(Gravity.CENTER);
        root.addView(intro, matchWrap());
    }

    private void addStatusPanel() {
        LinearLayout panel = panel();
        TextView heading = text("Protection", 20, "#182235", true);
        panel.addView(heading);

        Switch enabled = new Switch(this);
        enabled.setText("Trust Bubble on");
        enabled.setTextSize(18);
        enabled.setTextColor(color("#182235"));
        enabled.setChecked(TrustLensPrefs.isEnabled(this));
        enabled.setPadding(0, dp(10), 0, dp(10));
        enabled.setOnCheckedChangeListener((CompoundButton buttonView, boolean isChecked) -> TrustLensPrefs.setEnabled(this, isChecked));
        panel.addView(enabled);

        backendInput = new EditText(this);
        backendInput.setSingleLine(true);
        backendInput.setText(TrustLensPrefs.backendUrl(this));
        backendInput.setTextSize(15);
        backendInput.setHint(TrustLensPrefs.DEFAULT_BACKEND_URL);
        panel.addView(label("Backend URL"));
        panel.addView(backendInput, matchWrap());

        Button saveBackend = button("Save backend");
        saveBackend.setOnClickListener(view -> TrustLensPrefs.setBackendUrl(this, backendInput.getText().toString()));
        panel.addView(saveBackend);

        Button overlay = button(hasOverlayPermission() ? "Overlay permission ready" : "Allow floating bubble");
        overlay.setEnabled(!hasOverlayPermission());
        overlay.setOnClickListener(view -> startActivity(OverlayBubbleController.overlaySettingsIntent(this)));
        panel.addView(overlay);

        Button testOverlay = button("Test floating bubble");
        testOverlay.setOnClickListener(view -> testFloatingBubble());
        panel.addView(testOverlay);

        Button accessibility = button("Open accessibility settings");
        accessibility.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        panel.addView(accessibility);

        Button mock = button("Run mock post test");
        mock.setOnClickListener(view -> runMockPostTest());
        panel.addView(mock);
        panel.addView(screenshotPreviewSection());
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
        panel.addView(text("Latest check", 20, "#182235", true));

        TextView badge = text(assessment.label, 30, colorForRisk(assessment), true);
        badge.setPadding(0, dp(8), 0, dp(2));
        panel.addView(badge);
        panel.addView(text(assessment.plainLanguageSummary, 16, "#4F5B6C", false));

        LinearLayout metrics = new LinearLayout(this);
        metrics.setOrientation(LinearLayout.HORIZONTAL);
        metrics.setPadding(0, dp(14), 0, dp(10));
        metrics.addView(metric("Risk", capitalize(assessment.riskLevel)), weightWrap());
        metrics.addView(metric("Score", assessment.score > 0 ? String.valueOf(assessment.score) : "-"), weightWrap());
        metrics.addView(metric("Confidence", capitalize(assessment.confidence)), weightWrap());
        panel.addView(metrics);

        panel.addView(section("Why", assessment.why));
        panel.addView(section("Advice", listOfOne(assessment.advice)));
        panel.addView(section("Risk signals", assessment.riskSignals));
        panel.addView(section("Requested actions", assessment.requestedActions));
        panel.addView(section("Evidence to check", mergeEvidence(assessment)));
        panel.addView(section("Visible links", linkText(assessment.visibleLinks)));
        panel.addView(screenshotPreviewSection());
        panel.addView(rawCaptureSection());

        if (assessment.assessedAtMillis > 0) {
            panel.addView(text(
                "Updated " + DateFormat.getDateFormat(this).format(new Date(assessment.assessedAtMillis))
                    + " " + DateFormat.getTimeFormat(this).format(new Date(assessment.assessedAtMillis)),
                13,
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
        TextView labelView = text(label, 12, "#697589", true);
        TextView valueView = text(value, 17, "#182235", true);
        box.addView(labelView);
        box.addView(valueView);
        return box;
    }

    private LinearLayout section(String title, List<String> values) {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(12), 0, 0);
        section.addView(text(title, 16, "#182235", true));
        if (values.isEmpty()) values = listOfOne("No details captured yet.");
        for (String value : values) {
            TextView item = text("- " + value, 15, "#4F5B6C", false);
            item.setPadding(0, dp(4), 0, 0);
            section.addView(item);
        }
        return section;
    }

    private LinearLayout rawCaptureSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(12), 0, 0);
        section.addView(text("Last captured payload", 16, "#182235", true));
        TextView raw = text(TrustLensPrefs.lastCapture(this), 12, "#4F5B6C", false);
        raw.setPadding(dp(10), dp(8), dp(10), dp(8));
        raw.setBackgroundColor(color("#F4F6F8"));
        section.addView(raw, matchWrap());
        return section;
    }

    private LinearLayout screenshotPreviewSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(12), 0, 0);
        section.addView(text("Last screenshot sent", 16, "#182235", true));

        String path = TrustLensPrefs.lastScreenshotPath(this);
        File file = path.isEmpty() ? null : new File(path);
        if (file != null && file.exists()) {
            ImageView image = new ImageView(this);
            image.setImageBitmap(BitmapFactory.decodeFile(file.getAbsolutePath()));
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setBackgroundColor(color("#F4F6F8"));
            image.setPadding(dp(6), dp(6), dp(6), dp(6));
            section.addView(image, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(420)
            ));
            section.addView(text("Saved at: " + path, 12, "#697589", false));
        } else {
            section.addView(text(
                path.isEmpty()
                    ? "No screenshot preview saved yet. Pause on Facebook/Chrome until diagnostics says screenshot=true."
                    : "Screenshot path was saved, but the file was not found: " + path,
                13,
                "#697589",
                false
            ));
        }
        return section;
    }

    private LinearLayout debugStatusSection() {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(0, dp(14), 0, 0);
        section.addView(text("Capture diagnostics", 16, "#182235", true));
        TextView status = text(TrustLensPrefs.debugStatus(this), 13, "#4F5B6C", false);
        status.setPadding(dp(10), dp(8), dp(10), dp(8));
        status.setBackgroundColor(color("#F4F6F8"));
        section.addView(status, matchWrap());

        Button refresh = button("Refresh diagnostics");
        refresh.setOnClickListener(view -> render());
        section.addView(refresh);
        return section;
    }

    private LinearLayout panel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(18), dp(18), dp(18), dp(18));
        panel.setBackgroundResource(R.drawable.trust_panel_bg);
        LinearLayout.LayoutParams params = matchWrap();
        params.setMargins(0, dp(18), 0, 0);
        panel.setLayoutParams(params);
        return panel;
    }

    private TextView label(String value) {
        TextView view = text(value, 13, "#697589", true);
        view.setPadding(0, dp(10), 0, dp(4));
        return view;
    }

    private Button button(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(15);
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
