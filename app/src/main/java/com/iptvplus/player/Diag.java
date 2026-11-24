package com.iptvplus.player;

import android.content.Context;
import android.os.Build;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.Locale;

/** Small diagnostic journal + crash report, readable from Paramètres → Diagnostic. */
public final class Diag {
    private static final ArrayDeque<String> lines = new ArrayDeque<String>();
    private static File dir;
    private static final SimpleDateFormat fmt = new SimpleDateFormat("HH:mm:ss", Locale.FRANCE);

    private Diag() { }

    public static void init(Context ctx) {
        dir = ctx.getFilesDir();
        // The previous session was still in the foreground when the process died (native crash, freeze, out of memory)
        File alive = new File(dir, "alive.flag");
        File prevJournal = new File(dir, "journal.txt");
        if (alive.exists() && !new File(dir, "crash.txt").exists()) {
            String j = read(prevJournal, 20000);
            writeCrashRaw("Fermeture inattendue de l'appli pendant son utilisation (plantage du lecteur, blocage ou manque de mémoire).\n\n--- Journal de la session précédente ---\n" + j);
        }
        alive.delete();
        prevJournal.delete();
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override public void uncaughtException(Thread t, Throwable e) {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                writeCrash("Plantage (thread " + t.getName() + ")\n" + sw);
                if (previous != null) previous.uncaughtException(t, e);
            }
        });
    }

    public static synchronized void log(String msg) {
        String line = fmt.format(new Date()) + "  " + msg;
        lines.addLast(line);
        while (lines.size() > 150) lines.removeFirst();
        android.util.Log.d("IPTVPlus", msg);
        if (dir != null) {
            try {
                File f = new File(dir, "journal.txt");
                if (f.length() > 60000) { FileOutputStream o = new FileOutputStream(f); o.write(journal().getBytes("UTF-8")); o.close(); }
                FileOutputStream out = new FileOutputStream(f, true);
                out.write((line + "\n").getBytes("UTF-8"));
                out.close();
            } catch (Throwable ignored) { }
        }
    }

    /** Foreground marker: present while the app is visible, removed when it goes to the background. */
    public static void setAlive(boolean on) {
        if (dir == null) return;
        File f = new File(dir, "alive.flag");
        try { if (on) new FileOutputStream(f).close(); else f.delete(); } catch (Throwable ignored) { }
    }

    private static String read(File f, int max) {
        if (!f.exists()) return "";
        try {
            int len = (int) Math.min(f.length(), max);
            java.io.RandomAccessFile r = new java.io.RandomAccessFile(f, "r");
            r.seek(Math.max(0, f.length() - len));
            byte[] b = new byte[len];
            r.readFully(b);
            r.close();
            return new String(b, "UTF-8");
        } catch (Throwable e) { return ""; }
    }

    public static synchronized String journal() {
        StringBuilder b = new StringBuilder();
        for (String l : lines) b.append(l).append('\n');
        return b.toString();
    }

    public static void writeCrash(String text) {
        writeCrashRaw(text + "\n\n--- Journal ---\n" + journal());
    }

    private static void writeCrashRaw(String text) {
        if (dir == null) return;
        try {
            String header = "IPTV+ · " + new SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.FRANCE).format(new Date())
                    + " · Android " + Build.VERSION.RELEASE + " · " + Build.MANUFACTURER + " " + Build.MODEL + "\n";
            FileOutputStream out = new FileOutputStream(new File(dir, "crash.txt"));
            out.write((header + text).getBytes("UTF-8"));
            out.close();
        } catch (Throwable ignored) { }
    }

    /** Returns the last crash report once, then deletes it. */
    public static String takeCrash() {
        if (dir == null) return "";
        File f = new File(dir, "crash.txt");
        String s = read(f, 60000);
        f.delete();
        return s;
    }
}
