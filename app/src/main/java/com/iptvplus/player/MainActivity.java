package com.iptvplus.player;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final String UA = "IPTVPlus/1.0 (Linux; Android)";

    private FrameLayout root;
    private FrameLayout videoBox;
    private NativePlayer player;
    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    private volatile boolean prepared = false;
    private volatile boolean buffering = false;
    private volatile int lastPos = 0;
    private volatile int lastDur = 0;
    private volatile boolean lastPlaying = false;
    private volatile String tracksJson = "[]";
    private String currentUrl = null;
    private boolean isTv = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        isTv = detectTv();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        videoBox = new FrameLayout(this);
        videoBox.setBackgroundColor(Color.BLACK);
        videoBox.setVisibility(View.INVISIBLE);
        root.addView(videoBox, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        setupVideo();
        setupWeb();
        hideSystemUi();
    }

    private boolean detectTv() {
        try {
            UiModeManager m = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (m != null && m.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) return true;
            PackageManager pm = getPackageManager();
            if (pm.hasSystemFeature("android.software.leanback")) return true;
            if (!pm.hasSystemFeature("android.hardware.touchscreen")) return true;
        } catch (Exception ignored) { }
        return false;
    }

    private void setupVideo() {
        player = new NativePlayer(this, videoBox, new NativePlayer.Listener() {
            @Override public void onPlayerEvent(String type, String json) {
                if ("prepared".equals(type)) { prepared = true; buffering = false; }
                else if ("buffering".equals(type)) buffering = true;
                else if ("buffered".equals(type) || "rendering".equals(type)) buffering = false;
                else if ("error".equals(type)) prepared = false;
                emit(type, json);
            }
        });
        // Poll player state so JS can read it synchronously without touching the UI thread.
        ui.post(new Runnable() {
            @Override public void run() {
                try {
                    if (currentUrl != null) {
                        prepared = player.isPrepared();
                        lastPos = player.position();
                        lastDur = player.duration();
                        lastPlaying = player.isPlaying();
                    }
                } catch (Exception ignored) { }
                ui.postDelayed(this, 500);
            }
        });
    }

    private void setupWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 21) s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !url.startsWith("file:"); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("IPTVPlus", m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 19 && (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web.loadUrl("file:///android_asset/www/index.html");
        web.requestFocus();
    }

    private void emit(final String type, final String data) {
        ui.post(new Runnable() {
            @Override public void run() {
                String js = "window.NativeEvents&&NativeEvents.player(" + JSONObject.quote(type) + "," + (data == null ? "null" : data) + ")";
                web.evaluateJavascript(js, null);
            }
        });
    }

    private void js(final String code) {
        ui.post(new Runnable() { @Override public void run() { web.evaluateJavascript(code, null); } });
    }

    private void hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 19) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override protected void onPause() {
        super.onPause();
        js("window.App&&App.onAppPause&&App.onAppPause()");
        player.pause();
    }

    @Override protected void onResume() {
        super.onResume();
        hideSystemUi();
        js("window.App&&App.onAppResume&&App.onAppResume()");
    }

    @Override protected void onDestroy() {
        player.release();
        pool.shutdownNow();
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("(window.App&&App.back)?App.back():false", new android.webkit.ValueCallback<String>() {
            @Override public void onReceiveValue(String v) {
                if (!"true".equals(v)) finish();
            }
        });
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        String name = null;
        switch (k) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_HEADSETHOOK: name = "playpause"; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: name = "play"; break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: name = "pause"; break;
            case KeyEvent.KEYCODE_MEDIA_STOP: name = "stop"; break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: name = "ff"; break;
            case KeyEvent.KEYCODE_MEDIA_REWIND: name = "rew"; break;
            case KeyEvent.KEYCODE_MEDIA_NEXT: name = "next"; break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: name = "prev"; break;
            case KeyEvent.KEYCODE_CHANNEL_UP: case KeyEvent.KEYCODE_PAGE_UP: name = "chup"; break;
            case KeyEvent.KEYCODE_CHANNEL_DOWN: case KeyEvent.KEYCODE_PAGE_DOWN: name = "chdown"; break;
            case KeyEvent.KEYCODE_MENU: name = "menu"; break;
            case KeyEvent.KEYCODE_INFO: name = "info"; break;
            case KeyEvent.KEYCODE_GUIDE: name = "guide"; break;
            case KeyEvent.KEYCODE_PROG_RED: name = "red"; break;
            case KeyEvent.KEYCODE_PROG_GREEN: name = "green"; break;
            case KeyEvent.KEYCODE_PROG_YELLOW: name = "yellow"; break;
            case KeyEvent.KEYCODE_PROG_BLUE: name = "blue"; break;
            default: break;
        }
        if (name != null) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) js("window.App&&App.mediaKey&&App.mediaKey(" + JSONObject.quote(name) + ")");
            return true;
        }
        if (!web.hasFocus()) web.requestFocus();
        return super.dispatchKeyEvent(e);
    }

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<String, String>();
        h.put("User-Agent", UA);
        return h;
    }

    /** Methods exposed to the web UI as window.Native */
    public class Bridge {

        @JavascriptInterface public boolean isTv() { return isTv; }

        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
        }

        @JavascriptInterface public void play(final String url, final int startMs) {
            ui.post(new Runnable() {
                @Override public void run() {
                    prepared = false;
                    buffering = true;
                    lastPos = 0; lastDur = 0; lastPlaying = false;
                    tracksJson = "[]";
                    currentUrl = url;
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    player.play(url, startMs, headers());
                }
            });
        }

        @JavascriptInterface public void stop() {
            ui.post(new Runnable() {
                @Override public void run() {
                    prepared = false;
                    currentUrl = null;
                    player.stop();
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        @JavascriptInterface public void pause() {
            ui.post(new Runnable() { @Override public void run() { player.pause(); lastPlaying = false; } });
        }

        @JavascriptInterface public void resume() {
            ui.post(new Runnable() { @Override public void run() { player.resume(); lastPlaying = true; } });
        }

        @JavascriptInterface public void seekTo(final int ms) {
            ui.post(new Runnable() { @Override public void run() { player.seekTo(ms); lastPos = ms; } });
        }

        @JavascriptInterface public String state() {
            JSONObject o = new JSONObject();
            try {
                o.put("prepared", prepared);
                o.put("playing", lastPlaying);
                o.put("buffering", buffering);
                o.put("pos", lastPos);
                o.put("dur", lastDur);
            } catch (Exception ignored) { }
            return o.toString();
        }

        @JavascriptInterface public String audioTracks() { return player.audioTracks(); }

        @JavascriptInterface public void selectAudio(final int index) {
            ui.post(new Runnable() {
                @Override public void run() {
                    player.selectAudio(index);
                }
            });
        }

        /** auto | 16:9 | 4:3 | fill (étirer) | zoom (remplir en rognant) */
        @JavascriptInterface public void setAspect(final String mode) {
            ui.post(new Runnable() { @Override public void run() { player.setAspect(mode); } });
        }

        @JavascriptInterface public boolean openExternal(String url, String title) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(Uri.parse(url), "video/*");
                i.putExtra("title", title);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(Intent.createChooser(i, "Ouvrir avec"));
                return true;
            } catch (ActivityNotFoundException e) {
                return false;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface public void setLandscape(final boolean on) {
            ui.post(new Runnable() {
                @Override public void run() {
                    if (isTv) return;
                    setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                }
            });
        }

        @JavascriptInterface public void exit() {
            ui.post(new Runnable() { @Override public void run() { finish(); } });
        }

        /** Native HTTP GET used when the WebView cannot reach the server directly. */
        @JavascriptInterface public void http(final int id, final String url) {
            pool.execute(new Runnable() {
                @Override public void run() {
                    int status = 0;
                    String body = "";
                    HttpURLConnection c = null;
                    try {
                        String target = url;
                        for (int hop = 0; hop < 5; hop++) {
                            c = (HttpURLConnection) new URL(target).openConnection();
                            c.setInstanceFollowRedirects(false);
                            c.setConnectTimeout(15000);
                            c.setReadTimeout(60000);
                            c.setRequestProperty("User-Agent", UA);
                            c.setRequestProperty("Accept", "*/*");
                            status = c.getResponseCode();
                            if (status >= 300 && status < 400 && c.getHeaderField("Location") != null) {
                                target = new URL(new URL(target), c.getHeaderField("Location")).toString();
                                c.disconnect();
                                continue;
                            }
                            break;
                        }
                        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in != null) {
                            ByteArrayOutputStream out = new ByteArrayOutputStream();
                            byte[] buf = new byte[65536];
                            int n;
                            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                            in.close();
                            body = out.toString("UTF-8");
                        }
                    } catch (Exception e) {
                        status = 0;
                        body = String.valueOf(e.getMessage());
                    } finally {
                        if (c != null) c.disconnect();
                    }
                    js("window.NativeHttp&&NativeHttp.done(" + id + "," + status + "," + JSONObject.quote(body) + ")");
                }
            });
        }
    }
}
