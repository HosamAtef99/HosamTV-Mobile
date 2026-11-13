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
import android.content.Context;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.MotionEvent;
import android.view.ViewConfiguration;

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

    // swipe controls: left side = brightness, right side = volume
    AudioManager audio;
    FrameLayout brightBar, volBar;
    View brightFill, volFill;
    TextView brightTxt, volTxt;
    final Handler ui = new Handler(Looper.getMainLooper());
    float downX, downY, startVal;
    int mode;          // 0 none, 1 brightness, 2 volume
    boolean adjusting;
    int slop;

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
        TextView back = new TextView(this);
        back.setText("→  رجوع");
        back.setTextColor(Color.BLACK);
        back.setTextSize(15);
        back.setGravity(Gravity.CENTER);
        GradientDrawable bbg = new GradientDrawable();
        bbg.setColor(Color.WHITE);
        bbg.setCornerRadius(dp(22));
        back.setBackground(bbg);
        back.setPadding(dp(18), 0, dp(18), 0);
        back.setOnClickListener(v -> finishWithResult());
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-2, dp(44));
        blp.setMarginEnd(dp(14));
        top.addView(back, blp);
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

        // side indicators (hidden until you swipe)
        audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        slop = ViewConfiguration.get(this).getScaledTouchSlop();
        brightBar = sideBar(true);
        volBar = sideBar(false);
        root.addView(brightBar, new FrameLayout.LayoutParams(dp(52), dp(210), Gravity.LEFT | Gravity.CENTER_VERTICAL));
        ((FrameLayout.LayoutParams) brightBar.getLayoutParams()).leftMargin = dp(28);
        root.addView(volBar, new FrameLayout.LayoutParams(dp(52), dp(210), Gravity.RIGHT | Gravity.CENTER_VERTICAL));
        ((FrameLayout.LayoutParams) volBar.getLayoutParams()).rightMargin = dp(28);
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

    FrameLayout sideBar(boolean bright) {
        FrameLayout bar = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(150, 30, 30, 34));
        bg.setCornerRadius(dp(26));
        bar.setBackground(bg);
        bar.setClipToOutline(true);
        View fill = new View(this);
        GradientDrawable fg = new GradientDrawable();
        fg.setColor(Color.argb(235, 255, 255, 255));
        fill.setBackground(fg);
        bar.addView(fill, new FrameLayout.LayoutParams(-1, 0, Gravity.BOTTOM));
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE);
        t.setTextSize(12);
        t.setGravity(Gravity.CENTER);
        t.setShadowLayer(4, 0, 0, Color.BLACK);
        bar.addView(t, new FrameLayout.LayoutParams(-1, dp(40), Gravity.TOP));
        bar.setVisibility(View.GONE);
        if (bright) { brightFill = fill; brightTxt = t; } else { volFill = fill; volTxt = t; }
        return bar;
    }

    float currentBrightness() {
        float b = getWindow().getAttributes().screenBrightness;
        if (b >= 0) return b;
        try { return Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS) / 255f; }
        catch (Exception e) { return 0.5f; }
    }

    float currentVolume() {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max > 0 ? audio.getStreamVolume(AudioManager.STREAM_MUSIC) / (float) max : 0f;
    }

    void showLevel(boolean bright, float v) {
        FrameLayout bar = bright ? brightBar : volBar;
        View fill = bright ? brightFill : volFill;
        TextView t = bright ? brightTxt : volTxt;
        bar.setVisibility(View.VISIBLE);
        bar.setAlpha(1f);
        ViewGroupHeight(fill, Math.round(dp(210) * v));
        t.setText((bright ? "☀\n" : "🔊\n") + Math.round(v * 100) + "%");
        t.setTextColor(v > 0.82f ? Color.BLACK : Color.WHITE);
        t.setShadowLayer(v > 0.82f ? 0 : 4, 0, 0, Color.BLACK);
    }

    void ViewGroupHeight(View v, int hgt) {
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) v.getLayoutParams();
        lp.height = hgt;
        v.setLayoutParams(lp);
    }

    final Runnable hideBars = () -> {
        brightBar.animate().alpha(0f).setDuration(250).withEndAction(() -> brightBar.setVisibility(View.GONE)).start();
        volBar.animate().alpha(0f).setDuration(250).withEndAction(() -> volBar.setVisibility(View.GONE)).start();
    };

    void apply(float v) {
        v = Math.max(0f, Math.min(1f, v));
        if (mode == 1) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.screenBrightness = Math.max(0.01f, v);
            getWindow().setAttributes(lp);
            showLevel(true, v);
        } else {
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(v * max), 0);
            showLevel(false, v);
        }
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent e) {
        if (player == null || brightBar == null) return super.dispatchTouchEvent(e);
        int w = getWindow().getDecorView().getWidth(), hgt = getWindow().getDecorView().getHeight();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = e.getX(); downY = e.getY(); adjusting = false;
                mode = downX < w * 0.4f ? 1 : (downX > w * 0.6f ? 2 : 0);
                // ignore swipes that start on the title bar or the bottom controls
                if (downY < dp(80) || downY > hgt - dp(110)) mode = 0;
                break;
            case MotionEvent.ACTION_MOVE:
                float dy = downY - e.getY(), dx = e.getX() - downX;
                if (!adjusting && mode != 0 && Math.abs(dy) > slop * 2 && Math.abs(dy) > Math.abs(dx) * 1.5f) {
                    adjusting = true;
                    startVal = mode == 1 ? currentBrightness() : currentVolume();
                    downY = e.getY();
                    MotionEvent c = MotionEvent.obtain(e);
                    c.setAction(MotionEvent.ACTION_CANCEL);
                    super.dispatchTouchEvent(c);
                    c.recycle();
                    ui.removeCallbacks(hideBars);
                }
                if (adjusting) {
                    apply(startVal + (downY - e.getY()) / (hgt * 0.65f));
                    return true;
                }
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (adjusting) {
                    adjusting = false;
                    ui.removeCallbacks(hideBars);
                    ui.postDelayed(hideBars, 900);
                    return true;
                }
                break;
        }
        return super.dispatchTouchEvent(e);
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
