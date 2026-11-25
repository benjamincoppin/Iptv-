package com.iptvplus.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

/** Keeps the local network share alive while it is on (Android stops background servers otherwise). */
public class ShareService extends Service {
    private static final String CHANNEL = "share";
    private static final int NOTIF_ID = 4343;
    private final Handler h = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    public static String start(Context ctx) throws Exception {
        String st = ShareServer.start(ctx);
        Intent i = new Intent(ctx, ShareService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Throwable t) { Diag.log("Service de partage : " + t); }
        return st;
    }

    public static void stop(Context ctx) {
        ShareServer.stop();
        ctx.stopService(new Intent(ctx, ShareService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            ShareServer.stop();
            finish();
            return START_NOT_STICKY;
        }
        Notification n = build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
        if (!ShareServer.running()) { finish(); return START_NOT_STICKY; }
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (wake == null) { wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IPTVPlus:share"); wake.setReferenceCounted(false); }
            wake.acquire(2 * 3600000L);
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wifi == null && wm != null) { wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "IPTVPlus:share"); wifi.setReferenceCounted(false); }
            if (wifi != null) wifi.acquire();
        } catch (Throwable ignored) { }
        h.removeCallbacksAndMessages(null);
        h.postDelayed(check, 60000);
        return START_NOT_STICKY;
    }

    private final Runnable check = new Runnable() {
        @Override public void run() {
            if (!ShareServer.running()) { finish(); return; }
            if (ShareServer.idleFor() > ShareServer.IDLE_MS) {
                Diag.log("Partage réseau arrêté (1 h sans activité)");
                ShareServer.stop();
                finish();
                return;
            }
            h.postDelayed(this, 60000);
        }
    };

    private void finish() {
        h.removeCallbacksAndMessages(null);
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Throwable ignored) { }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() {
        h.removeCallbacksAndMessages(null);
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Throwable ignored) { }
        super.onDestroy();
    }

    private Notification build() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Partage sur le réseau", NotificationManager.IMPORTANCE_LOW));
        String text = "Partage arrêté";
        try {
            JSONObject st = new JSONObject(ShareServer.state());
            if (st.optBoolean("running")) text = "Sur l'ordi : " + st.optString("url") + " · code " + st.optString("pin");
        } catch (Exception ignored) { }
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent open = PendingIntent.getActivity(this, 3, new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("iptvplus://recordings")), fl);
        PendingIntent stop = PendingIntent.getService(this, 4, new Intent(this, ShareService.class).setAction("stop"), fl);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("IPTV+ · Partage sur le réseau actif").setContentText(text)
                .setOngoing(true).setContentIntent(open).addAction(android.R.drawable.ic_menu_close_clear_cancel, "Arrêter", stop);
        if (Build.VERSION.SDK_INT >= 16) b.setStyle(new Notification.BigTextStyle().bigText(text));
        return b.build();
    }
}
