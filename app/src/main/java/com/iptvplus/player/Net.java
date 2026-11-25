package com.iptvplus.player;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.GZIPInputStream;

/** Small HTTP helper: follows redirects (also http ↔ https), sends our User-Agent, unzips gzip. */
public final class Net {
    public static final String UA = "IPTVPlus/1.0 (Linux; Android)";

    private Net() { }

    public static final class Response {
        public HttpURLConnection conn;
        public int code;
        public InputStream body;
        public long length;
        public void close() { try { if (body != null) body.close(); } catch (Throwable ignored) { } if (conn != null) conn.disconnect(); }
    }

    public static Response open(String url, int connectTimeout, int readTimeout) throws Exception { return open(url, connectTimeout, readTimeout, null); }

    /** range: e.g. "bytes=1000-" to resume a download, or null */
    public static Response open(String url, int connectTimeout, int readTimeout, String range) throws Exception {
        String target = url;
        HttpURLConnection c = null;
        int code = 0;
        for (int hop = 0; hop < 6; hop++) {
            c = (HttpURLConnection) new URL(target).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(connectTimeout);
            c.setReadTimeout(readTimeout);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "*/*");
            if (range != null) c.setRequestProperty("Range", range);
            else c.setRequestProperty("Accept-Encoding", "gzip");
            code = c.getResponseCode();
            String loc = c.getHeaderField("Location");
            if (code >= 300 && code < 400 && loc != null) {
                target = new URL(new URL(target), loc).toString();
                c.disconnect();
                continue;
            }
            break;
        }
        Response r = new Response();
        r.conn = c;
        r.code = code;
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in != null && "gzip".equalsIgnoreCase(c.getContentEncoding())) in = new GZIPInputStream(in);
        r.body = in;
        r.length = -1;
        try { String cl = c.getHeaderField("Content-Length"); if (cl != null) r.length = Long.parseLong(cl.trim()); } catch (Exception ignored) { }
        return r;
    }
}
