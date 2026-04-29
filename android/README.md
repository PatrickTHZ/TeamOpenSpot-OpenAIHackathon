# TrustLens Android Prototype

Native Android companion app for the TrustLens flow:

```text
User opens Facebook/web feed
-> Trust Bubble appears
-> user scrolls
-> app waits, no capture
-> user pauses for 1.5 seconds
-> accessibility service reads visible post text, image descriptions, and links
-> backend risk agent analyses the evidence
-> bubble shows Low / Medium / High risk
-> user taps bubble for plain explanation and advice
```

## What It Builds

- `MainActivity` - setup screen, backend URL settings, latest risk explanation, and design-theme walkthrough.
- `TrustLensAccessibilityService` - listens for scroll/content events and waits 1.5 seconds before capture.
- `VisibleContentExtractor` - extracts visible text, URL-like links, app/source signals, and image/video descriptions from the active window.
- `BackendClient` - posts to `/v1/assess` using the shared backend contract.
- `OverlayBubbleController` - always-available floating Trust Bubble that opens the explanation screen when tapped.

## Run Locally

1. Open `android/` in Android Studio.
2. Sync Gradle.
3. Start the backend from `../backend`.
4. Run the app on an emulator or device.
5. In the app:
   - allow the floating bubble overlay permission
   - open Android Accessibility settings
   - enable `TrustLens feed helper`
6. Open Facebook, Chrome, or another feed app and pause scrolling for 1.5 seconds.

The default backend URL is `https://trustlens.z2hs.au`, matching the shared deployment docs. For local backend testing on an emulator, change it in the app to `http://10.0.2.2:8787`.

## Debug The Captured Post

Open TrustLens and look at `Protection` -> `Capture diagnostics`.

That status tells you which stage is failing:

- `No accessibility event seen yet` means the Accessibility Service is not enabled, was killed, or has not seen any supported app event.
- `Event received... Waiting 1.5 seconds before capture` means scrolling/content changes are detected.
- `Pause detected. Capturing screenshot before backend check` means the screenshot path has started.
- `Screenshot captured` means the app encoded a PNG screenshot into `imageCrop.dataUrl`.
- `Sending backend request... screenshot=true` means the actual API request includes the screenshot.
- `Capture attempted, but no useful text/link/media was found` means the service ran, but Android did not expose readable content for that screen.
- `Capture ready. Sending to backend` means it captured data and made the backend call.
- `Capture matched the previous payload` means it saw the same post again and skipped a duplicate backend call.
- `Backend returned...` means the full loop worked.

Open TrustLens and scroll to `Latest check`. The `Last captured payload` box shows the exact JSON sent to the backend.

If nothing has been captured yet:

- confirm `Allow floating bubble` is enabled
- tap `Test floating bubble`; if no bubble appears, the overlay permission is still the problem
- confirm `TrustLens feed helper` is enabled in Android Accessibility settings
- open Facebook/Chrome, scroll, then stop for at least 1.5 seconds
- return to TrustLens and check `Last captured payload`

For a quick backend test without opening Facebook, tap `Run mock post test`. It sends this mock Facebook-style post:

```text
Carol Johnson
Walking 10,000 steps a day can reverse aging and add 10 years to your life, new study claims.
Limited time health report. Click the link now before it is removed.
Link: https://bit.ly/secret-health-report
Image description: smiling older couple walking in a park.
```

## Privacy Shape

This prototype does not capture while scrolling. It only reads the active visible accessibility tree after the pause timer fires. It sends visible text, URL-like links, coarse app/source signals, and readable image/video descriptions to the backend.

Android accessibility access is powerful, so the production app should include a concise onboarding screen, clear consent language, and a persistent off switch.
