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
import android.widget.LinearLayout;
import android.widget.TextView;

final class OverlayBubbleController {
    private final Context context;
    private final WindowManager windowManager;
    private static LinearLayout bubble;
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
        label.setText(assessment.label);
        summary.setText(shortSummary(assessment));
        bubble.setBackgroundResource(backgroundForRisk(assessment.riskLevel, assessment.band));
    }

    void remove() {
        if (bubble != null && bubble.getParent() != null) windowManager.removeView(bubble);
    }

    private void createBubble() {
        bubble = new LinearLayout(context);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(dp(18), dp(12), dp(18), dp(12));
        bubble.setMinimumWidth(dp(168));
        bubble.setClickable(true);
        bubble.setElevation(dp(10));

        label = new TextView(context);
        label.setTextColor(0xFF182235);
        label.setTextSize(20);
        label.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        bubble.addView(label);

        summary = new TextView(context);
        summary.setTextColor(0xFF5F6B7E);
        summary.setTextSize(13);
        bubble.addView(summary);

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
        if ("low".equals(assessment.riskLevel)) return "Looks safer";
        if ("medium".equals(assessment.riskLevel)) return "Check before sharing";
        if ("high".equals(assessment.riskLevel)) return "Do not click yet";
        return assessment.plainLanguageSummary;
    }

    private int backgroundForRisk(String riskLevel, String band) {
        if ("low".equals(riskLevel) || "green".equals(band)) return R.drawable.bubble_low;
        if ("high".equals(riskLevel) || "red".equals(band)) return R.drawable.bubble_high;
        if ("medium".equals(riskLevel) || "yellow".equals(band)) return R.drawable.bubble_medium;
        return R.drawable.bubble_waiting;
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
