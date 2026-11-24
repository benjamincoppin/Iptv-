package com.iptvplus.player;

import android.content.Context;
import android.net.Uri;
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
 * Video player built on LibVLC (official VideoLAN library): decodes every common audio
 * format in software (AC3, E-AC3, DTS, TrueHD…) and handles picture format (ratio / stretch / zoom).
 */
public class NativePlayer {

    public interface Listener { void onPlayerEvent(String type, String json); }

    private final FrameLayout box;
    private final Listener listener;
    private final LibVLC vlc;
    private final MediaPlayer mp;
    private final VLCVideoLayout layout;

    private boolean prepared = false;
    private boolean buffering = false;
    private boolean active = false;
    private String aspect = "auto";

    public NativePlayer(Context ctx, FrameLayout box, Listener listener) {
        this.box = box;
        this.listener = listener;

        ArrayList<String> opts = new ArrayList<String>();
        opts.add("--http-reconnect");
        opts.add("--audio-time-stretch");
        opts.add("--no-stats");
        opts.add("--no-sub-autodetect-file");
        vlc = new LibVLC(ctx, opts);
        mp = new MediaPlayer(vlc);

        layout = new VLCVideoLayout(ctx);
        box.addView(layout, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        mp.attachViews(layout, null, false, false);
        applyAspect();

        mp.setEventListener(new MediaPlayer.EventListener() {
            @Override public void onEvent(MediaPlayer.Event ev) {
                if (!active) return;
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
                        buffering = false;
                        if (!prepared) {
                            prepared = true;
                            JSONObject o = new JSONObject();
                            try { o.put("duration", duration()); } catch (Exception ignored) { }
                            emit("prepared", o.toString());
                        } else emit("buffered", null);
                        break;
                    case MediaPlayer.Event.Vout:
                        if (ev.getVoutCount() > 0) { buffering = false; emit("rendering", null); }
                        break;
                    case MediaPlayer.Event.EndReached:
                        emit("completed", null);
                        break;
                    case MediaPlayer.Event.EncounteredError:
                        prepared = false;
                        emit("error", "{\"what\":1,\"extra\":0}");
                        break;
                    default:
                        break;
                }
            }
        });
    }

    public void play(String url, int startMs, Map<String, String> headers) {
        prepared = false;
        buffering = true;
        active = true;
        box.setVisibility(View.VISIBLE);
        try {
            mp.stop();
            Media m = new Media(vlc, Uri.parse(url));
            m.setHWDecoderEnabled(true, false);
            boolean live = url.contains("/live/");
            m.addOption(":network-caching=" + (live ? 2000 : 3000));
            if (headers != null && headers.get("User-Agent") != null) m.addOption(":http-user-agent=" + headers.get("User-Agent"));
            if (startMs > 0) m.addOption(":start-time=" + (startMs / 1000.0));
            mp.setMedia(m);
            m.release();
            mp.play();
            applyAspect();
        } catch (Exception e) {
            emit("error", "{\"what\":-1,\"extra\":0}");
        }
    }

    public void stop() {
        active = false;
        prepared = false;
        try { mp.stop(); } catch (Exception ignored) { }
        box.setVisibility(View.INVISIBLE);
    }

    public void release() {
        stop();
        try { mp.detachViews(); } catch (Exception ignored) { }
        try { mp.release(); } catch (Exception ignored) { }
        try { vlc.release(); } catch (Exception ignored) { }
    }

    public void pause() { try { if (mp.isPlaying()) mp.pause(); } catch (Exception ignored) { } }
    public void resume() { try { mp.play(); } catch (Exception ignored) { } }
    public void seekTo(int ms) { try { mp.setTime(ms); } catch (Exception ignored) { } }
    public boolean isPrepared() { return prepared; }
    public boolean isBuffering() { return buffering; }
    public boolean isPlaying() { try { return mp.isPlaying(); } catch (Exception e) { return false; } }
    public int position() { try { long t = mp.getTime(); return t < 0 ? 0 : (int) t; } catch (Exception e) { return 0; } }
    public int duration() { try { long d = mp.getLength(); return d < 0 ? 0 : (int) d; } catch (Exception e) { return 0; } }

    // ---------- picture format ----------
    public void setAspect(String mode) {
        aspect = mode == null ? "auto" : mode;
        applyAspect();
    }

    private void applyAspect() {
        try {
            MediaPlayer.ScaleType t;
            if ("16:9".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_16_9;
            else if ("4:3".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_4_3;
            else if ("fill".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_FILL;
            else if ("zoom".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_FIT_SCREEN;
            else if ("original".equals(aspect)) t = MediaPlayer.ScaleType.SURFACE_ORIGINAL;
            else t = MediaPlayer.ScaleType.SURFACE_BEST_FIT;
            mp.setVideoScale(t);
        } catch (Exception ignored) { }
    }

    // ---------- audio tracks ----------
    public String audioTracks() {
        JSONArray arr = new JSONArray();
        try {
            MediaPlayer.TrackDescription[] t = mp.getAudioTracks();
            int cur = mp.getAudioTrack();
            if (t != null) {
                for (MediaPlayer.TrackDescription d : t) {
                    if (d.id < 0) continue; // "Désactiver"
                    JSONObject o = new JSONObject();
                    o.put("index", d.id);
                    o.put("lang", d.name);
                    o.put("selected", d.id == cur);
                    arr.put(o);
                }
            }
        } catch (Exception ignored) { }
        return arr.toString();
    }

    public void selectAudio(int id) {
        try { mp.setAudioTrack(id); } catch (Exception ignored) { }
    }

    private void emit(String type, String json) { listener.onPlayerEvent(type, json); }
}
