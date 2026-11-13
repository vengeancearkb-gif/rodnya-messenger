package com.rodnya.messenger;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_REJECT = "com.rodnya.messenger.ACTION_REJECT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REJECT.equals(intent.getAction())) {
            String targetUserId = intent.getStringExtra("fromUserId");
            MessengerBackgroundService.rejectCallFromNotification(context, targetUserId);
        }
    }
}
