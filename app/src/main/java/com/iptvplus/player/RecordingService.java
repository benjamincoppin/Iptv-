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

    /** Number of film / episode downloads running (they go one at a time). */
    public static int activeVod() {
        int n = 0;
        for (Job j : jobs.values()) if ("vod".equals(j.rec.optString("mode"))) n++;
        return n;
    }

    /** Live progress of the running jobs: {id: {written, total, speed, mode, start, end, startedAt}} */
    public static String progressJson() {
        JSONObject o = new JSONObject();
        for (Job j : jobs.values()) {
            try {
                JSONObject p = new JSONObject();
                p.put("written", j.written);
                p.put("total", j.total);
                p.put("speed", j.speed);
                p.put("mode", j.rec.optString("mode", "live"));
                p.put("start", j.rec.optLong("start"));
                p.put("end", j.rec.optLong("end"));
                p.put("startedAt", j.startedAt);
                o.put(j.id, p);
            } catch (Exception ignored) { }
        }
        return o.toString();
    }

    static String mb(long b) {
        if (b >= 1000L * 1000 * 1000) return String.format(java.util.Locale.FRANCE, "%.1f Go", b / 1e9);
        return Math.max(0, Math.round(b / 1e6)) + " Mo";
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundNow("Préparation de l'enregistrement…");
        String id = intent != null ? intent.getStringExtra("id") : null;
        if (id != null && !jobs.containsKey(id)) {
            JSONObject rec = RecStore.get(this, id);
            boolean busyVod = rec != null && "vod".equals(rec.optString("mode")) && activeVod() > 0;
            if (rec != null && !busyVod && !"paused".equals(rec.optString("status")) && !"done".equals(rec.optString("status"))) {
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

    private Notification buildNotification(String text) { return buildNotification(text, -2); }

    /** progress: -2 none, -1 indeterminate, 0..100 percent */
    private Notification buildNotification(String text, int progress) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Enregistrements", NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("iptvplus://recordings"));
        PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("IPTV+ · Enregistrement")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(pi);
        if (Build.VERSION.SDK_INT >= 20) b.setOnlyAlertOnce(true);
        if (progress == -1) b.setProgress(0, 0, true);
        else if (progress >= 0) b.setProgress(100, progress, false);
        return b.build();
    }

    private long lastNotif = 0;

    void onProgress() {
        long now = System.currentTimeMillis();
        if (now - lastNotif < 3000) return;
        lastNotif = now;
        refreshNotification();
    }

    void refreshNotification() {
        List<Job> list = new ArrayList<Job>(jobs.values());
        String text;
        int progress = -2;
        if (list.isEmpty()) text = "Terminé";
        else if (list.size() > 1) text = list.size() + " enregistrements en cours";
        else {
            Job j = list.get(0);
            String title = j.rec.optString("title");
            if ("replay".equals(j.rec.optString("mode")) || "vod".equals(j.rec.optString("mode"))) {
                if (j.total > 0) {
                    progress = (int) Math.min(100, j.written * 100 / j.total);
                    String eta = j.speed > 0 ? " · " + Math.max(1, (j.total - j.written) / j.speed / 60) + " min restantes" : "";
                    text = title + " · " + progress + " % (" + mb(j.written) + " / " + mb(j.total) + ")" + eta;
                } else { progress = -1; text = title + " · " + mb(j.written) + " reçus"; }
            } else {
                long st = j.rec.optLong("start"), en = j.rec.optLong("end"), now = System.currentTimeMillis();
                if (en > st) progress = (int) Math.max(0, Math.min(100, (now - st) * 100 / (en - st)));
                text = title + " · jusqu'à " + new java.text.SimpleDateFormat("HH:mm", java.util.Locale.FRANCE).format(new java.util.Date(en)) + " · " + mb(j.written);
            }
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID, buildNotification(text, progress));
    }

    /** One-off notification when a recording / download ends. */
    void notifyDone(JSONObject r) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            String chId = "recordings_done";
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(chId) == null)
                nm.createNotificationChannel(new NotificationChannel(chId, "Enregistrements terminés", NotificationManager.IMPORTANCE_DEFAULT));
            boolean ok = "done".equals(r.optString("status"));
            boolean replay = "replay".equals(r.optString("mode")) || "vod".equals(r.optString("mode"));
            String title = ok ? (replay ? "Téléchargement terminé" : "Enregistrement terminé") : (replay ? "Échec du téléchargement" : "Échec de l'enregistrement");
            String text = r.optString("title") + (ok ? " · " + mb(r.optLong("size")) : " · " + r.optString("error"));
            if (r.optBoolean("replayPending")) text += " · nouvel essai depuis le replay";
            Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("iptvplus://recordings"));
            PendingIntent pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, chId) : new Notification.Builder(this);
            b.setSmallIcon(ok ? android.R.drawable.stat_sys_download_done : android.R.drawable.stat_notify_error)
                    .setContentTitle(title).setContentText(text).setAutoCancel(true).setContentIntent(pi);
            if (Build.VERSION.SDK_INT >= 16) b.setStyle(new Notification.BigTextStyle().bigText(text));
            nm.notify(5000 + (r.optString("id").hashCode() & 0xfff), b.build());
        } catch (Throwable t) { Diag.log("Notification de fin : " + t); }
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
        volatile long written = 0;
        volatile long total = -1;
        volatile long speed = 0; // bytes per second
        final long startedAt = System.currentTimeMillis();
        long lastSave = 0, lastRate = 0, rateBytes = 0;

        Job(RecordingService svc, JSONObject rec) { this.svc = svc; this.rec = rec; this.id = rec.optString("id"); }

        @Override public void run() {
            if ("vod".equals(rec.optString("mode"))) { runVod(); return; }
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
                RecStore.update(ctx, id, "note", t.note == null ? "" : t.note);
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
                    if (!cancelled) svc.notifyDone(cur);
                    if (cur.optBoolean("replayPending")) RecStore.tryReplay(ctx, cur, System.currentTimeMillis());
                } catch (Exception ignored) { }
            }
            Diag.log("Enregistrement terminé : " + rec.optString("title") + " (" + (written / 1048576) + " Mo)");
            svc.jobFinished(id);
        }

        private void progress() {
            long now = System.currentTimeMillis();
            if (lastRate == 0) { lastRate = now; rateBytes = written; }
            else if (now - lastRate >= 1000) {
                long inst = (written - rateBytes) * 1000 / (now - lastRate);
                speed = speed == 0 ? inst : (speed * 7 + inst * 3) / 10;
                lastRate = now; rateBytes = written;
            }
            if (now - lastSave > 10000) { lastSave = now; RecStore.update(svc, id, "size", written); }
            svc.onProgress();
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

        // ---------- films / episodes ----------
        private OutputStream vodOut;

        private void runVod() {
            Context ctx = svc;
            String error = null;
            boolean complete = false;
            try {
                RecStore.update(ctx, id, "status", "recording");
                RecStore.update(ctx, id, "error", "");
                String file = rec.optString("file");
                long have = file.length() > 0 ? RecStorage.length(ctx, file) : -1;
                if (have > 0) {
                    vodOut = RecStorage.reopen(ctx, file, true);
                    written = have;
                    Diag.log("Téléchargement repris : " + rec.optString("title") + " à " + mb(have));
                } else {
                    RecStorage.Target t = RecStorage.create(ctx, rec);
                    vodOut = t.stream;
                    file = t.uri;
                    RecStore.update(ctx, id, "file", t.uri);
                    RecStore.update(ctx, id, "name", t.name);
                    RecStore.update(ctx, id, "note", t.note == null ? "" : t.note);
                    Diag.log("Téléchargement démarré : " + rec.optString("title") + " → " + t.name);
                }
                if (rec.optLong("total") > 0) total = rec.optLong("total");
                complete = downloadVod(ctx, file);
            } catch (Throwable e) {
                error = String.valueOf(e.getMessage());
                Diag.log("Téléchargement en échec : " + e);
            } finally {
                try { if (vodOut != null) vodOut.close(); } catch (Throwable ignored) { }
            }
            RecStore.update(ctx, id, "size", written);
            JSONObject cur = RecStore.get(ctx, id);
            if (cur != null) {
                try {
                    String st = cur.optString("status");
                    if (cancelled) { if (!"paused".equals(st)) cur.put("status", "paused"); }
                    else if (complete) { cur.put("status", "done"); cur.put("finished", System.currentTimeMillis()); }
                    else { cur.put("status", "failed"); cur.put("error", error != null ? error : "Téléchargement interrompu"); }
                    if (total > 0) cur.put("total", total);
                    RecStore.put(ctx, cur);
                    if (!cancelled) svc.notifyDone(cur);
                } catch (Exception ignored) { }
            }
            svc.jobFinished(id);
            RecStore.reschedule(ctx); // next one in the queue
        }

        /** Resumable download (HTTP Range). Returns true once the whole file is there. */
        private boolean downloadVod(Context ctx, String file) throws Exception {
            String url = rec.optString("url");
            int failures = 0;
            Exception last = null;
            while (!cancelled) {
                if (total > 0 && written >= total) return true;
                Net.Response r = null;
                try {
                    r = Net.open(url, 20000, 60000, written > 0 ? "bytes=" + written + "-" : null);
                    if (r.code == 416 && written > 0) return true; // nothing left to get
                    if (r.code >= 400 || r.body == null) throw new Exception("Fichier indisponible sur le serveur (HTTP " + r.code + ")");
                    if (r.code == 206) {
                        String cr = r.conn.getHeaderField("Content-Range");
                        int slash = cr == null ? -1 : cr.lastIndexOf('/');
                        if (slash > 0) { try { total = Long.parseLong(cr.substring(slash + 1).trim()); } catch (Exception ignored) { } }
                        else if (r.length > 0) total = written + r.length;
                    } else {
                        // the server ignored the resume request: start the file again
                        if (written > 0) {
                            vodOut.close();
                            vodOut = RecStorage.reopen(ctx, file, false);
                            written = 0;
                        }
                        if (r.length > 0) total = r.length;
                    }
                    if (total > 0) RecStore.update(svc, id, "total", total);
                    long before = written;
                    copy(r, vodOut, 0);
                    vodOut.flush();
                    if (cancelled) return false;
                    if (total <= 0) return written > 0; // size unknown: the end of the stream is the end of the file
                    if (written >= total) return true;
                    if (written > before) failures = 0; // cut in the middle: continue where it stopped
                    throw new Exception("Connexion coupée");
                } catch (Exception e) {
                    last = e;
                    if (cancelled) return false;
                    if (++failures > 20) throw last;
                    Diag.log("Téléchargement : " + e.getMessage() + ", nouvel essai (" + failures + ")");
                    long wait = Math.min(60000L, 3000L * failures);
                    long until = System.currentTimeMillis() + wait;
                    while (!cancelled && System.currentTimeMillis() < until) Thread.sleep(500);
                } finally { if (r != null) r.close(); }
            }
            return false;
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
                        if (r.length > 0) { total = r.length; RecStore.update(svc, id, "total", total); }
                        copy(r, out, 0);
                    } finally { r.close(); }
                    if (written > 0) return; // never restart a partial download (it would duplicate the beginning)
                } catch (Exception e) { last = e; if (written > 0) return; Thread.sleep(5000); }
            }
            if (last != null) throw last;
        }
    }
}
