package com.teamopenspot.trustbubble;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

public class ScrollPauseDetector {
    public static final String LOG_TAG = "TrustBubble";

    public static final int STATE_IDLE = 0;
    public static final int STATE_SCROLLING = 1;
    public static final int STATE_PAUSED = 2;

    public static final long DEFAULT_PAUSE_THRESHOLD_MS = 1500L;

    private static final Set<String> MONITORED_PACKAGES = createMonitoredPackages();

    private final Handler mainHandler;
    private final long pauseThresholdMs;
    private final Runnable pauseRunnable;

    private ScrollPauseListener listener;
    private String currentPackageName;
    private long lastScrollTime;
    private int currentState = STATE_IDLE;
    private boolean destroyed;

    public ScrollPauseDetector() {
        this(DEFAULT_PAUSE_THRESHOLD_MS);
    }

    public ScrollPauseDetector(long pauseThresholdMs) {
        this.pauseThresholdMs = pauseThresholdMs > 0 ? pauseThresholdMs : DEFAULT_PAUSE_THRESHOLD_MS;
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.pauseRunnable = new Runnable() {
            @Override
            public void run() {
                handlePauseTimeout();
            }
        };
    }

    public void setListener(ScrollPauseListener listener) {
        this.listener = listener;
    }

    public void handleAccessibilityEvent(AccessibilityEvent event) {
        if (destroyed || event == null) {
            return;
        }

        String eventPackageName = getPackageName(event);
        if (!isMonitoredPackage(eventPackageName)) {
            resetIfPackageMovedOutsideMonitorSet(eventPackageName);
            return;
        }

        updatePackageIfNeeded(eventPackageName);

        int eventType = event.getEventType();
        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            resetStateForWindowChange();
            return;
        }

        if (eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
            handleScrollEvent(eventPackageName);
        }
    }

    public void destroy() {
        destroyed = true;
        mainHandler.removeCallbacks(pauseRunnable);
        listener = null;
        currentPackageName = null;
        currentState = STATE_IDLE;
        lastScrollTime = 0L;
    }

    public int getCurrentState() {
        return currentState;
    }

    public static String[] getMonitoredPackageArray() {
        return MONITORED_PACKAGES.toArray(new String[0]);
    }

    public static boolean isMonitoredPackage(String packageName) {
        return packageName != null && MONITORED_PACKAGES.contains(packageName);
    }

    private void handleScrollEvent(String packageName) {
        lastScrollTime = SystemClock.uptimeMillis();

        if (currentState != STATE_SCROLLING) {
            currentState = STATE_SCROLLING;
            notifyScrolling(packageName);
        }

        mainHandler.removeCallbacks(pauseRunnable);
        mainHandler.postDelayed(pauseRunnable, pauseThresholdMs);
    }

    private void handlePauseTimeout() {
        if (destroyed || currentPackageName == null || lastScrollTime <= 0L) {
            return;
        }

        long elapsedSinceLastScroll = SystemClock.uptimeMillis() - lastScrollTime;
        if (elapsedSinceLastScroll < pauseThresholdMs) {
            mainHandler.postDelayed(pauseRunnable, pauseThresholdMs - elapsedSinceLastScroll);
            return;
        }

        if (currentState == STATE_PAUSED) {
            return;
        }

        currentState = STATE_PAUSED;
        notifyPaused(currentPackageName, lastScrollTime);
    }

    private void updatePackageIfNeeded(String newPackageName) {
        if (newPackageName == null || newPackageName.equals(currentPackageName)) {
            return;
        }

        String oldPackageName = currentPackageName;
        currentPackageName = newPackageName;
        resetScrollState();

        if (oldPackageName != null) {
            Log.d(LOG_TAG, "Package changed from " + oldPackageName + " to " + newPackageName);
        }

        if (listener != null) {
            listener.onPackageChanged(oldPackageName, newPackageName);
        }
    }

    private void resetIfPackageMovedOutsideMonitorSet(String newPackageName) {
        if (newPackageName == null || currentPackageName == null || newPackageName.equals(currentPackageName)) {
            return;
        }

        String oldPackageName = currentPackageName;
        currentPackageName = null;
        resetScrollState();
        Log.d(LOG_TAG, "Package changed from " + oldPackageName + " to " + newPackageName);

        if (listener != null) {
            listener.onPackageChanged(oldPackageName, newPackageName);
        }
    }

    private void resetStateForWindowChange() {
        resetScrollState();
        Log.d(LOG_TAG, "Window state changed in " + currentPackageName + ". Scroll detector reset.");
    }

    private void resetScrollState() {
        mainHandler.removeCallbacks(pauseRunnable);
        currentState = STATE_IDLE;
        lastScrollTime = 0L;
    }

    private void notifyScrolling(String packageName) {
        Log.d(LOG_TAG, "SCROLLING in " + packageName);
        if (listener != null) {
            listener.onScrolling(packageName);
        }
    }

    private void notifyPaused(String packageName, long lastScrollUptimeMillis) {
        Log.d(LOG_TAG, "PAUSED in " + packageName + ". Ready to analyse visible content.");
        if (listener != null) {
            listener.onPaused(packageName, lastScrollUptimeMillis);
        }
    }

    private static String getPackageName(AccessibilityEvent event) {
        CharSequence packageName = event.getPackageName();
        return packageName == null ? null : packageName.toString();
    }

    private static Set<String> createMonitoredPackages() {
        Set<String> packageNames = new HashSet<>();
        packageNames.add("com.facebook.katana");
        packageNames.add("com.instagram.android");
        packageNames.add("com.zhiliaoapp.musically");
        packageNames.add("com.twitter.android");
        packageNames.add("com.google.android.youtube");
        packageNames.add("com.android.chrome");
        packageNames.add("org.mozilla.firefox");
        return Collections.unmodifiableSet(packageNames);
    }
}
