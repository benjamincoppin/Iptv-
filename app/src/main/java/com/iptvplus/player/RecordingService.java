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
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Foreground service that records live channels (or downloads a programme from the replay) to the
 * chosen storage (USB key / hard drive / internal memory). Keeps the CPU and Wi-Fi awake while recording.
 */
public class RecordingService extends Service {
    private static final String CHANNEL = "recordings";
    private static final int NOTIF_ID = 4242;
    private static final Map<String, Job> jobs = new ConcurrentHashMap<String, Job>();

    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    public static void start(Context ctx, String id) {
        Intent i = new Intent(ctx, RecordingService.class).setAction("start").putExtra("id", id);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Throwable t) {
            Diag.log("Démarrage enregistrement impossible : " + t);
            RecStore.update(ctx, id, "status", "failed");
            RecStore.update(ctx, id, "error", "Android a refusé de démarrer l'enregistrement");
        }
    }

    public static void stop(Context ctx, String id) {
        Job j = jobs.get(id);
        if (j != null) j.cancelled = true;
    }

    public static boolean isActive(String id) { return jobs.containsKey(id); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundNow("Préparation de l'enregistrement…");
        String id = intent != null ? intent.getStringExtra("id") : null;
        if (id != null && !jobs.containsKey(id)) {
            JSONObject rec = RecStore.get(this, id);
            if (rec != null) {
                Job j = new Job(this, rec);
                jobs.put(id, j);
                acquireLocks();
                new Thread(j, "rec-" + id).start();
                refreshNotification();
            }
        }
        if (jobs.isEmpty()) stopSelfSafely();
        return START_NOT_STICKY;
    }

    private void startForegroundNow(String text) {
        Notification n = buildNotification(text);
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
    }

    private Notification buildNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Enregistrements", NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("iptvplus://recordings"));
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("IPTV+ · Enregistrement")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
    }

    void refreshNotification() {
        List<String> names = new ArrayList<String>();
        for (Job j : jobs.values()) names.add(j.rec.optString("title"));
        String text = names.isEmpty() ? "Terminé" : (names.size() == 1 ? names.get(0) : names.size() + " enregistrements en cours");
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID, buildNotification(text));
    }

    private void acquireLocks() {
        try {
            if (wake == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IPTVPlus:recording");
                wake.setReferenceCounted(false);
            }
            if (!wake.isHeld()) wake.acquire(12 * 3600000L);
            if (wifi == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                if (wm != null) {
                    wifi = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "IPTVPlus:recording");
                    wifi.setReferenceCounted(false);
                }
            }
            if (wifi != null && !wifi.isHeld()) wifi.acquire();
        } catch (Throwable t) { Diag.log("Verrous de veille : " + t); }
    }

    private void releaseLocks() {
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Throwable ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (Throwable ignored) { }
    }

    void jobFinished(String id) {
        jobs.remove(id);
        if (jobs.isEmpty()) stopSelfSafely(); else refreshNotification();
    }

    private void stopSelfSafely() {
        releaseLocks();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override public void onDestroy() { releaseLocks(); super.onDestroy(); }

    // ---------- one recording ----------
    static final class Job implements Runnable {
        final RecordingService svc;
        final JSONObject rec;
        final String id;
        volatile boolean cancelled = false;
        long written = 0;
        long lastSave = 0;

        Job(RecordingService svc, JSONObject rec) { this.svc = svc; this.rec = rec; this.id = rec.optString("id"); }

        @Override public void run() {
            Context ctx = svc;
            boolean replay = "replay".equals(rec.optString("mode"));
            long end = rec.optLong("end") + RecStore.marginAfter(ctx) * 60000L;
            OutputStream out = null;
            String error = null;
            try {
                RecStore.update(ctx, id, "status", "recording");
                RecStore.update(ctx, id, "error", "");
                RecStorage.Target t = RecStorage.create(ctx, rec);
                out = t.stream;
                RecStore.update(ctx, id, "file", t.uri);
                RecStore.update(ctx, id, "name", t.name);
                Diag.log("Enregistrement démarré : " + rec.optString("title") + (replay ? " (depuis le replay)" : "") + " → " + t.name);
                if (replay) downloadReplay(out);
                else recordLive(out, end);
            } catch (Throwable e) {
                error = String.valueOf(e.getMessage());
                Diag.log("Enregistrement en échec : " + e);
            } finally {
                try { if (out != null) out.close(); } catch (Throwable ignored) { }
            }
            RecStore.update(ctx, id, "size", written);
            JSONObject cur = RecStore.get(ctx, id);
            if (cur != null) {
                try {
                    if (cancelled) { cur.put("status", written > 0 ? "done" : "cancelled"); cur.put("error", written > 0 ? "Arrêté avant la fin" : ""); }
                    else if (written > 512 * 1024 && error == null) cur.put("status", "done");
                    else if (written > 512 * 1024) { cur.put("status", "done"); cur.put("error", "Interruptions pendant l'enregistrement"); }
                    else {
                        cur.put("status", "failed");
                        cur.put("error", error != null ? error : "Aucune donnée reçue");
                        // Plan B: try the provider's replay once the programme is over
                        if (!replay && cur.optString("replayUrl").length() > 0 && RecStore.planB(ctx)) cur.put("replayPending", true);
                    }
                    RecStore.put(ctx, cur);
                    if (cur.optBoolean("replayPending")) RecStore.tryReplay(ctx, cur, System.currentTimeMillis());
                } catch (Exception ignored) { }
            }
            Diag.log("Enregistrement terminé : " + rec.optString("title") + " (" + (written / 1048576) + " Mo)");
            svc.jobFinished(id);
        }

        private void progress() {
            long now = System.currentTimeMillis();
            if (now - lastSave > 10000) { lastSave = now; RecStore.update(svc, id, "size", written); }
        }

        private void copy(Net.Response r, OutputStream out, long until) throws Exception {
            byte[] buf = new byte[131072];
            int n;
            while (!cancelled && (until <= 0 || System.currentTimeMillis() < until) && (n = r.body.read(buf)) > 0) {
                out.write(buf, 0, n);
                written += n;
                progress();
            }
        }

        /** Live TS stream until the end time, reconnecting after cuts; HLS playlist as fallback. */
        private void recordLive(OutputStream out, long end) throws Exception {
            String url = rec.optString("url"), hls = rec.optString("hlsUrl");
            boolean useHls = false;
            int failures = 0;
            while (!cancelled && System.currentTimeMillis() < end) {
                if (useHls) { recordHls(out, hls, end); return; }
                try {
                    Net.Response r = Net.open(url, 15000, 30000);
                    try {
                        if (r.code >= 400 || r.body == null) {
                            if (written == 0 && hls.length() > 0) { useHls = true; continue; }
                            throw new Exception("HTTP " + r.code);
                        }
                        copy(r, out, end);
                        failures = 0;
                    } finally { r.close(); }
                } catch (Exception e) {
                    failures++;
                    Diag.log("Coupure pendant l'enregistrement (" + e.getMessage() + "), reconnexion…");
                    if (failures > 60) throw e;
                    Thread.sleep(Math.min(10000, 2000L * failures));
                }
            }
        }

        private void recordHls(OutputStream out, String playlist, long end) throws Exception {
            Set<String> done = new HashSet<String>();
            int failures = 0;
            while (!cancelled && System.currentTimeMillis() < end) {
                long target = 4000;
                try {
                    Net.Response r = Net.open(playlist, 15000, 20000);
                    String text;
                    try {
                        if (r.code >= 400 || r.body == null) throw new Exception("HTTP " + r.code);
                        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                        byte[] b = new byte[16384]; int n;
                        while ((n = r.body.read(b)) > 0) bo.write(b, 0, n);
                        text = bo.toString("UTF-8");
                    } finally { r.close(); }
                    URL base = new URL(playlist);
                    String[] lines = text.split("\n");
                    String variant = null;
                    for (int i = 0; i < lines.length; i++) {
                        String l = lines[i].trim();
                        if (l.startsWith("#EXT-X-STREAM-INF") && i + 1 < lines.length) { variant = new URL(base, lines[i + 1].trim()).toString(); break; }
                        if (l.startsWith("#EXT-X-TARGETDURATION:")) { try { target = Long.parseLong(l.substring(22).trim()) * 1000L; } catch (Exception ignored) { } }
                    }
                    if (variant != null) { playlist = variant; continue; } // master playlist → media playlist
                    for (String l0 : lines) {
                        String l = l0.trim();
                        if (l.length() == 0 || l.startsWith("#")) continue;
                        String seg = new URL(base, l).toString();
                        if (!done.add(seg)) continue;
                        Net.Response s = Net.open(seg, 15000, 30000);
                        try { if (s.code < 400 && s.body != null) copy(s, out, 0); } finally { s.close(); }
                        if (cancelled) return;
                    }
                    if (done.size() > 5000) done.clear();
                    failures = 0;
                } catch (Exception e) {
                    failures++;
                    if (failures > 60) throw e;
                }
                Thread.sleep(Math.max(1000, target / 2));
            }
        }

        /** Programme already aired: finite download from the provider's replay (timeshift). */
        private void downloadReplay(OutputStream out) throws Exception {
            String url = rec.optString("replayUrl");
            Exception last = null;
            for (int attempt = 0; attempt < 3 && !cancelled; attempt++) {
                try {
                    Net.Response r = Net.open(url, 20000, 60000);
                    try {
                        if (r.code >= 400 || r.body == null) throw new Exception("Replay indisponible (HTTP " + r.code + ")");
                        copy(r, out, 0);
                    } finally { r.close(); }
                    if (written > 0) return; // never restart a partial download (it would duplicate the beginning)
                } catch (Exception e) { last = e; if (written > 0) return; Thread.sleep(5000); }
            }
            if (last != null) throw last;
        }
    }
}
