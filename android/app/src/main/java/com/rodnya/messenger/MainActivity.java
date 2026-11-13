package com.rodnya.messenger;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    public static volatile boolean isAppInForeground = false;
    public static volatile String pendingCallDataString = null;
    public static volatile boolean pendingAutoAnswer = false;

    public class AndroidBridge {
        @JavascriptInterface
        public void saveCredentials(String serverUrl, String token, String roomId, String username, String displayName) {
            SharedPreferences prefs = getSharedPreferences("RodnyaPrefs", Context.MODE_PRIVATE);
            prefs.edit()
                .putString("serverUrl", serverUrl)
                .putString("token", token)
                .putString("roomId", roomId)
                .putString("username", username)
                .putString("displayName", displayName)
                .apply();

            if (MessengerBackgroundService.getInstance() != null) {
                MessengerBackgroundService.getInstance().initSocketConnection();
            }
        }

        @JavascriptInterface
        public void stopRinging() {
            if (MessengerBackgroundService.getInstance() != null) {
                MessengerBackgroundService.getInstance().stopCallRinging();
            }
        }

        @JavascriptInterface
        public String getPendingCallData() {
            String data = pendingCallDataString;
            pendingCallDataString = null;
            return data != null ? data : "";
        }

        @JavascriptInterface
        public boolean shouldAutoAnswer() {
            boolean auto = pendingAutoAnswer;
            pendingAutoAnswer = false;
            return auto;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Set status bar and navigation bar colors
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#1e293b"));
            getWindow().setNavigationBarColor(Color.parseColor("#0f172a"));
        }

        // Apply system window insets so top status bar and camera cutouts don't overlap the app
        View rootView = findViewById(android.R.id.content);
        if (rootView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootView, (view, windowInsets) -> {
                Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
        }

        // Start Foreground Service for reliable background calls and notifications
        try {
            Intent serviceIntent = new Intent(this, MessengerBackgroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception ignored) {}

        // Enable WebRTC audio autoplay and grant permissions directly to WebView
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebSettings webSettings = getBridge().getWebView().getSettings();
                webSettings.setMediaPlaybackRequiresUserGesture(false);

                getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public void onPermissionRequest(final PermissionRequest request) {
                        runOnUiThread(() -> {
                            request.grant(request.getResources());
                        });
                    }
                });

                // Inject native Android bridge into WebView
                getBridge().getWebView().addJavascriptInterface(new AndroidBridge(), "AndroidApp");
            }
        } catch (Exception ignored) {}

        // Configure audio manager for VoIP communication
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                audioManager.setSpeakerphoneOn(true);
            }
        } catch (Exception ignored) {}

        // Request runtime permissions for audio calls, camera, and notifications (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> permissions = new ArrayList<>();
            permissions.add(Manifest.permission.RECORD_AUDIO);
            permissions.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
            permissions.add(Manifest.permission.CAMERA);
            if (Build.VERSION.SDK_INT >= 33) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }

            List<String> needRequest = new ArrayList<>();
            for (String perm : permissions) {
                if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                    needRequest.add(perm);
                }
            }
            if (!needRequest.isEmpty()) {
                ActivityCompat.requestPermissions(this, needRequest.toArray(new String[0]), 101);
            }
        }

        checkBatteryOptimizations();
        handleIncomingCallIntent(getIntent());
    }

    private void checkBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception ignored) {}
        }
    }

    private void handleIncomingCallIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if ("com.rodnya.messenger.ANSWER_CALL".equals(action) || "com.rodnya.messenger.VIEW_CALL".equals(action)) {
            boolean autoAnswer = "com.rodnya.messenger.ANSWER_CALL".equals(action);
            String callData = intent.getStringExtra("callData");
            if ((callData == null || callData.isEmpty()) && MessengerBackgroundService.pendingCallData != null) {
                callData = MessengerBackgroundService.pendingCallData.toString();
            }
            if (callData != null && !callData.isEmpty()) {
                pendingCallDataString = callData;
                pendingAutoAnswer = autoAnswer;
                final String finalCallData = callData;
                final boolean finalAuto = autoAnswer;
                runOnUiThread(() -> {
                    try {
                        if (getBridge() != null && getBridge().getWebView() != null) {
                            getBridge().getWebView().evaluateJavascript(
                                "if (window.handleNativeIncomingCall) { window.handleNativeIncomingCall(" + finalCallData + ", " + finalAuto + "); }",
                                null
                            );
                        }
                    } catch (Exception ignored) {}
                });
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppInForeground = true;
        if (MessengerBackgroundService.getInstance() != null) {
            MessengerBackgroundService.getInstance().stopCallRinging();
        }
        if (getIntent() != null) {
            handleIncomingCallIntent(getIntent());
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        isAppInForeground = false;
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingCallIntent(intent);
    }
}