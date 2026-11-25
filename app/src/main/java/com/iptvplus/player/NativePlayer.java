package com.iptvplus.player;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.view.View;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;
import java.util.Map;

/**
 * Video player built on LibVLC (official VideoLAN library).
 *
 * Stability rules:
 *  - every LibVLC control call (play, stop, seek, tracks…) runs on ONE dedicated background thread,
 *    so a slow network stop/start can never freeze the UI (which Android kills as "not responding");
 *  - position / duration / tracks are cached from events, never read synchronously from the UI;
 *  - the video output is detached when the app goes to the background and re-attached on return,
 *    so LibVLC never draws on a destroyed surface.
 */
public class NativePlayer {

    public interface Listener { void onPlayerEvent(String type, String json); }

    private final Context ctx;
    private final FrameLayout box;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final HandlerThread thread;
    private final Handler worker;

    private LibVLC vlc;
    private MediaPlayer mp;
    private VLCVideoLayout layout;

    private volatile boolean prepared = false;
    private volatile boolean buffering = false;
    private volatile boolean playing = false;
    private volatile long time = 0, length = 0;
    private volatile String tracksJson = "[]";
    private volatile int generation = 0;
    private volatile boolean attached = false;
    private volatile boolean released = false;
    private String aspect = "auto";

    public NativePlayer(Context ctx, FrameLayout box, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.box = box;
        this.listener = listener;
        thread = new HandlerThread("iptvplus-vlc");
        thread.start();
        worker = new Handler(thread.getLooper());

        layout = new VLCVideoLayout(ctx);
        box.addView(layout, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        createVlc();
        attachViews();
    }

    // Subtitle style needs a new LibVLC instance: rebuilt before the next playback when it changes
    private String subSize = "normal", subColor = "white";
    private volatile boolean styleDirty = false;

    private void createVlc() {
        ArrayList<String> opts = new ArrayList<String>();
        opts.add("--http-reconnect");
        opts.add("--audio-time-stretch");
        opts.add("--no-stats");
        opts.add("--no-sub-autodetect-file");
        opts.add("--avcodec-skiploopfilter=1");
        int rel = "small".equals(subSize) ? 20 : "large".equals(subSize) ? 12 : "huge".equals(subSize) ? 9 : 16;
        opts.add("--freetype-rel-fontsize=" + rel);
        int color = "yellow".equals(subColor) ? 0xFFFF00 : 0xFFFFFF;
        opts.add("--freetype-color=" + color);
        opts.add("--freetype-outline-thickness=4");
        if ("box".equals(subColor)) {
            opts.add("--freetype-background-opacity=170");
            opts.add("--freetype-background-color=0");
        }
        vlc = new LibVLC(this.ctx, opts);
        mp = new MediaPlayer(vlc);
        mp.setEventListener(new MediaPlayer.EventListener() {
            @Override public void onEvent(MediaPlayer.Event ev) { onVlcEvent(ev); }
        });
    }

    /** size: small | normal | large | huge ; color: white | yellow | box (white on dark box) */
    public void setSubtitleStyle(String size, String color) {
        if (size == null) size = "normal";
        if (color == null) color = "white";
        if (size.equals(subSize) && color.equals(subColor)) return;
        subSize = size; subColor = color;
        styleDirty = true;
    }

    // Rebuild LibVLC with the new subtitle style (UI thread, nothing playing)
    private void rebuildIfNeeded() {
        if (!styleDirty || released) return;
        styleDirty = false;
        detachViews();
        final MediaPlayer oldMp = mp;
        final LibVLC oldVlc = vlc;
        createVlc();
        attachViews();
        worker.post(new Runnable() {
            @Override public void run() {
                try { oldMp.setEventListener(null); oldMp.stop(); } catch (Throwable ignored) { }
                try { oldMp.release(); } catch (Throwable ignored) { }
                try { oldVlc.release(); } catch (Throwable ignored) { }
            }
        });
    }

    // ---------- events (delivered on the main thread by LibVLC) ----------
    private void onVlcEvent(MediaPlayer.Event ev) {
        if (released) return;
        final int gen = generation;
        switch (ev.type) {
            case MediaPlayer.Event.Opening:
                buffering = true;
                emit("buffering", null);
                break;
            case MediaPlayer.Event.Buffering:
                boolean b = ev.getBuffering() < 100f;
                if (b != buffering) { buffering = b; emit(b ? "buffering" : "buffered", null); }
                break;
            case MediaPlayer.Event.Playing:
                playing = true;
                buffering = false;
                if (!prepared) {
                    prepared = true;
                    JSONObject o = new JSONObject();
                    try { o.put("duration", length); } catch (Exception ignored) { }
                    emit("prepared", o.toString());
                } else emit("buffered", null);
                refreshTracks(gen);
                break;
            case MediaPlayer.Event.Paused:
                playing = false;
                break;
            case MediaPlayer.Event.Stopped:
                playing = false;
                break;
            case MediaPlayer.Event.TimeChanged:
                time = ev.getTimeChanged();
                break;
            case MediaPlayer.Event.LengthChanged:
                length = ev.getLengthChanged();
                break;
            case MediaPlayer.Event.ESAdded:
                refreshTracks(gen);
                break;
            case MediaPlayer.Event.Vout:
                if (ev.getVoutCount() > 0) { buffering = false; emit("rendering", null); }
                break;
            case MediaPlayer.Event.EndReached:
                playing = false;
                emit("completed", null);
                break;
            case MediaPlayer.Event.EncounteredError:
                playing = false;
                prepared = false;
                emit("error", "{\"what\":1,\"extra\":0}");
                break;
            default:
                break;
        }
    }

    // ---------- controls (all on the worker thread) ----------
    public void play(final String url, final int startMs, final Map<String, String> headers) {
        rebuildIfNeeded();
        final int gen = ++generation;
        prepared = false; buffering = true; playing = false;
        time = 0; length = 0; tracksJson = "[]"; subsJson = "[]";
        box.setVisibility(View.VISIBLE);
        worker.removeCallbacksAndMessages(null);
        worker.post(new Runnable() {
            @Override public void run() {
                if (released || gen != generation) return;
                try {
                    if (mp.isPlaying() || mp.getMedia() != null) mp.stop();
                    if (gen != generation) return;
                    Media m = new Media(vlc, Uri.parse(url));
                    m.setHWDecoderEnabled(true, false);
                    boolean live = url.contains("/live/");
                    m.addOption(":network-caching=" + (live ? 2500 : 3000));
                    m.addOption(":http-reconnect");
                    if (headers != null && headers.get("User-Agent") != null) m.addOption(":http-user-agent=" + headers.get("User-Agent"));
                    if (startMs > 0) m.addOption(":start-time=" + (startMs / 1000.0));
                    mp.setMedia(m);
                    m.release();
                    if (gen != generation) return;
                    mp.play();
                    ui.post(new Runnable() { @Override public void run() { applyAspectNow(); } });
                } catch (Throwable t) {
                    Diag.log("play error: " + t);
                    emit("error", "{\"what\":-1,\"extra\":0}");
                }
            }
        });
    }

    public void stop() {
        ++generation;
        prepared = false; playing = false; buffering = false;
        box.setVisibility(View.INVISIBLE);
        worker.removeCallbacksAndMessages(null);
        worker.post(new Runnable() {
            @Override public void run() {
                if (released) return;
                try { mp.stop(); } catch (Throwable t) { Diag.log("stop error: " + t); }
            }
        });
    }

    public void pause() {
        worker.post(new Runnable() { @Override public void run() { try { if (!released && mp.isPlaying()) mp.pause(); } catch (Throwable ignored) { } } });
        playing = false;
    }

    public void resume() {
        worker.post(new Runnable() { @Override public void run() { try { if (!released && mp.getMedia() != null) mp.play(); } catch (Throwable ignored) { } } });
    }

    public void seekTo(final int ms) {
        time = ms;
        worker.post(new Runnable() { @Override public void run() { try { if (!released) mp.setTime(ms); } catch (Throwable ignored) { } } });
    }

    public boolean isPrepared() { return prepared; }
    public boolean isBuffering() { return buffering; }
    public boolean isPlaying() { return playing; }
    public int position() { return (int) Math.max(0, time); }
    public int duration() { return (int) Math.max(0, length); }

    // ---------- background / foreground ----------
    /** Call from Activity.onStop: free the surface before Android destroys it. */
    public void onBackground() {
        worker.post(new Runnable() { @Override public void run() { try { if (!released && mp.isPlaying()) mp.pause(); } catch (Throwable ignored) { } } });
        ui.post(new Runnable() { @Override public void run() { detachViews(); } });
    }

    /** Call from Activity.onStart. */
    public void onForeground() {
        ui.post(new Runnable() { @Override public void run() { attachViews(); } });
    }

    private void attachViews() {
        if (released || attached) return;
        try { mp.attachViews(layout, null, true, false); attached = true; applyAspectNow(); }
        catch (Throwable t) { Diag.log("attachViews: " + t); }
    }

    private void detachViews() {
        if (released || !attached) return;
        try { mp.detachViews(); } catch (Throwable t) { Diag.log("detachViews: " + t); }
        attached = false;
    }

    public void release() {
        if (released) return;
        ++generation;
        detachViews();
        released = true;
        worker.removeCallbacksAndMessages(null);
        final MediaPlayer p = mp;
        final LibVLC v = vlc;
        worker.post(new Runnable() {
            @Override public void run() {
                try { p.setEventListener(null); } catch (Throwable ignored) { }
                try { p.stop(); } catch (Throwable ignored) { }
                try { p.release(); } catch (Throwable ignored) { }
                try { v.release(); } catch (Throwable ignored) { }
                thread.quitSafely();
            }
        });
    }

    // ---------- picture format ----------
    public void setAspect(String mode) {
        aspect = mode == null ? "auto" : mode;
        ui.post(new Runnable() { @Override public void run() { applyAspectNow(); } });
    }

    private void applyAspectNow() {
        if (released) return;
        try {
            MediaPlayer.ScaleType t;
            if ("16:9".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_16_9;
            else if ("4:3".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_4_3;
            else if ("fill".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_FILL;
            else if ("zoom".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_FIT_SCREEN;
            else if ("original".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_ORIGINAL;
            else t = MediaPlayer.ScaleType.SURFACE_BEST_FIT;
            mp.setVideoScale(t);
        } catch (Throwable ignored) { }
    }

    // ---------- audio tracks ----------
    private void refreshTracks(final int gen) {
        worker.post(new Runnable() {
            @Override public void run() {
                if (released || gen != generation) return;
                JSONArray arr = new JSONArray();
                try {
                    MediaPlayer.TrackDescription[] t = mp.getAudioTracks();
                    int cur = mp.getAudioTrack();
                    if (t != null) {
                        for (MediaPlayer.TrackDescription d : t) {
                            if (d.id < 0) continue;
                            JSONObject o = new JSONObject();
                            o.put("index", d.id);
                            o.put("lang", d.name);
                            o.put("selected", d.id == cur);
                            arr.put(o);
                        }
                    }
                } catch (Throwable ignored) { }
                tracksJson = arr.toString();
                JSONArray subs = new JSONArray();
                try {
                    MediaPlayer.TrackDescription[] t = mp.getSpuTracks();
                    int cur = mp.getSpuTrack();
                    if (t != null) {
                        for (MediaPlayer.TrackDescription d : t) {
                            JSONObject o = new JSONObject();
                            o.put("index", d.id);
                            o.put("lang", d.id < 0 ? "Désactivés" : d.name);
                            o.put("selected", d.id == cur);
                            subs.put(o);
                        }
                    }
                } catch (Throwable ignored) { }
                subsJson = subs.toString();
            }
        });
    }

    public String audioTracks() { return tracksJson; }

    private volatile String subsJson = "[]";
    public String subTracks() { return subsJson; }

    public void selectSub(final int id) {
        final int gen = generation;
        worker.post(new Runnable() { @Override public void run() { try { if (!released) mp.setSpuTrack(id); } catch (Throwable ignored) { } } });
        refreshTracks(gen);
    }

    public void selectAudio(final int id) {
        final int gen = generation;
        worker.post(new Runnable() {
            @Override public void run() {
                try { if (!released) mp.setAudioTrack(id); } catch (Throwable ignored) { }
            }
        });
        refreshTracks(gen);
    }

    private void emit(String type, String json) {
        if (!"buffering".equals(type) && !"buffered".equals(type)) Diag.log("player " + type + (json != null ? " " + json : ""));
        listener.onPlayerEvent(type, json);
    }
}
