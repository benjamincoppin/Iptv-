package com.iptvplus.player;

import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;

import androidx.tvprovider.media.tv.TvContractCompat;
import androidx.tvprovider.media.tv.WatchNextProgram;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * "Continuer à regarder" row of the Android TV / Google TV home screen.
 * The interface sends the current resume list; this class mirrors it in the system's Watch Next table.
 */
public final class WatchNext {
    private WatchNext() { }

    public static boolean supported(Context ctx) {
        return Build.VERSION.SDK_INT >= 26 && ctx.getPackageManager().hasSystemFeature("android.software.leanback");
    }

    /** items: [{key, type:"movie"|"episode", title, subtitle, image, pos, dur, link, ts}] */
    public static void sync(Context ctx, String json) {
        if (!supported(ctx)) return;
        try {
            JSONArray arr = new JSONArray(json);
            // existing programs of this app, by internal provider id
            Map<String, Long> existing = new HashMap<String, Long>();
            Cursor c = ctx.getContentResolver().query(TvContractCompat.WatchNextPrograms.CONTENT_URI,
                    new String[]{ TvContractCompat.WatchNextPrograms._ID, TvContractCompat.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID },
                    null, null, null);
            if (c != null) {
                while (c.moveToNext()) {
                    String id = c.getString(1);
                    if (id != null) existing.put(id, c.getLong(0));
                }
                c.close();
            }
            Set<String> keep = new HashSet<String>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                String key = o.getString("key");
                keep.add(key);
                WatchNextProgram.Builder b = new WatchNextProgram.Builder();
                boolean episode = "episode".equals(o.optString("type"));
                b.setType(episode ? TvContractCompat.WatchNextPrograms.TYPE_TV_EPISODE : TvContractCompat.WatchNextPrograms.TYPE_MOVIE)
                        .setWatchNextType(TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
                        .setLastEngagementTimeUtcMillis(o.optLong("ts", System.currentTimeMillis()))
                        .setTitle(o.optString("title"))
                        .setLastPlaybackPositionMillis((int) o.optLong("pos"))
                        .setDurationMillis((int) o.optLong("dur"))
                        .setInternalProviderId(key)
                        .setIntent(new Intent(Intent.ACTION_VIEW, Uri.parse(o.getString("link"))).setPackage(ctx.getPackageName()));
                if (episode && o.optString("subtitle").length() > 0) b.setEpisodeTitle(o.optString("subtitle"));
                else if (o.optString("subtitle").length() > 0) b.setDescription(o.optString("subtitle"));
                String img = o.optString("image");
                if (img.startsWith("http")) {
                    b.setPosterArtUri(Uri.parse(img));
                    b.setPosterArtAspectRatio(TvContractCompat.PreviewPrograms.ASPECT_RATIO_16_9);
                }
                WatchNextProgram p = b.build();
                Long rowId = existing.get(key);
                if (rowId != null) {
                    ctx.getContentResolver().update(TvContractCompat.buildWatchNextProgramUri(rowId), p.toContentValues(), null, null);
                } else {
                    ctx.getContentResolver().insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, p.toContentValues());
                }
            }
            for (Map.Entry<String, Long> e : existing.entrySet()) {
                if (!keep.contains(e.getKey())) {
                    ctx.getContentResolver().delete(ContentUris.withAppendedId(TvContractCompat.WatchNextPrograms.CONTENT_URI, e.getValue()), null, null);
                }
            }
        } catch (Throwable t) {
            Diag.log("Continuer à regarder : " + t);
        }
    }
}
