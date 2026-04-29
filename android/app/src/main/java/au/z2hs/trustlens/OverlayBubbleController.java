package au.z2hs.trustlens;

import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

final class OverlayBubbleController {
    private final Context context;
    private final WindowManager windowManager;
    private static LinearLayout bubble;
    private static LinearLayout messageBubble;
    private static LinearLayout logoOrb;
    private static View scoreDot;
    private static TextView label;
    private static TextView summary;
    private static WindowManager.LayoutParams params;
    private static float downX;
    private static float downY;
    private static int startX;
    private static int startY;
    private static boolean dragging;

    OverlayBubbleController(Context context) {
        this.context = context.getApplicationContext();
        this.windowManager = (WindowManager) this.context.getSystemService(Context.WINDOW_SERVICE);
    }

    boolean canDraw() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context);
    }

    void show(Assessment assessment) {
        if (!canDraw()) return;
        if (bubble == null) createBubble();
        update(assessment);
        if (bubble.getParent() == null) {
            try {
                windowManager.addView(bubble, params);
            } catch (RuntimeException ignored) {
            }
        }
    }

    void update(Assessment assessment) {
        if (bubble == null) return;
        boolean idle = "Waiting".equals(assessment.label) && "unknown".equals(assessment.riskLevel);
        boolean checking = "Checking".equals(assessment.label);
        messageBubble.setVisibility(idle ? View.GONE : View.VISIBLE);
        messageBubble.setBackgroundResource(backgroundForRisk(assessment.riskLevel, assessment.band));
        scoreDot.setBackgroundResource(dotForRisk(assessment.riskLevel, assessment.band));

        if (checking) {
            label.setText("Checking...");
            summary.setText("Scanning visible post");
        } else if (idle) {
            label.setText("");
            summary.setText("");
        } else {
            label.setText(scoreText(assessment));
            summary.setText(shortSummary(assessment));
        }
    }

    void remove() {
        if (bubble != null && bubble.getParent() != null) windowManager.removeView(bubble);
    }

    void hideTemporarily() {
        remove();
    }

    private void createBubble() {
        bubble = new LinearLayout(context);
        bubble.setOrientation(LinearLayout.HORIZONTAL);
        bubble.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        bubble.setPadding(0, 0, 0, 0);
        bubble.setClickable(true);
        bubble.setElevation(dp(10));

        messageBubble = new LinearLayout(context);
        messageBubble.setOrientation(LinearLayout.VERTICAL);
        messageBubble.setPadding(dp(16), dp(10), dp(16), dp(10));
        messageBubble.setMinimumWidth(dp(190));
        messageBubble.setElevation(dp(8));

        LinearLayout labelRow = new LinearLayout(context);
        labelRow.setOrientation(LinearLayout.HORIZONTAL);
        labelRow.setGravity(Gravity.CENTER_VERTICAL);

        scoreDot = new View(context);
        labelRow.addView(scoreDot, new LinearLayout.LayoutParams(dp(24), dp(24)));

        label = new TextView(context);
        label.setTextColor(0xFF182235);
        label.setTextSize(24);
        label.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        label.setPadding(dp(10), 0, 0, 0);
        labelRow.addView(label);
        messageBubble.addView(labelRow);

        summary = new TextView(context);
        summary.setTextColor(0xFF5F6B7E);
        summary.setTextSize(14);
        summary.setPadding(0, dp(5), 0, 0);
        messageBubble.addView(summary);
        bubble.addView(messageBubble);

        logoOrb = new LinearLayout(context);
        logoOrb.setGravity(Gravity.CENTER);
        logoOrb.setBackgroundResource(R.drawable.logo_bubble_bg);
        logoOrb.setElevation(dp(12));
        logoOrb.setPadding(dp(8), dp(8), dp(8), dp(8));

        ImageView logoImage = new ImageView(context);
        logoImage.setImageResource(R.drawable.ic_launcher);
        logoImage.setAdjustViewBounds(true);
        logoImage.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        logoOrb.addView(logoImage, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout.LayoutParams orbParams = new LinearLayout.LayoutParams(dp(62), dp(62));
        orbParams.setMargins(dp(10), 0, 0, 0);
        bubble.addView(logoOrb, orbParams);

        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.END;
        params.x = dp(14);
        params.y = dp(120);

        bubble.setOnClickListener(view -> {
            if (dragging) return;
            Intent intent = new Intent(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.putExtra(MainActivity.EXTRA_SHOW_DETAILS, true);
            context.startActivity(intent);
        });

        bubble.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                downX = event.getRawX();
                downY = event.getRawY();
                startX = params.x;
                startY = params.y;
                dragging = false;
                return false;
            }
            if (event.getAction() == MotionEvent.ACTION_MOVE) {
                float dx = event.getRawX() - downX;
                float dy = event.getRawY() - downY;
                if (Math.hypot(dx, dy) > dp(8)) {
                    dragging = true;
                    params.x = Math.max(0, startX - Math.round(dx));
                    params.y = Math.max(0, startY + Math.round(dy));
                    try {
                        windowManager.updateViewLayout(bubble, params);
                    } catch (RuntimeException ignored) {
                    }
                }
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_UP || event.getAction() == MotionEvent.ACTION_CANCEL) {
                if (dragging) {
                    view.postDelayed(() -> dragging = false, 120);
                    return true;
                }
            }
            return false;
        });
    }

    private String shortSummary(Assessment assessment) {
        if ("low".equals(assessment.riskLevel)) return "Reliable";
        if ("medium".equals(assessment.riskLevel)) return "Needs context";
        if ("high".equals(assessment.riskLevel)) return "Misleading";
        return assessment.plainLanguageSummary;
    }

    private String scoreText(Assessment assessment) {
        int display = Math.max(0, Math.min(100, assessment.score));
        if ("high".equals(assessment.riskLevel)) {
            return display + "% Risk";
        }
        return display + "%";
    }

    private int backgroundForRisk(String riskLevel, String band) {
        if ("low".equals(riskLevel) || "green".equals(band)) return R.drawable.bubble_low;
        if ("high".equals(riskLevel) || "red".equals(band)) return R.drawable.bubble_high;
        if ("medium".equals(riskLevel) || "yellow".equals(band)) return R.drawable.bubble_medium;
        return R.drawable.bubble_waiting;
    }

    private int dotForRisk(String riskLevel, String band) {
        if ("low".equals(riskLevel) || "green".equals(band)) return R.drawable.score_dot_low;
        if ("high".equals(riskLevel) || "red".equals(band)) return R.drawable.score_dot_high;
        if ("medium".equals(riskLevel) || "yellow".equals(band)) return R.drawable.score_dot_medium;
        return R.drawable.score_dot_waiting;
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    static Intent overlaySettingsIntent(Context context) {
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + context.getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }
}
