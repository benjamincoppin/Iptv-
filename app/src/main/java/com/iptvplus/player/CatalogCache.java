package com.iptvplus.player;

import android.content.Context;
import android.util.Xml;

import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.zip.GZIPInputStream;

/**
 * Keeps the provider catalogue (channels, movies, series, categories) and the TV guide on the device,
 * so the app starts instantly with the last known lists and refreshes them in the background.
 * Files are read by the interface directly from disk (file:// URLs), so large lists never travel
 * through the JavaScript bridge.
 */
public final class CatalogCache {
    private CatalogCache() { }

    public static File dir(Context ctx) {
        File d = new File(ctx.getFilesDir(), "catalog");
        d.mkdirs();
        return d;
    }

    private static String safe(String key) { return key.replaceAll("[^A-Za-z0-9._-]", "_"); }

    public static File file(Context ctx, String key) { return new File(dir(ctx), safe(key) + ".json"); }

    /** {"exists":bool,"age":ms,"size":bytes,"path":"file:///…"} */
    public static String info(Context ctx, String key) {
        File f = file(ctx, key);
        JSONObject o = new JSONObject();
        try {
            o.put("exists", f.exists() && f.length() > 0);
            o.put("age", f.exists() ? System.currentTimeMillis() - f.lastModified() : -1);
            o.put("size", f.length());
            o.put("path", "file://" + f.getAbsolutePath());
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** Downloads url into the cache file (atomically). Returns the file path. */
    public static String download(Context ctx, String url, String key) throws Exception {
        File out = file(ctx, key);
        File tmp = new File(out.getPath() + ".tmp");
        Net.Response r = Net.open(url, 20000, 120000);
        try {
            if (r.code < 200 || r.code >= 300 || r.body == null) throw new Exception("HTTP " + r.code);
            OutputStream os = new FileOutputStream(tmp);
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = r.body.read(buf)) > 0) { os.write(buf, 0, n); total += n; }
            os.close();
            if (total == 0) throw new Exception("réponse vide");
        } finally { r.close(); }
        if (out.exists()) out.delete();
        if (!tmp.renameTo(out)) throw new Exception("écriture impossible");
        return "file://" + out.getAbsolutePath();
    }

    public static void clear(Context ctx, String prefix) {
        File[] files = dir(ctx).listFiles();
        if (files == null) return;
        for (File f : files) if (prefix == null || f.getName().startsWith(safe(prefix))) f.delete();
    }

    // ---------- XMLTV → compact guide ----------
    // Output: {"t":<generated ms>,"ch":{"<epg channel id>":[[startSec,stopSec,"title","desc"],…]}}
    // Only programmes between now-12h and now+48h are kept, descriptions are shortened.

    private static final SimpleDateFormat XMLTV_FMT;
    static {
        XMLTV_FMT = new SimpleDateFormat("yyyyMMddHHmmss Z", Locale.US);
        XMLTV_FMT.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private static long parseTime(String s) {
        if (s == null) return 0;
        s = s.trim();
        try {
            if (s.length() >= 20) return XMLTV_FMT.parse(s.substring(0, 14) + " " + s.substring(15).trim()).getTime();
            SimpleDateFormat f = new SimpleDateFormat("yyyyMMddHHmmss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(s.substring(0, 14)).getTime();
        } catch (Exception e) { return 0; }
    }

    /** Downloads xmltv.php and writes the compact guide file. Returns "path|channels|programmes". */
    public static String buildGuide(Context ctx, String url, String key) throws Exception {
        File raw = new File(dir(ctx), safe(key) + ".xml.tmp");
        Net.Response r = Net.open(url, 20000, 180000);
        try {
            if (r.code < 200 || r.code >= 300 || r.body == null) throw new Exception("HTTP " + r.code);
            OutputStream os = new FileOutputStream(raw);
            byte[] buf = new byte[65536];
            int n;
            while ((n = r.body.read(buf)) > 0) os.write(buf, 0, n);
            os.close();
        } finally { r.close(); }

        long now = System.currentTimeMillis(), from = now - 12 * 3600000L, to = now + 48 * 3600000L;
        Map<String, List<String>> byChan = new HashMap<String, List<String>>();
        int count = 0;
        InputStream in = new BufferedInputStream(new FileInputStream(raw), 65536);
        in.mark(4);
        int b1 = in.read(), b2 = in.read();
        in.reset();
        if (b1 == 0x1f && b2 == 0x8b) in = new GZIPInputStream(in, 65536);
        try {
            XmlPullParser p = Xml.newPullParser();
            p.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false);
            p.setInput(in, null);
            String ch = null, title = null, desc = null;
            long start = 0, stop = 0;
            int ev = p.getEventType();
            while (ev != XmlPullParser.END_DOCUMENT) {
                if (ev == XmlPullParser.START_TAG) {
                    String name = p.getName();
                    if ("programme".equals(name)) {
                        ch = p.getAttributeValue(null, "channel");
                        start = parseTime(p.getAttributeValue(null, "start"));
                        stop = parseTime(p.getAttributeValue(null, "stop"));
                        title = null; desc = null;
                    } else if (ch != null && "title".equals(name) && title == null) {
                        title = p.nextText();
                    } else if (ch != null && "desc".equals(name) && desc == null) {
                        desc = p.nextText();
                    }
                } else if (ev == XmlPullParser.END_TAG && "programme".equals(p.getName()) && ch != null) {
                    if (stop > from && start < to && start > 0) {
                        List<String> l = byChan.get(ch);
                        if (l == null) { l = new ArrayList<String>(); byChan.put(ch, l); }
                        String d = desc == null ? "" : desc.trim();
                        if (d.length() > 240) d = d.substring(0, 237) + "…";
                        l.add("[" + (start / 1000) + "," + (stop / 1000) + "," + JSONObject.quote(title == null ? "" : title.trim()) + "," + JSONObject.quote(d) + "]");
                        count++;
                    }
                    ch = null;
                }
                ev = p.next();
            }
        } finally {
            try { in.close(); } catch (Throwable ignored) { }
            raw.delete();
        }
        if (count == 0) throw new Exception("guide vide");

        File out = file(ctx, key), tmp = new File(out.getPath() + ".tmp");
        Writer w = new OutputStreamWriter(new FileOutputStream(tmp), "UTF-8");
        w.write("{\"t\":" + now + ",\"ch\":{");
        boolean first = true;
        for (Map.Entry<String, List<String>> e : byChan.entrySet()) {
            if (!first) w.write(",");
            first = false;
            w.write(JSONObject.quote(e.getKey()));
            w.write(":[");
            List<String> l = e.getValue();
            for (int i = 0; i < l.size(); i++) { if (i > 0) w.write(","); w.write(l.get(i)); }
            w.write("]");
        }
        w.write("}}");
        w.close();
        if (out.exists()) out.delete();
        if (!tmp.renameTo(out)) throw new Exception("écriture impossible");
        return "file://" + out.getAbsolutePath() + "|" + byChan.size() + "|" + count;
    }
}
