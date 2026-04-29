package com.teamopenspot.trustbubble;

public interface ScrollPauseListener {
    void onScrolling(String packageName);

    void onPaused(String packageName, long lastScrollUptimeMillis);

    void onPackageChanged(String oldPackageName, String newPackageName);
}
