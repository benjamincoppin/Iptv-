package com.iptvplus.player;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Small web server to get the recordings from a computer on the same local network:
 * http://<ip>:<port> → code → list of recordings → download (or open in VLC).
 * Off by default, protected by a 4-digit code, stops after 1 hour without activity.
 */
public final class ShareServer {
    private ShareServer() { }

    private static ServerSocket server;
    private static ExecutorService pool;
    private static Context app;
    private static volatile String pin = "", token = "", url = "";
    private static volatile long lastActivity = 0;
    private static final AtomicInteger transfers = new AtomicInteger();
    private static int failures = 0;
    private static long lockedUntil = 0;
    static final long IDLE_MS = 3600000L;

    public static synchronized boolean running() { return server != null && !server.isClosed(); }

    public static String state() {
        JSONObject o = new JSONObject();
        try {
            o.put("running", running());
            if (running()) { o.put("url", url); o.put("pin", pin); o.put("transfers", transfers.get()); }
        } catch (Exception ignored) { }
        return o.toString();
    }

    static long idleFor() { return transfers.get() > 0 ? 0 : System.currentTimeMillis() - lastActivity; }

    public static synchronized String start(Context ctx) throws Exception {
        app = ctx.getApplicationContext();
        if (running()) return state();
        String ip = localIp();
        if (ip == null) throw new Exception("L'appareil n'est connecté à aucun réseau local (Wi-Fi ou Ethernet)");
        ServerSocket s = null;
        for (int port = 8080; port <= 8090 && s == null; port++) {
            try { s = new ServerSocket(); s.setReuseAddress(true); s.bind(new InetSocketAddress(port)); }
            catch (Exception e) { try { if (s != null) s.close(); } catch (Exception ignored) { } s = null; }
        }
        if (s == null) throw new Exception("Aucun port disponible");
        SecureRandom r = new SecureRandom();
        pin = String.format(Locale.ROOT, "%04d", r.nextInt(10000));
        byte[] t = new byte[16]; r.nextBytes(t);
        StringBuilder hex = new StringBuilder(); for (byte b : t) hex.append(String.format("%02x", b));
        token = hex.toString();
        url = "http://" + ip + ":" + s.getLocalPort();
        failures = 0; lockedUntil = 0;
        lastActivity = System.currentTimeMillis();
        server = s;
        pool = Executors.newCachedThreadPool();
        final ServerSocket srv = s;
        new Thread(new Runnable() {
            @Override public void run() {
                while (!srv.isClosed()) {
                    try {
                        final Socket c = srv.accept();
                        pool.execute(new Runnable() { @Override public void run() { handle(c); } });
                    } catch (Exception e) { if (srv.isClosed()) break; }
                }
            }
        }, "share-accept").start();
        Diag.log("Partage réseau démarré : " + url);
        return state();
    }

    public static synchronized void stop() {
        try { if (server != null) server.close(); } catch (Exception ignored) { }
        server = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
        pin = ""; token = ""; url = "";
    }

    static String localIp() {
        String best = null;
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName().toLowerCase(Locale.ROOT);
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    String ip = a.getHostAddress();
                    if (n.startsWith("wlan") || n.startsWith("eth")) return ip;
                    if (best == null) best = ip;
                }
            }
        } catch (Exception ignored) { }
        return best;
    }

    // ---------- HTTP ----------
    private static final class Req { String method, path, query = "", cookie = "", range = null, body = ""; }

    private static void handle(Socket c) {
        try {
            c.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(c.getInputStream());
            OutputStream out = c.getOutputStream();
            Req q = read(in);
            if (q == null) { c.close(); return; }
            lastActivity = System.currentTimeMillis();
            route(q, out);
            out.flush();
        } catch (Exception ignored) {
        } finally { try { c.close(); } catch (Exception ignored) { } }
    }

    private static Req read(InputStream in) throws Exception {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int b, last4 = 0;
        while ((b = in.read()) >= 0) {
            head.write(b);
            if (head.size() > 16384) return null;
            last4 = (last4 << 8) | (b & 0xff);
            if (last4 == 0x0d0a0d0a || (last4 & 0xffff) == 0x0a0a) break;
        }
        String[] lines = head.toString("ISO-8859-1").split("\r?\n");
        if (lines.length == 0) return null;
        String[] first = lines[0].split(" ");
        if (first.length < 2) return null;
        Req q = new Req();
        q.method = first[0];
        String target = first[1];
        int qi = target.indexOf('?');
        q.path = qi >= 0 ? target.substring(0, qi) : target;
        if (qi >= 0) q.query = target.substring(qi + 1);
        int len = 0;
        for (int i = 1; i < lines.length; i++) {
            int k = lines[i].indexOf(':');
            if (k <= 0) continue;
            String name = lines[i].substring(0, k).trim().toLowerCase(Locale.ROOT), val = lines[i].substring(k + 1).trim();
            if (name.equals("cookie")) q.cookie = val;
            else if (name.equals("range")) q.range = val;
            else if (name.equals("content-length")) { try { len = Integer.parseInt(val); } catch (Exception ignored) { } }
        }
        if (len > 0 && len < 4096) {
            byte[] body = new byte[len]; int off = 0, n;
            while (off < len && (n = in.read(body, off, len - off)) > 0) off += n;
            q.body = new String(body, 0, off, "UTF-8");
        }
        return q;
    }

    private static String param(String qs, String key) {
        for (String kv : qs.split("&")) {
            int e = kv.indexOf('=');
            if (e > 0 && kv.substring(0, e).equals(key)) { try { return URLDecoder.decode(kv.substring(e + 1), "UTF-8"); } catch (Exception ex) { return ""; } }
        }
        return null;
    }

    private static boolean authed(Req q) {
        if (token.length() == 0) return false;
        if (token.equals(param(q.query, "k"))) return true;
        for (String part : q.cookie.split(";")) if (part.trim().equals("ipt=" + token)) return true;
        return false;
    }

    private static void route(Req q, OutputStream out) throws Exception {
        if (q.path.equals("/login") && q.method.equals("POST")) {
            long now = System.currentTimeMillis();
            String given = param(q.body, "pin");
            if (now < lockedUntil) { page(out, 200, loginPage("Trop d'essais. Réessaie dans quelques minutes."), null); return; }
            if (given != null && given.trim().equals(pin)) {
                failures = 0;
                head(out, 303, "text/plain", 0, new String[]{ "Location: /", "Set-Cookie: ipt=" + token + "; Path=/; HttpOnly; SameSite=Strict" });
                return;
            }
            if (++failures >= 8) { lockedUntil = now + 5 * 60000L; failures = 0; }
            page(out, 200, loginPage("Code incorrect."), null);
            return;
        }
        if (!authed(q)) { page(out, q.path.equals("/") ? 200 : 401, loginPage(null), null); return; }
        if (q.path.equals("/")) { page(out, 200, listPage(), null); return; }
        if (q.path.startsWith("/f/")) { file(q, out, URLDecoder.decode(q.path.substring(3), "UTF-8")); return; }
        page(out, 404, "<p>Introuvable</p>", null);
    }

    private static void head(OutputStream out, int code, String type, long len, String[] extra) throws Exception {
        String status = code == 200 ? "OK" : code == 206 ? "Partial Content" : code == 303 ? "See Other" : code == 401 ? "Unauthorized" : code == 404 ? "Not Found" : code == 416 ? "Range Not Satisfiable" : "Error";
        StringBuilder h = new StringBuilder("HTTP/1.1 " + code + " " + status + "\r\n");
        h.append("Content-Type: ").append(type).append("\r\n");
        if (len >= 0) h.append("Content-Length: ").append(len).append("\r\n");
        h.append("Connection: close\r\nCache-Control: no-store\r\nX-Robots-Tag: noindex\r\n");
        if (extra != null) for (String e : extra) h.append(e).append("\r\n");
        h.append("\r\n");
        out.write(h.toString().getBytes("UTF-8"));
    }

    private static void page(OutputStream out, int code, String body, String[] extra) throws Exception {
        byte[] b = html(body).getBytes("UTF-8");
        head(out, code, "text/html; charset=utf-8", b.length, extra);
        out.write(b);
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String html(String body) {
        return "<!DOCTYPE html><html lang=fr><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><meta name=robots content=noindex>" +
                "<title>IPTV+ · Enregistrements</title><style>" +
                "body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0d0d10;color:#eee}" +
                ".w{max-width:860px;margin:0 auto;padding:28px 20px}h1{font-size:26px;margin:0 0 4px}h1 b{color:#ff6b35}p.m{color:#999;font-size:14px;margin:0 0 22px}" +
                ".r{display:flex;align-items:center;gap:14px;background:#1a1a1f;border-radius:10px;padding:14px 16px;margin-bottom:10px}.r .t{flex:1;min-width:0}" +
                ".r b{display:block;font-size:15px}.r small{color:#999;font-size:13px}.a{display:flex;gap:8px;flex-wrap:wrap}" +
                "a.b,button{background:#ff6b35;color:#fff;border:0;border-radius:8px;padding:9px 14px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer}" +
                "a.s{background:#2b2b31}input{font-size:28px;letter-spacing:10px;width:150px;text-align:center;padding:10px;border-radius:8px;border:1px solid #444;background:#1a1a1f;color:#fff}" +
                ".e{color:#ffb74d}.n{color:#999;font-size:12px;margin-top:26px;line-height:1.6}</style></head><body><div class=w>" + body + "</div></body></html>";
    }

    private static String loginPage(String err) {
        return "<h1>IPTV<b>+</b></h1><p class=m>Saisis le code affiché sur la TV ou le téléphone (page Enregistrements › Partage sur le réseau).</p>" +
                (err != null ? "<p class=e>" + esc(err) + "</p>" : "") +
                "<form method=post action=/login><input name=pin inputmode=numeric maxlength=4 autofocus autocomplete=off> <button>Valider</button></form>";
    }

    private static String listPage() {
        StringBuilder b = new StringBuilder("<h1>IPTV<b>+</b> · Enregistrements</h1><p class=m>Clique sur « Télécharger » pour copier le fichier sur cet ordinateur. Le lien VLC permet de le regarder sans le copier.</p>");
        JSONArray a = RecStore.all(app);
        SimpleDateFormat df = new SimpleDateFormat("EEE d MMM yyyy 'à' HH'h'mm", Locale.FRANCE);
        int count = 0;
        for (int i = a.length() - 1; i >= 0; i--) {
            JSONObject r = a.optJSONObject(i);
            if (r == null) continue;
            String st = r.optString("status"), file = r.optString("file");
            boolean active = RecordingService.isActive(r.optString("id"));
            if (file.length() == 0 || !(st.equals("done") || active)) continue;
            count++;
            String id = r.optString("id");
            String enc;
            try { enc = URLEncoder.encode(id, "UTF-8"); } catch (Exception e) { enc = id; }
            long size = active ? -1 : RecStorage.length(app, file);
            b.append("<div class=r><div class=t><b>").append(esc(r.optString("title"))).append("</b><small>")
                    .append(esc(r.optString("channel"))).append(" · ").append(esc(df.format(new Date(r.optLong("progStart", r.optLong("start"))))));
            if (active) b.append(" · <span class=e>en cours…</span>");
            else if (size >= 0) b.append(" · ").append(RecordingService.mb(size));
            else b.append(" · <span class=e>fichier introuvable</span>");
            b.append("</small></div>");
            if (!active && size >= 0) {
                b.append("<div class=a><a class=b href='/f/").append(enc).append("?dl=1'>Télécharger</a>")
                        .append("<a class='b s' href='/f/").append(enc).append("?k=").append(token).append("' title='Copier ce lien dans VLC › Média › Ouvrir un flux réseau'>Lien VLC</a></div>");
            }
            b.append("</div>");
        }
        if (count == 0) b.append("<p>Aucun enregistrement terminé pour l'instant.</p>");
        b.append("<p class=n>Les fichiers sont au format .ts (lisibles avec VLC). Le partage s'arrête tout seul après 1 heure sans activité.</p>");
        return b.toString();
    }

    private static void file(Req q, OutputStream out, String id) throws Exception {
        JSONObject r = RecStore.get(app, id);
        if (r == null || r.optString("file").length() == 0) { page(out, 404, "<p>Enregistrement introuvable</p>", null); return; }
        String uri = r.optString("file");
        long size = RecStorage.length(app, uri);
        if (size < 0) { page(out, 404, "<p>Fichier introuvable (clé USB débranchée ?)</p>", null); return; }
        long start = 0, end = size - 1;
        boolean partial = false;
        if (q.range != null && q.range.startsWith("bytes=")) {
            String[] p = q.range.substring(6).split(",")[0].trim().split("-", -1);
            try {
                if (p[0].length() == 0) { start = Math.max(0, size - Long.parseLong(p[1])); }
                else { start = Long.parseLong(p[0]); if (p.length > 1 && p[1].length() > 0) end = Math.min(size - 1, Long.parseLong(p[1])); }
                partial = true;
            } catch (Exception ignored) { }
            if (start > end || start >= size) { head(out, 416, "text/plain", 0, new String[]{ "Content-Range: bytes */" + size }); return; }
        }
        String name = r.optString("name", "enregistrement.ts");
        String ascii = name.replaceAll("[^\\x20-\\x7E]", "_").replace("\"", "'");
        String disp = (q.query.contains("dl=1") ? "attachment" : "inline") + "; filename=\"" + ascii + "\"; filename*=UTF-8''" + URLEncoder.encode(name, "UTF-8").replace("+", "%20");
        String[] extra = partial
                ? new String[]{ "Accept-Ranges: bytes", "Content-Range: bytes " + start + "-" + end + "/" + size, "Content-Disposition: " + disp }
                : new String[]{ "Accept-Ranges: bytes", "Content-Disposition: " + disp };
        head(out, partial ? 206 : 200, "video/mp2t", end - start + 1, extra);
        if (q.method.equals("HEAD")) return;
        transfers.incrementAndGet();
        InputStream in = null;
        try {
            in = RecStorage.open(app, uri, start);
            byte[] buf = new byte[262144];
            long left = end - start + 1;
            int n;
            while (left > 0 && (n = in.read(buf, 0, (int) Math.min(buf.length, left))) > 0) {
                out.write(buf, 0, n);
                left -= n;
                lastActivity = System.currentTimeMillis();
            }
        } finally {
            transfers.decrementAndGet();
            lastActivity = System.currentTimeMillis();
            try { if (in != null) in.close(); } catch (Exception ignored) { }
        }
    }
}
