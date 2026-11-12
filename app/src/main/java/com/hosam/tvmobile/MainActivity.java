package com.hosam.tvmobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the web UI (assets/www) at https://hosamtv.app/ and proxies server requests through
 * https://hosamtv.app/proxy?u=<url>, so the page never hits CORS or mixed-content limits and
 * can save posters to IndexedDB. Video is handed to PlayerActivity (ExoPlayer).
 */
public class MainActivity extends Activity {
    static final String HOST = "hosamtv.app";
    static final int REQ_PLAY = 7;
    WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.setStatusBarColor(Color.BLACK);
        w.setNavigationBarColor(Color.rgb(18, 18, 20));

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath() == null ? "/" : u.getPath();
                if ("/proxy".equals(path)) return proxy(u.getQueryParameter("u"));
                return asset(path);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost());
            }
        });
        setContentView(web);
        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    // ---------- local files ----------
    WebResourceResponse asset(String path) {
        if (path.equals("/")) path = "/index.html";
        String mime = "application/octet-stream";
        if (path.endsWith(".html")) mime = "text/html";
        else if (path.endsWith(".js")) mime = "application/javascript";
        else if (path.endsWith(".css")) mime = "text/css";
        else if (path.endsWith(".woff2")) mime = "font/woff2";
        else if (path.endsWith(".png")) mime = "image/png";
        else if (path.endsWith(".svg")) mime = "image/svg+xml";
        try {
            InputStream in = getAssets().open("www" + path);
            return new WebResourceResponse(mime, "UTF-8", in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", new HashMap<String, String>(),
                    new ByteArrayInputStream(new byte[0]));
        }
    }

    // ---------- server proxy (follows redirects across http/https) ----------
    WebResourceResponse proxy(String target) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "no-store");
        if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) {
            return new WebResourceResponse("text/plain", "UTF-8", 400, "Bad Request", headers, new ByteArrayInputStream(new byte[0]));
        }
        try {
            String url = target;
            HttpURLConnection c = null;
            for (int hop = 0; hop < 6; hop++) {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(15000);
                c.setReadTimeout(60000);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) HosamTV/1.0");
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = c.getHeaderField("Location");
                    c.disconnect();
                    if (loc == null) break;
                    url = new URL(new URL(url), loc).toString();
                    continue;
                }
                break;
            }
            int code = c.getResponseCode();
            String type = c.getContentType();
            String mime = "application/octet-stream", enc = null;
            if (type != null) {
                String[] parts = type.split(";");
                mime = parts[0].trim();
                for (String p : parts) {
                    p = p.trim();
                    if (p.toLowerCase().startsWith("charset=")) enc = p.substring(8);
                }
            }
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);
            String reason = c.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = code >= 400 ? "Error" : "OK";
            if (code < 100 || code > 599 || (code >= 300 && code < 400)) code = 502;
            return new WebResourceResponse(mime, enc, code, reason, headers, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 502, "Bad Gateway", headers, new ByteArrayInputStream(new byte[0]));
        }
    }

    // ---------- JS bridge ----------
    class Bridge {
        @JavascriptInterface
        public void play(final String json) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                    i.putExtra("json", json);
                    startActivityForResult(i, REQ_PLAY);
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_PLAY) return;
        String r = data != null ? data.getStringExtra("result") : null;
        if (r == null) r = "{}";
        web.evaluateJavascript("window.onPlayerResult && window.onPlayerResult(" + r + ")", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.hostBack ? window.hostBack() : false)", value -> {
            if (!"true".equals(value)) finish();
        });
    }
}
