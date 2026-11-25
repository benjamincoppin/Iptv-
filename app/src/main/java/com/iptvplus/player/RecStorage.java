package com.iptvplus.player;

import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Where recordings are written:
 *  - "file:<path>"   a folder IPTV+ can write to directly (internal memory or the app folder of a USB key / hard drive)
 *  - "content://…"   a folder chosen with Android's folder picker (any folder of a USB key / hard drive)
 *  - ""              automatic: the USB key / hard drive if one is plugged in, else the internal memory
 */
public final class RecStorage {
    private RecStorage() { }

    public static final class Target { public OutputStream stream; public String uri; public String name; public String note; }

    /** Storage volumes IPTV+ can write to without any permission (one app folder per volume). */
    public static String volumes(Context ctx) {
        JSONArray arr = new JSONArray();
        File[] dirs = ctx.getExternalFilesDirs(Environment.DIRECTORY_MOVIES);
        for (int i = 0; dirs != null && i < dirs.length; i++) {
            File d = dirs[i];
            if (d == null) continue;
            d.mkdirs();
            try {
                JSONObject o = new JSONObject();
                boolean removable = i > 0 || Environment.isExternalStorageRemovable(d);
                String label = removable ? "Clé USB / disque externe" : "Mémoire interne";
                if (Build.VERSION.SDK_INT >= 24) {
                    StorageManager sm = (StorageManager) ctx.getSystemService(Context.STORAGE_SERVICE);
                    StorageVolume v = sm.getStorageVolume(d);
                    if (v != null) { String desc = v.getDescription(ctx); if (desc != null && desc.length() > 0) label = desc; removable = v.isRemovable(); }
                }
                StatFs st = new StatFs(d.getAbsolutePath());
                o.put("spec", "file:" + d.getAbsolutePath());
                o.put("label", label);
                o.put("removable", removable);
                o.put("free", st.getAvailableBytes());
                o.put("total", st.getTotalBytes());
                arr.put(o);
            } catch (Exception ignored) { }
        }
        return arr.toString();
    }

    private static String fileName(JSONObject rec) {
        String t = rec.optString("title", "Enregistrement"), c = rec.optString("channel", "");
        String d = new SimpleDateFormat("yyyy-MM-dd HH'h'mm", Locale.FRANCE).format(new Date(rec.optLong("start", System.currentTimeMillis())));
        String n = (t + (c.length() > 0 ? " - " + c : "") + " - " + d).replaceAll("[\\\\/:*?\"<>|]", " ").replaceAll("\\s+", " ").trim();
        if (n.length() > 110) n = n.substring(0, 110);
        return n + ".ts";
    }

    private static String autoSpec(Context ctx) {
        try {
            JSONArray v = new JSONArray(volumes(ctx));
            for (int i = 0; i < v.length(); i++) if (v.getJSONObject(i).optBoolean("removable")) return v.getJSONObject(i).getString("spec");
            if (v.length() > 0) return v.getJSONObject(0).getString("spec");
        } catch (Exception ignored) { }
        return "file:" + new File(ctx.getFilesDir(), "recordings").getAbsolutePath();
    }

    public static Target create(Context ctx, JSONObject rec) throws Exception {
        String spec = RecStore.folder(ctx);
        if (spec.length() == 0) spec = autoSpec(ctx);
        String name = fileName(rec);
        Target t = new Target();
        t.name = name;
        if (spec.startsWith("smb://")) {
            try {
                Smb.Out o = Smb.create(ctx, spec, name);
                t.stream = o.stream;
                t.uri = o.uri;
                return t;
            } catch (Exception e) {
                // computer asleep / off: never lose the recording, write it on the device instead
                spec = autoSpec(ctx);
                t.note = e.getMessage() + " : enregistré sur l'appareil à la place";
                Diag.log("Dossier réseau indisponible (" + e.getMessage() + "), enregistrement local");
            }
        }
        if (spec.startsWith("content://")) {
            DocumentFile dir = DocumentFile.fromTreeUri(ctx, Uri.parse(spec));
            if (dir == null || !dir.canWrite()) throw new Exception("Dossier d'enregistrement inaccessible (clé USB débranchée ?)");
            DocumentFile f = dir.createFile("video/mp2t", name.replaceAll("\\.ts$", ""));
            if (f == null) throw new Exception("Impossible de créer le fichier");
            t.stream = ctx.getContentResolver().openOutputStream(f.getUri(), "w");
            t.uri = f.getUri().toString();
        } else {
            File dir = new File(spec.substring(5));
            dir.mkdirs();
            if (!dir.canWrite()) throw new Exception("Stockage inaccessible (clé USB débranchée ?)");
            File f = new File(dir, name);
            t.stream = new FileOutputStream(f);
            t.uri = Uri.fromFile(f).toString();
        }
        if (t.stream == null) throw new Exception("Impossible d'écrire le fichier");
        return t;
    }

    public static boolean delete(Context ctx, String uri) {
        if (uri.startsWith("smb://")) return Smb.delete(ctx, uri);
        try {
            if (uri.startsWith("content://")) {
                DocumentFile f = DocumentFile.fromSingleUri(ctx, Uri.parse(uri));
                return f != null && f.delete();
            }
            return new File(Uri.parse(uri).getPath()).delete();
        } catch (Throwable t) { return false; }
    }

    public static boolean exists(Context ctx, String uri) {
        if (uri.startsWith("smb://")) return Smb.exists(ctx, uri);
        try {
            if (uri.startsWith("content://")) { DocumentFile f = DocumentFile.fromSingleUri(ctx, Uri.parse(uri)); return f != null && f.exists(); }
            return new File(Uri.parse(uri).getPath()).exists();
        } catch (Throwable t) { return false; }
    }

    /** Size of a recording file, -1 if unknown. */
    public static long length(Context ctx, String uri) {
        try {
            if (uri.startsWith("smb://")) return Smb.length(ctx, uri);
            if (uri.startsWith("content://")) {
                android.os.ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(Uri.parse(uri), "r");
                try { return pfd.getStatSize(); } finally { pfd.close(); }
            }
            return new File(Uri.parse(uri).getPath()).length();
        } catch (Throwable t) { return -1; }
    }

    /** Opens a recording for reading from the given byte offset. */
    public static java.io.InputStream open(Context ctx, String uri, long offset) throws Exception {
        if (uri.startsWith("smb://")) return Smb.open(ctx, uri, offset);
        java.io.FileInputStream in;
        if (uri.startsWith("content://")) {
            final android.os.ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(Uri.parse(uri), "r");
            in = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd);
        } else {
            in = new java.io.FileInputStream(new File(Uri.parse(uri).getPath()));
        }
        if (offset > 0) in.getChannel().position(offset);
        return in;
    }

    /** URL the player can open. */
    public static String playUrl(Context ctx, String uri) {
        return uri.startsWith("smb://") ? Smb.playUrl(ctx, uri) : uri;
    }

    public static String describe(Context ctx) {
        String spec = RecStore.folder(ctx);
        if (spec.length() == 0) return "Automatique";
        if (spec.startsWith("smb://")) return Smb.describe(spec);
        if (spec.startsWith("content://")) {
            DocumentFile d = DocumentFile.fromTreeUri(ctx, Uri.parse(spec));
            return d != null && d.getName() != null ? "Dossier « " + d.getName() + " »" : "Dossier choisi";
        }
        try {
            JSONArray v = new JSONArray(volumes(ctx));
            for (int i = 0; i < v.length(); i++) if (spec.equals(v.getJSONObject(i).optString("spec"))) return v.getJSONObject(i).optString("label");
        } catch (Exception ignored) { }
        return spec.substring(5);
    }
}
