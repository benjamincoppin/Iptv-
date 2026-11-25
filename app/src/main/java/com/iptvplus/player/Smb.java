package com.iptvplus.player;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.util.Properties;

import jcifs.CIFSContext;
import jcifs.config.PropertyConfiguration;
import jcifs.context.BaseContext;
import jcifs.smb.NtlmPasswordAuthenticator;
import jcifs.smb.SmbFile;
import jcifs.smb.SmbFileOutputStream;

/**
 * Shared folder of a computer or NAS on the local network (Windows share / SMB 2-3).
 * Settings: address (\\PC\Share\Folder or 192.168.1.20/Share), user name, password.
 */
public final class Smb {
    private Smb() { }

    private static final String PREFS = "recordings_smb";
    private static CIFSContext base;
    private static CIFSContext cached;
    private static String cachedKey;

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static JSONObject config(Context ctx) {
        try { return new JSONObject(prefs(ctx).getString("cfg", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Config without the password, for the settings screen. */
    public static String publicConfig(Context ctx) {
        JSONObject c = config(ctx);
        JSONObject o = new JSONObject();
        try {
            o.put("address", c.optString("address"));
            o.put("user", c.optString("user"));
            o.put("hasPass", c.optString("pass").length() > 0);
            o.put("active", RecStore.folder(ctx).startsWith("smb://"));
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** Saves the settings (an empty password keeps the previous one) and returns the folder URL. */
    public static String save(Context ctx, JSONObject in) throws Exception {
        JSONObject c = config(ctx);
        c.put("address", in.optString("address").trim());
        c.put("user", in.optString("user").trim());
        if (in.has("pass") && in.optString("pass").length() > 0) c.put("pass", in.optString("pass"));
        if (in.optBoolean("clearPass")) c.put("pass", "");
        prefs(ctx).edit().putString("cfg", c.toString()).apply();
        cached = null;
        return dirUrl(c);
    }

    /** "\\PC\Partage\Dossier", "smb://pc/partage", "192.168.1.20/Partage/Dossier" → smb://host/share/folder/ */
    public static String dirUrl(JSONObject c) throws Exception {
        String a = c.optString("address").trim().replace('\\', '/');
        if (a.toLowerCase().startsWith("smb:")) a = a.substring(4);
        while (a.startsWith("/")) a = a.substring(1);
        while (a.endsWith("/")) a = a.substring(0, a.length() - 1);
        String[] parts = a.split("/+");
        if (parts.length < 2 || parts[0].length() == 0 || parts[1].length() == 0)
            throw new Exception("Adresse incomplète : indique l'ordinateur et le dossier partagé, par exemple \\\\192.168.1.20\\Videos");
        StringBuilder b = new StringBuilder("smb://");
        for (int i = 0; i < parts.length; i++) b.append(parts[i]).append('/');
        return b.toString();
    }

    private static synchronized CIFSContext ctx(Context ctx) throws Exception {
        JSONObject c = config(ctx);
        String key = c.optString("user") + "\n" + c.optString("pass");
        if (cached != null && key.equals(cachedKey)) return cached;
        if (base == null) {
            Properties p = new Properties();
            p.setProperty("jcifs.smb.client.minVersion", "SMB202");
            p.setProperty("jcifs.smb.client.maxVersion", "SMB311");
            p.setProperty("jcifs.resolveOrder", "DNS,BCAST");
            p.setProperty("jcifs.smb.client.connTimeout", "10000");
            p.setProperty("jcifs.smb.client.responseTimeout", "30000");
            p.setProperty("jcifs.smb.client.soTimeout", "60000");
            p.setProperty("jcifs.smb.client.ipcSigningEnforced", "false");
            base = new BaseContext(new PropertyConfiguration(p));
        }
        String user = c.optString("user"), domain = "";
        int bs = user.indexOf('\\');
        if (bs > 0) { domain = user.substring(0, bs); user = user.substring(bs + 1); }
        cached = user.length() == 0 ? base.withAnonymousCredentials() : base.withCredentials(new NtlmPasswordAuthenticator(domain, user, c.optString("pass")));
        cachedKey = key;
        return cached;
    }

    private static String friendly(Throwable t) {
        String m = String.valueOf(t.getMessage());
        String l = m.toLowerCase();
        if (l.contains("logon failure") || l.contains("access is denied") || l.contains("access_denied")) return "Identifiant ou mot de passe refusé par l'ordinateur";
        if (l.contains("bad network name") || l.contains("object_name_not_found") || l.contains("cannot find")) return "Dossier partagé introuvable sur cet ordinateur";
        if (l.contains("unknownhost") || l.contains("failed to connect") || l.contains("timed out") || l.contains("connect")) return "Ordinateur injoignable (allumé ? même réseau ?)";
        return m;
    }

    public static final class Out { public OutputStream stream; public String uri; }

    public static Out create(Context ctx, String dir, String name) throws Exception {
        try {
            SmbFile d = new SmbFile(dir, ctx(ctx));
            if (!d.exists()) d.mkdirs();
            SmbFile f = new SmbFile(d, name);
            Out o = new Out();
            o.stream = new java.io.BufferedOutputStream(new SmbFileOutputStream(f), 1 << 20);
            o.uri = f.getURL().toString();
            return o;
        } catch (Throwable t) { throw new Exception(friendly(t)); }
    }

    /** Writes then deletes a small file. Returns null when it works, else a readable error. */
    public static String test(Context ctx) {
        try {
            String dir = dirUrl(config(ctx));
            Out o = create(ctx, dir, ".iptvplus-test");
            o.stream.write("ok".getBytes("UTF-8"));
            o.stream.close();
            new SmbFile(o.uri, ctx(ctx)).delete();
            return null;
        } catch (Throwable t) { return friendly(t); }
    }

    public static boolean exists(Context ctx, String uri) {
        try { return new SmbFile(uri, ctx(ctx)).exists(); } catch (Throwable t) { return false; }
    }

    public static boolean delete(Context ctx, String uri) {
        try { new SmbFile(uri, ctx(ctx)).delete(); return true; } catch (Throwable t) { return false; }
    }

    public static long length(Context ctx, String uri) throws Exception {
        return new SmbFile(uri, ctx(ctx)).length();
    }

    public static InputStream open(Context ctx, String uri, long offset) throws Exception {
        InputStream in = new SmbFile(uri, ctx(ctx)).openInputStream();
        long left = offset;
        while (left > 0) { long s = in.skip(left); if (s <= 0) break; left -= s; }
        return in;
    }

    /** URL VLC can open (credentials embedded). */
    public static String playUrl(Context ctx, String uri) {
        JSONObject c = config(ctx);
        String user = c.optString("user");
        if (user.length() == 0) return uri;
        try {
            String cred = URLEncoder.encode(user.replace('\\', ';'), "UTF-8").replace("+", "%20") + ":" + URLEncoder.encode(c.optString("pass"), "UTF-8").replace("+", "%20") + "@";
            String rest = uri.substring(6);
            StringBuilder b = new StringBuilder();
            for (String seg : rest.split("/", -1)) {
                if (b.length() > 0) b.append('/');
                String dec = seg;
                try { dec = java.net.URLDecoder.decode(seg.replace("+", "%2B"), "UTF-8"); } catch (Exception ignored) { }
                b.append(URLEncoder.encode(dec, "UTF-8").replace("+", "%20"));
            }
            return "smb://" + cred + b;
        } catch (Exception e) { return uri; }
    }

    public static String describe(String spec) {
        String s = spec.substring(6);
        if (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return "Ordinateur : \\\\" + s.replace('/', '\\');
    }
}
