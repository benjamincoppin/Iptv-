package com.iptvplus.player;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Recordings list, kept natively so scheduled recordings work even when the interface is closed
 * (alarm wake-up, device reboot).
 *
 * Entry: {id, title, channel, channelId, start, end, url, hlsUrl, replayUrl, replayUntil,
 *         status: scheduled|recording|done|failed|missed|replay|cancelled, mode: live|replay,
 *         file, name, size, error, created}
 */
public final class RecStore {
    private static final String PREFS = "recordings";

    private RecStore() { }

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static synchronized JSONArray all(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString("list", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    public static synchronized void save(Context ctx, JSONArray a) { prefs(ctx).edit().putString("list", a.toString()).apply(); }

    public static synchronized JSONObject get(Context ctx, String id) {
        JSONArray a = all(ctx);
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && id.equals(o.optString("id"))) return o; }
        return null;
    }

    public static synchronized void put(Context ctx, JSONObject rec) {
        JSONArray a = all(ctx), out = new JSONArray();
        boolean found = false;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            if (rec.optString("id").equals(o.optString("id"))) { out.put(rec); found = true; } else out.put(o);
        }
        if (!found) out.put(rec);
        save(ctx, out);
    }

    public static synchronized void update(Context ctx, String id, String key, Object value) {
        JSONObject o = get(ctx, id);
        if (o == null) return;
        try { o.put(key, value); } catch (Exception ignored) { }
        put(ctx, o);
    }

    public static synchronized void remove(Context ctx, String id) {
        JSONArray a = all(ctx), out = new JSONArray();
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && !id.equals(o.optString("id"))) out.put(o); }
        save(ctx, out);
    }

    // ---------- settings ----------
    public static int marginBefore(Context ctx) { return prefs(ctx).getInt("before", 2); }
    public static int marginAfter(Context ctx) { return prefs(ctx).getInt("after", 5); }
    public static boolean planB(Context ctx) { return prefs(ctx).getBoolean("planB", true); }
    public static String folder(Context ctx) { return prefs(ctx).getString("folder", ""); }
    public static void setFolder(Context ctx, String spec) { prefs(ctx).edit().putString("folder", spec).apply(); }

    public static void setSettings(Context ctx, String json) {
        try {
            JSONObject o = new JSONObject(json);
            SharedPreferences.Editor e = prefs(ctx).edit();
            if (o.has("before")) e.putInt("before", o.getInt("before"));
            if (o.has("after")) e.putInt("after", o.getInt("after"));
            if (o.has("planB")) e.putBoolean("planB", o.getBoolean("planB"));
            e.apply();
        } catch (Exception ignored) { }
    }

    // ---------- scheduling ----------
    /** (Re)arms alarms, starts due recordings, and switches missed ones to the replay fallback. */
    public static void reschedule(Context ctx) {
        long now = System.currentTimeMillis();
        long before = marginBefore(ctx) * 60000L, after = marginAfter(ctx) * 60000L;
        JSONArray a = all(ctx);
        JSONObject nextVod = null;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            String st = o.optString("status");
            String id = o.optString("id");
            if ("vod".equals(o.optString("mode"))) {
                // films / episodes: one download at a time, interrupted ones first, then in order of request
                boolean waiting = "queued".equals(st) || ("recording".equals(st) && !RecordingService.isActive(id));
                if (waiting && (nextVod == null || rank(o) < rank(nextVod))) nextVod = o;
                continue;
            }
            long start = o.optLong("start") - before, end = o.optLong("end") + after;
            if ("replay".equals(o.optString("mode")) && ("scheduled".equals(st) || ("recording".equals(st) && !RecordingService.isActive(id)))) {
                // download of an aired programme from the provider's replay
                long ready = o.optLong("end") + 3 * 60000L;
                if (ready > now) arm(ctx, id, ready); else RecordingService.start(ctx, id);
                continue;
            }
            if ("scheduled".equals(st)) {
                if (start > now) arm(ctx, id, start);
                else if (end > now) RecordingService.start(ctx, id);
                else markMissed(ctx, o, now);
            } else if ("recording".equals(st) && !RecordingService.isActive(id)) {
                // the device was switched off / the app was killed during the recording
                if (end > now) RecordingService.start(ctx, id);
                else markMissed(ctx, o, now);
            } else if (("missed".equals(st) || "failed".equals(st)) && o.optBoolean("replayPending")) {
                tryReplay(ctx, o, now);
            }
        }
        if (nextVod != null && RecordingService.activeVod() == 0) RecordingService.start(ctx, nextVod.optString("id"));
    }

    private static long rank(JSONObject o) {
        return ("recording".equals(o.optString("status")) ? 0 : 1L << 50) + o.optLong("created");
    }

    private static void markMissed(Context ctx, JSONObject o, long now) {
        try {
            o.put("status", "missed");
            o.put("replayPending", o.optString("replayUrl").length() > 0 && planB(ctx));
            put(ctx, o);
        } catch (Exception ignored) { }
        tryReplay(ctx, o, now);
    }

    /** Plan B: get the programme from the provider's replay once it has been aired. */
    static void tryReplay(Context ctx, JSONObject o, long now) {
        if (!planB(ctx) || o.optString("replayUrl").length() == 0) return;
        long end = o.optLong("end");
        if (now < end + 3 * 60000L) { arm(ctx, o.optString("id"), end + 3 * 60000L); return; } // wait for the end of the broadcast
        if (o.optLong("replayUntil") > 0 && now > o.optLong("replayUntil")) {
            update(ctx, o.optString("id"), "replayPending", false);
            update(ctx, o.optString("id"), "error", "Plus disponible en replay");
            return;
        }
        try {
            o.put("mode", "replay");
            o.put("status", "scheduled");
            o.put("replayPending", false);
            put(ctx, o);
        } catch (Exception ignored) { }
        RecordingService.start(ctx, o.optString("id"));
    }

    public static void arm(Context ctx, String id, long at) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, id);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Throwable t) {
            Diag.log("Alarme enregistrement : " + t);
            am.set(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    public static void disarm(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmIntent(ctx, id));
    }

    private static PendingIntent alarmIntent(Context ctx, String id) {
        Intent i = new Intent(ctx, RecAlarm.class).setAction("com.iptvplus.REC_ALARM").putExtra("id", id).setData(android.net.Uri.parse("iptvplus-rec://" + id));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, flags);
    }
}
