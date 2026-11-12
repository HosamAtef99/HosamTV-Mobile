package com.hosam.tvmobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import org.json.JSONObject;

/** Full-screen ExoPlayer. Returns {pos, dur, ended, next, error} to the web UI when it closes. */
public class PlayerActivity extends Activity {
    ExoPlayer player;
    PlayerView view;
    boolean live, ended, next, done, retried;
    String error;
    String url;

    int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String title = "", sub = "";
        long startMs = 0;
        boolean hasNext = false;
        try {
            JSONObject o = new JSONObject(getIntent().getStringExtra("json"));
            url = o.optString("url");
            title = o.optString("title");
            sub = o.optString("sub");
            startMs = o.optLong("startMs", 0);
            live = o.optBoolean("live", false);
            hasNext = o.optBoolean("hasNext", false);
        } catch (Exception e) {
            finish();
            return;
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        view = new PlayerView(this);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setShowSubtitleButton(true);
        view.setKeepScreenOn(true);
        root.addView(view, new FrameLayout.LayoutParams(-1, -1));

        // title bar (shown together with the player controls)
        final LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(20), dp(14), dp(20), dp(14));
        top.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView t1 = new TextView(this);
        t1.setText(title);
        t1.setTextColor(Color.WHITE);
        t1.setTextSize(18);
        t1.setSingleLine(true);
        TextView t2 = new TextView(this);
        t2.setText(sub);
        t2.setTextColor(Color.argb(170, 255, 255, 255));
        t2.setTextSize(13);
        t2.setSingleLine(true);
        texts.addView(t1);
        texts.addView(t2);
        top.addView(texts, new LinearLayout.LayoutParams(0, -2, 1f));
        if (hasNext) {
            Button nb = new Button(this);
            nb.setText("الحلقة التالية ‹");
            nb.setAllCaps(false);
            nb.setTextColor(Color.BLACK);
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(Color.WHITE);
            bg.setCornerRadius(dp(20));
            nb.setBackground(bg);
            nb.setPadding(dp(16), 0, dp(16), 0);
            nb.setOnClickListener(v -> { next = true; finishWithResult(); });
            top.addView(nb, new LinearLayout.LayoutParams(-2, dp(40)));
        }
        GradientDrawable shade = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{Color.argb(190, 0, 0, 0), Color.TRANSPARENT});
        top.setBackground(shade);
        root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            top.setVisibility(visibility);
            if (visibility != View.VISIBLE) hideSystemUi();
        });

        setContentView(root);
        hideSystemUi();

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setUserAgent("Mozilla/5.0 (Linux; Android) HosamTV/1.0")
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(30000);
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(this, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(http))
                .build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int s) {
                if (s == Player.STATE_ENDED && !live) {
                    ended = true;
                    finishWithResult();
                }
            }

            @Override
            public void onPlayerError(PlaybackException e) {
                if (live && !retried) {      // live: try the other stream format once
                    retried = true;
                    String alt = url.endsWith(".m3u8") ? url.substring(0, url.length() - 5) + ".ts" : url;
                    load(alt, 0);
                    return;
                }
                error = e.getErrorCodeName();
                Toast.makeText(PlayerActivity.this, "تعذر التشغيل (" + error + ")", Toast.LENGTH_LONG).show();
            }
        });
        load(url, startMs);
    }

    void load(String u, long startMs) {
        MediaItem.Builder b = new MediaItem.Builder().setUri(u);
        if (u.contains(".m3u8")) b.setMimeType(MimeTypes.APPLICATION_M3U8);
        player.setMediaItem(b.build(), startMs);
        player.prepare();
        player.setPlayWhenReady(true);
    }

    void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    void finishWithResult() {
        if (done) return;
        done = true;
        JSONObject r = new JSONObject();
        try {
            long pos = player != null ? player.getCurrentPosition() : 0;
            long dur = player != null ? player.getDuration() : 0;
            if (dur == C.TIME_UNSET || dur < 0) dur = 0;
            r.put("pos", pos);
            r.put("dur", dur);
            r.put("ended", ended);
            r.put("next", next);
            if (error != null) r.put("error", error);
        } catch (Exception ignored) {
        }
        setResult(RESULT_OK, new Intent().putExtra("result", r.toString()));
        finish();
    }

    @Override
    public void onBackPressed() {
        finishWithResult();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
