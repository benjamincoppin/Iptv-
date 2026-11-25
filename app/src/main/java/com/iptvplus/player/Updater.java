package com.iptvplus.player;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Downloads a new APK (GitHub release) and opens the Android installer. */
public final class Updater {

    public interface Progress { void on(String state, int pct, String msg); }

    private static volatile boolean running = false;

    private Updater() { }

    public static void install(final Activity act, final String url, final Progress cb) {
        if (running) return;
        running = true;
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection c = null;
                try {
                    File dir = new File(act.getCacheDir(), "updates");
                    dir.mkdirs();
                    File apk = new File(dir, "IPTVPlus-update.apk");
                    if (apk.exists()) apk.delete();

                    String target = url;
                    for (int hop = 0; hop < 6; hop++) {
                        c = (HttpURLConnection) new URL(target).openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(60000);
                        c.setRequestProperty("User-Agent", "IPTVPlus-Updater");
                        int code = c.getResponseCode();
                        if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                            target = new URL(new URL(target), c.getHeaderField("Location")).toString();
                            c.disconnect();
                            continue;
                        }
                        if (code != 200) throw new Exception("HTTP " + code);
                        break;
                    }
                    long total = c.getContentLength();
                    InputStream in = c.getInputStream();
                    FileOutputStream out = new FileOutputStream(apk);
                    byte[] buf = new byte[65536];
                    long done = 0;
                    int n, last = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : -1;
                        if (pct != last) { last = pct; cb.on("download", pct, null); }
                    }
                    out.close();
                    in.close();
                    Diag.log("Mise à jour téléchargée (" + (done / 1024) + " Ko)");
                    openInstaller(act, apk, cb);
                } catch (Throwable t) {
                    Diag.log("Mise à jour : " + t);
                    cb.on("error", 0, String.valueOf(t.getMessage()));
                } finally {
                    if (c != null) c.disconnect();
                    running = false;
                }
            }
        }).start();
    }

    private static void openInstaller(final Activity act, final File apk, final Progress cb) {
        act.runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
                        // The user must allow IPTV+ to install apps once, then press "Installer" again
                        cb.on("permission", 100, null);
                        Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()));
                        act.startActivity(s);
                        return;
                    }
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    Uri uri;
                    if (Build.VERSION.SDK_INT >= 24) {
                        uri = FileProvider.getUriForFile(act, act.getPackageName() + ".files", apk);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } else {
                        apk.setReadable(true, false);
                        uri = Uri.fromFile(apk);
                    }
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    act.startActivity(i);
                    cb.on("installing", 100, null);
                } catch (Throwable t) {
                    Diag.log("Installation : " + t);
                    cb.on("error", 0, String.valueOf(t.getMessage()));
                }
            }
        });
    }
}
