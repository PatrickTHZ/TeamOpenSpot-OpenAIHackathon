package com.teamopenspot.trustbubble;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

public class TrustAccessibilityService extends AccessibilityService {
    private ScrollPauseDetector scrollPauseDetector;
    private VisibleContentCapture visibleContentCapture;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();

        scrollPauseDetector = new ScrollPauseDetector();
        visibleContentCapture = new VisibleContentCapture();
        scrollPauseDetector.setListener(new ScrollPauseListener() {
            @Override
            public void onScrolling(String packageName) {
                // Logcat demo only. Future work can update an overlay bubble here.
            }

            @Override
            public void onPaused(String packageName, long lastScrollUptimeMillis) {
                captureVisibleContent(packageName, lastScrollUptimeMillis);
            }

            @Override
            public void onPackageChanged(String oldPackageName, String newPackageName) {
                // Logcat output is emitted by the detector for the hackathon demo.
            }
        });

        AccessibilityServiceInfo serviceInfo = new AccessibilityServiceInfo();
        serviceInfo.eventTypes = AccessibilityEvent.TYPE_VIEW_SCROLLED
                | AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
        serviceInfo.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        serviceInfo.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
        serviceInfo.notificationTimeout = 100;
        serviceInfo.packageNames = ScrollPauseDetector.getMonitoredPackageArray();
        setServiceInfo(serviceInfo);

        Log.d(ScrollPauseDetector.LOG_TAG, "Trust Accessibility Service connected.");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (scrollPauseDetector != null) {
            scrollPauseDetector.handleAccessibilityEvent(event);
        }
    }

    @Override
    public void onInterrupt() {
        Log.d(ScrollPauseDetector.LOG_TAG, "Trust Accessibility Service interrupted.");
    }

    private void captureVisibleContent(String packageName, long lastScrollUptimeMillis) {
        if (visibleContentCapture == null) {
            return;
        }

        AccessibilityNodeInfo rootNode = getRootInActiveWindow();
        if (rootNode == null) {
            Log.d(ScrollPauseDetector.LOG_TAG, "No accessibility root available for " + packageName + ".");
            return;
        }

        try {
            CapturedVisibleContent content = visibleContentCapture.capture(
                    rootNode,
                    packageName,
                    lastScrollUptimeMillis
            );
            Log.d(
                    ScrollPauseDetector.LOG_TAG,
                    "Captured visible content from " + packageName
                            + ": textNodes=" + content.getCapturedTextNodeCount()
                            + ", scannedNodes=" + content.getScannedNodeCount()
                            + ", links=" + content.getExtractedLinks().size()
                            + ", preview=\"" + content.getTextPreview() + "\""
            );
            Log.d(ScrollPauseDetector.LOG_TAG, "Backend payload preview: " + content.toBackendAssessRequestJsonString());
        } finally {
            rootNode.recycle();
        }
    }

    @Override
    public void onDestroy() {
        if (scrollPauseDetector != null) {
            scrollPauseDetector.destroy();
            scrollPauseDetector = null;
        }
        visibleContentCapture = null;

        Log.d(ScrollPauseDetector.LOG_TAG, "Trust Accessibility Service destroyed.");
        super.onDestroy();
    }
}
