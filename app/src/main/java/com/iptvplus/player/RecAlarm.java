package com.iptvplus.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** Wakes up for a scheduled recording (exact alarm) and after a reboot (re-arms everything). */
public class RecAlarm extends BroadcastReceiver {
    @Override public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        Diag.init(ctx);
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Diag.log("Redémarrage : reprogrammation des enregistrements");
            RecStore.reschedule(ctx);
            return;
        }
        String id = intent.getStringExtra("id");
        if (id == null) return;
        JSONObject o = RecStore.get(ctx, id);
        if (o == null) return;
        String st = o.optString("status");
        Diag.log("Réveil enregistrement " + o.optString("title") + " (" + st + ")");
        if ("scheduled".equals(st)) {
            if ("replay".equals(o.optString("mode")) && System.currentTimeMillis() < o.optLong("end") + 3 * 60000L) {
                RecStore.arm(ctx, id, o.optLong("end") + 3 * 60000L);
            } else {
                RecordingService.start(ctx, id);
            }
        } else if (o.optBoolean("replayPending")) {
            RecStore.tryReplay(ctx, o, System.currentTimeMillis());
        }
    }
}
