package au.z2hs.trustlens;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BackendClient {
    interface Callback {
        void onResult(Assessment assessment);
    }

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    BackendClient(Context context) {
        this.context = context.getApplicationContext();
    }

    void assess(CapturePayload payload, Callback callback) {
        TrustLensPrefs.storeCapture(context, payload);
        executor.execute(() -> {
            Assessment assessment;
            try {
                assessment = postAssessment(payload);
            } catch (Exception error) {
                assessment = Assessment.fallback(error.getMessage() == null ? "Backend unavailable." : error.getMessage());
            }
            TrustLensPrefs.storeAssessment(context, assessment);
            callback.onResult(assessment);
        });
    }

    private Assessment postAssessment(CapturePayload payload) throws Exception {
        URL url = new URL(TrustLensPrefs.backendUrl(context) + "/v1/assess");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(12000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");

        byte[] body = payload.toAssessJson().toString().getBytes(StandardCharsets.UTF_8);
        TrustLensPrefs.storeDebugStatus(
            context,
            "Sending backend request. bytes="
                + body.length
                + ", screenshot="
                + (!payload.screenshotDataUrl.trim().isEmpty())
                + ", visibleTextChars="
                + payload.visibleText.length()
                + ", links="
                + payload.visibleLinks.size()
        );
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body);
        }

        int status = connection.getResponseCode();
        BufferedReader reader = new BufferedReader(new InputStreamReader(
            status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream(),
            StandardCharsets.UTF_8
        ));
        StringBuilder response = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) response.append(line);
        connection.disconnect();

        if (status < 200 || status >= 300) {
            throw new IllegalStateException("Backend returned " + status);
        }

        return Assessment.fromJson(new JSONObject(response.toString()), payload.visibleLinks);
    }
}
