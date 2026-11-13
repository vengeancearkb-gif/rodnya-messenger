package com.rodnya.messenger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import io.socket.client.IO;
import io.socket.client.Socket;
import org.json.JSONObject;

public class MessengerBackgroundService extends Service {
    public static final String CHANNEL_SERVICE_ID = "rodnya_service_channel";
    public static final String CHANNEL_CALLS_ID = "rodnya_calls_channel";
    public static final String CHANNEL_MESSAGES_ID = "rodnya_messages_channel";

    public static final int NOTIFICATION_SERVICE_ID = 1001;
    public static final int NOTIFICATION_CALL_ID = 2002;

    public static volatile JSONObject pendingCallData = null;

    private static MessengerBackgroundService instance;
    private Socket socket;
    private Ringtone currentRingtone;
    private Vibrator vibrator;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        createNotificationChannels();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_SERVICE_ID,
                buildForegroundNotification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL |
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            );
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_SERVICE_ID,
                buildForegroundNotification(),
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            );
        } else {
            startForeground(NOTIFICATION_SERVICE_ID, buildForegroundNotification());
        }
        initSocketConnection();
    }

    public static MessengerBackgroundService getInstance() {
        return instance;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (socket == null || !socket.connected()) {
            initSocketConnection();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // 1. Silent Background Service Channel
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_SERVICE_ID,
                    "Фоновая служба связи",
                    NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("Поддерживает подключение для мгновенных звонков и сообщений");
            serviceChannel.setShowBadge(false);
            nm.createNotificationChannel(serviceChannel);

            // 2. High-Priority Calls Channel
            NotificationChannel callChannel = new NotificationChannel(
                    CHANNEL_CALLS_ID,
                    "Входящие звонки",
                    NotificationManager.IMPORTANCE_HIGH
            );
            callChannel.setDescription("Звук и уведомления входящих аудиозвонков");
            callChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build();
            callChannel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), audioAttributes);
            callChannel.enableVibration(true);
            callChannel.setVibrationPattern(new long[]{0, 1000, 1000, 1000, 1000});
            nm.createNotificationChannel(callChannel);

            // 3. Messages Channel
            NotificationChannel msgChannel = new NotificationChannel(
                    CHANNEL_MESSAGES_ID,
                    "Сообщения",
                    NotificationManager.IMPORTANCE_HIGH
            );
            msgChannel.setDescription("Уведомления о новых сообщениях");
            msgChannel.enableVibration(true);
            nm.createNotificationChannel(msgChannel);
        }
    }

    private Notification buildForegroundNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_SERVICE_ID)
                .setContentTitle("Родня — Мессенджер")
                .setContentText("На связи для звонков и сообщений")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();
    }

    public synchronized void initSocketConnection() {
        try {
            SharedPreferences prefs = getSharedPreferences("RodnyaPrefs", Context.MODE_PRIVATE);
            String serverUrl = prefs.getString("serverUrl", "https://rodnya-messenger.onrender.com");
            String token = prefs.getString("token", "");
            String roomId = prefs.getString("roomId", "semya");
            String username = prefs.getString("username", "android");
            String displayName = prefs.getString("displayName", "Android");

            if (socket != null) {
                socket.disconnect();
                socket.off();
            }

            IO.Options options = IO.Options.builder()
                    .setTransports(new String[]{"websocket", "polling"})
                    .setReconnection(true)
                    .setReconnectionDelay(1500)
                    .setReconnectionDelayMax(5000)
                    .setTimeout(10000)
                    .build();

            socket = IO.socket(serverUrl, options);

            socket.on(Socket.EVENT_CONNECT, args -> {
                try {
                    JSONObject joinData = new JSONObject();
                    joinData.put("token", token);
                    joinData.put("username", username);
                    joinData.put("displayName", displayName);
                    joinData.put("roomId", roomId);
                    joinData.put("isNativeBackground", true);
                    socket.emit("join-room", joinData);
                } catch (Exception ignored) {}
            });

            // Handle incoming calls while app is closed or in background
            socket.on("call-incoming", args -> {
                if (args.length > 0 && args[0] instanceof JSONObject) {
                    JSONObject data = (JSONObject) args[0];
                    String fromUserId = data.optString("fromUserId");
                    String fromUsername = data.optString("fromUsername", "Родственник");

                    pendingCallData = data;

                    if (!MainActivity.isAppInForeground) {
                        showIncomingCallNotification(fromUserId, fromUsername, data);
                    }
                }
            });

            // Handle call ended / rejected
            socket.on("call-ended", args -> stopCallRinging());
            socket.on("call-rejected", args -> stopCallRinging());

            // Handle new messages in background
            socket.on("new-message", args -> {
                if (args.length > 0 && args[0] instanceof JSONObject) {
                    JSONObject msg = (JSONObject) args[0];
                    String senderName = msg.optString("senderName", "Новое сообщение");
                    String senderUsername = msg.optString("senderUsername", "");
                    String type = msg.optString("type", "text");
                    String text = msg.optString("text", "");

                    // Only notify if not mine and app is backgrounded
                    if (!MainActivity.isAppInForeground && !senderUsername.equalsIgnoreCase(username)) {
                        String bodyText = "Текстовое сообщение";
                        if ("voice".equals(type)) {
                            bodyText = "🎙️ Голосовое сообщение";
                        } else if ("image".equals(type)) {
                            bodyText = "📷 Фотография";
                        } else if ("file".equals(type)) {
                            bodyText = "📄 Файл";
                        } else if (!text.isEmpty()) {
                            bodyText = text;
                        }
                        showMessageNotification(senderName, bodyText);
                    }
                }
            });

            socket.connect();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void showIncomingCallNotification(String fromUserId, String fromUsername, JSONObject data) {
        // Wake up screen
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock wl = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                        "rodnya:incoming_call"
                );
                wl.acquire(20000);
            }
        } catch (Exception ignored) {}

        // Play phone ringtone
        try {
            if (currentRingtone == null) {
                Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                currentRingtone = RingtoneManager.getRingtone(getApplicationContext(), ringtoneUri);
            }
            if (currentRingtone != null && !currentRingtone.isPlaying()) {
                currentRingtone.play();
            }
        } catch (Exception ignored) {}

        // Vibrate
        try {
            if (vibrator != null) {
                long[] pattern = {0, 1000, 800, 1000, 800};
                vibrator.vibrate(pattern, 1);
            }
        } catch (Exception ignored) {}

        String dataString = (data != null) ? data.toString() : "";

        // Intent to open app and answer
        Intent answerIntent = new Intent(this, MainActivity.class);
        answerIntent.setAction("com.rodnya.messenger.ANSWER_CALL");
        answerIntent.putExtra("fromUserId", fromUserId);
        answerIntent.putExtra("fromUsername", fromUsername);
        answerIntent.putExtra("callData", dataString);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent answerPendingIntent = PendingIntent.getActivity(
                this, 101, answerIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // Intent to open app and view
        Intent viewIntent = new Intent(this, MainActivity.class);
        viewIntent.setAction("com.rodnya.messenger.VIEW_CALL");
        viewIntent.putExtra("fromUserId", fromUserId);
        viewIntent.putExtra("fromUsername", fromUsername);
        viewIntent.putExtra("callData", dataString);
        viewIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent viewPendingIntent = PendingIntent.getActivity(
                this, 100, viewIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // Intent to reject call
        Intent rejectIntent = new Intent(this, CallActionReceiver.class);
        rejectIntent.setAction(CallActionReceiver.ACTION_REJECT);
        rejectIntent.putExtra("fromUserId", fromUserId);
        PendingIntent rejectPendingIntent = PendingIntent.getBroadcast(
                this, 102, rejectIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_CALLS_ID)
                .setContentTitle("Входящий звонок: " + fromUsername)
                .setContentText("Вам звонят через мессенджер «Родня»")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setOngoing(true)
                .setContentIntent(viewPendingIntent)
                .setFullScreenIntent(viewPendingIntent, true)
                .addAction(android.R.drawable.ic_menu_call, "Ответить", answerPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Отклонить", rejectPendingIntent)
                .build();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_CALL_ID, notification);
        }
    }

    private void showMessageNotification(String senderName, String text) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, (int) System.currentTimeMillis(), intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_MESSAGES_ID)
                .setContentTitle(senderName)
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify((int) System.currentTimeMillis(), notification);
        }
    }

    public void stopCallRinging() {
        pendingCallData = null;
        try {
            if (currentRingtone != null && currentRingtone.isPlaying()) {
                currentRingtone.stop();
            }
        } catch (Exception ignored) {}

        try {
            if (vibrator != null) {
                vibrator.cancel();
            }
        } catch (Exception ignored) {}

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIFICATION_CALL_ID);
        }
    }

    public static void rejectCallFromNotification(Context context, String targetUserId) {
        if (instance != null) {
            instance.stopCallRinging();
            if (instance.socket != null && instance.socket.connected() && targetUserId != null) {
                try {
                    JSONObject data = new JSONObject();
                    data.put("targetUserId", targetUserId);
                    data.put("reason", "Отклонён");
                    instance.socket.emit("call-reject", data);
                } catch (Exception ignored) {}
            }
        }
    }

    @Override
    public void onDestroy() {
        stopCallRinging();
        if (socket != null) {
            socket.disconnect();
            socket.off();
            socket = null;
        }
        super.onDestroy();
    }
}
