package au.z2hs.trustlens;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import android.text.format.DateFormat;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.util.Date;

public final class TrustLensAccessibilityService extends AccessibilityService {
    private static final long SCROLL_PAUSE_MS = 1500L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final VisibleContentExtractor extractor = new VisibleContentExtractor();
    private BackendClient backendClient;
    private OverlayBubbleController overlay;
    private String lastSignature = "";
    private String pendingSignature = "";

    private final Runnable assessVisibleContent = this::runAssessment;

    @Override
    protected void onServiceConnected() {
        backendClient = new BackendClient(this);
        overlay = new OverlayBubbleController(this);
        if (overlay.canDraw()) {
            TrustLensPrefs.storeDebugStatus(this, timestamp() + " Accessibility service connected. Waiting for scroll/content events.");
            overlay.show(Assessment.waiting("TrustLens is watching for a pause."));
        } else {
            TrustLensPrefs.storeDebugStatus(this, timestamp() + " Accessibility service connected, but overlay permission is not enabled.");
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!TrustLensPrefs.isEnabled(this)) {
            TrustLensPrefs.storeDebugStatus(this, timestamp() + " Event received, but TrustLens is switched off.");
            if (overlay != null) overlay.remove();
            return;
        }
        TrustLensPrefs.storeDebugStatus(
            this,
            timestamp()
                + " Event received: type="
                + eventTypeName(event.getEventType())
                + ", package="
                + event.getPackageName()
                + ". Waiting 1.5 seconds before capture."
        );
        if (overlay == null || !overlay.canDraw()) {
            TrustLensPrefs.storeDebugStatus(
                this,
                timestamp()
                    + " Event received from "
                    + event.getPackageName()
                    + ", but overlay permission is not enabled."
            );
        }
        handler.removeCallbacks(assessVisibleContent);
        handler.postDelayed(assessVisibleContent, SCROLL_PAUSE_MS);
    }

    @Override
    public void onInterrupt() {
        handler.removeCallbacks(assessVisibleContent);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(assessVisibleContent);
        if (overlay != null) overlay.remove();
        super.onDestroy();
    }

    private void runAssessment() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            CapturePayload payload = extractor.extract(root, getLastPackageName(root));
            captureScreenshotThenAssess(payload, root);
        } catch (RuntimeException error) {
            TrustLensPrefs.storeDebugStatus(this, timestamp() + " Capture crashed safely: " + error.getMessage());
        }
    }

    private void captureScreenshotThenAssess(CapturePayload payload, AccessibilityNodeInfo root) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            TrustLensPrefs.storeDebugStatus(
                this,
                timestamp() + " Screenshot capture needs Android 11 or newer. Falling back to visible text only."
            );
            assessPayload(payload, root);
            return;
        }

        TrustLensPrefs.storeDebugStatus(this, timestamp() + " Pause detected. Capturing screenshot before backend check.");
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult screenshotResult) {
                    try {
                        Bitmap bitmap = Bitmap.wrapHardwareBuffer(
                            screenshotResult.getHardwareBuffer(),
                            screenshotResult.getColorSpace()
                        );
                        if (bitmap != null) {
                            payload.screenshotDataUrl = bitmapToDataUrl(bitmap);
                        }
                        screenshotResult.getHardwareBuffer().close();
                        TrustLensPrefs.storeDebugStatus(
                            TrustLensAccessibilityService.this,
                            timestamp()
                                + " Screenshot captured. dataUrlChars="
                                + payload.screenshotDataUrl.length()
                        );
                    } catch (RuntimeException error) {
                        TrustLensPrefs.storeDebugStatus(
                            TrustLensAccessibilityService.this,
                            timestamp() + " Screenshot capture failed while encoding: " + error.getMessage()
                        );
                    }
                    assessPayload(payload, root);
                }

                @Override
                public void onFailure(int errorCode) {
                    TrustLensPrefs.storeDebugStatus(
                        TrustLensAccessibilityService.this,
                        timestamp() + " Screenshot capture failed with code " + errorCode + ". Falling back to visible text only."
                    );
                    assessPayload(payload, root);
                }
            });
        } catch (RuntimeException error) {
            TrustLensPrefs.storeDebugStatus(
                this,
                timestamp() + " Screenshot request failed: " + error.getMessage() + ". Falling back to visible text only."
            );
            assessPayload(payload, root);
        }
    }

    private void assessPayload(CapturePayload payload, AccessibilityNodeInfo root) {
        if (!payload.hasUsefulEvidence()) {
            TrustLensPrefs.storeDebugStatus(
                this,
                timestamp()
                    + " Capture attempted, but no useful text/link/media was found. Root="
                    + (root == null ? "null" : "available")
                    + ", textChars="
                    + payload.visibleText.length()
                    + ", links="
                    + payload.visibleLinks.size()
                    + ", mediaSignals="
                    + payload.mediaSignals.size()
            );
            if (overlay != null) overlay.show(Assessment.waiting("No readable post text found yet."));
            return;
        }
        String signature = payload.signature();
        if (signature.equals(lastSignature) || signature.equals(pendingSignature)) {
            TrustLensPrefs.storeDebugStatus(
                this,
                timestamp()
                    + " Same visible content already checked, so no new backend call was made. textChars="
                    + payload.visibleText.length()
                    + ", links="
                    + payload.visibleLinks.size()
            );
            return;
        }
        pendingSignature = signature;

        TrustLensPrefs.storeDebugStatus(
            this,
            timestamp()
                + " Capture ready. Sending to backend. textChars="
                + payload.visibleText.length()
                + ", links="
                + payload.visibleLinks.size()
                + ", mediaSignals="
                + payload.mediaSignals.size()
                + ", package="
                + payload.packageName
        );
        if (overlay != null) overlay.show(Assessment.loading());
        backendClient.assess(payload, assessment -> handler.post(() -> {
            lastSignature = signature;
            pendingSignature = "";
            TrustLensPrefs.storeDebugStatus(
                this,
                timestamp()
                    + " Backend returned: "
                    + assessment.label
                    + " / "
                    + assessment.riskLevel
                    + " risk."
            );
            if (overlay != null) overlay.show(assessment);
        }));
    }

    private String bitmapToDataUrl(Bitmap bitmap) {
        int maxWidth = 720;
        Bitmap output = bitmap.copy(Bitmap.Config.ARGB_8888, false);
        if (bitmap.getWidth() > maxWidth) {
            int width = maxWidth;
            int height = Math.max(1, Math.round(bitmap.getHeight() * (width / (float) bitmap.getWidth())));
            Bitmap scaled = Bitmap.createScaledBitmap(output, width, height, true);
            if (!output.isRecycled()) output.recycle();
            output = scaled;
        }

        ByteArrayOutputStream stream = new ByteArrayOutputStream();
        output.compress(Bitmap.CompressFormat.JPEG, 72, stream);
        saveScreenshotPreview(stream.toByteArray());
        if (!output.isRecycled()) output.recycle();
        String base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP);
        return "data:image/jpeg;base64," + base64;
    }

    private void saveScreenshotPreview(byte[] bytes) {
        try {
            File file = new File(getCacheDir(), "last-trustlens-screenshot.jpg");
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
            }
            TrustLensPrefs.storeLastScreenshotPath(this, file.getAbsolutePath());
        } catch (Exception error) {
            TrustLensPrefs.storeDebugStatus(this, timestamp() + " Screenshot preview save failed: " + error.getMessage());
        }
    }

    private CharSequence getLastPackageName(AccessibilityNodeInfo root) {
        return root == null ? "" : root.getPackageName();
    }

    private String timestamp() {
        return DateFormat.getTimeFormat(this).format(new Date());
    }

    private String eventTypeName(int type) {
        if (type == AccessibilityEvent.TYPE_VIEW_SCROLLED) return "VIEW_SCROLLED";
        if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return "WINDOW_CONTENT_CHANGED";
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return "WINDOW_STATE_CHANGED";
        return String.valueOf(type);
    }
}
