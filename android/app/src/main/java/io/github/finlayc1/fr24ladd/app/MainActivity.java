package io.github.finlayc1.fr24ladd.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * FR24 LADD Unblocker as an app of its own: FR24's site, as FR24 serves it to a phone, full-screen in the app's WebView, with
 * the script in it - the browser extension's work, without a browser or a userscript manager. The script (dist/app/app.js:
 * src/app/shim.js, the page part, the userscript) is put into each page of FR24's site at document start, before FR24's
 * own code runs, as the extension's manifest puts it (androidx.webkit: addDocumentStartJavaScript). What a userscript
 * manager gives the script comes from here, over a bridge given to FR24's site only (addWebMessageListener: TLNative):
 * its requests to the other sites (AppNet), notifications, a monitor host the user allows, files saved to Downloads,
 * the phone's location for FR24's "my location" (Geo), and the app's own update (Updater).
 * FR24's other pages open here too; a sign-in page FR24's page opens in a window of its own opens in one here (a window
 * over the page, closed when the sign-in closes it, or by Back); anything else opens in the phone's browser.
 */
public final class MainActivity extends Activity {
    static final String TAG = "FR24LADD";
    static final String HOME = "https://www.flightradar24.com/";
    static final Set<String> ORIGINS = new HashSet<>(Arrays.asList("https://www.flightradar24.com", "https://flightradar24.com"));
    static final String CHANNEL = "alerts", EXTRA_NOTE = "tl_note";
    static final int BG = 0xFF1C1F24, REQ_LOCATION = 1, REQ_NOTIFY = 2;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AtomicInteger noteSeq = new AtomicInteger((int) (System.currentTimeMillis() / 1000 % 100000) * 100);
    private FrameLayout root;
    private WebView web;
    private TextView notice;
    private String script;
    private AppNet net;
    private SharedPreferences hosts;
    private JavaScriptReplyProxy page;           // the FR24 page's end of the bridge - the last that spoke
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCb;
    private int restarts;
    private WebView popup;                       // (a sign-in window FR24's page opened - Policy.signIn)
    private Geo geo;
    private Updater updater;
    private final List<Object[]> geoWait = new ArrayList<>();   // (location asks waiting for the user's answer: { message, reply })

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        edgeToEdge();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            show(getString(R.string.old_webview), v -> open(Uri.parse("market://details?id=com.google.android.webview")));
            return;
        }
        try {
            script = asset("web/app.js");
            List<String> connect = new ArrayList<>();
            for (String l : asset("web/hosts.txt").split("\n")) if (!l.trim().isEmpty()) connect.add(l.trim());
            hosts = getSharedPreferences("hosts", MODE_PRIVATE);
            net = new AppNet(connect, () -> new ArrayList<>(hosts.getAll().keySet()), new AppNet.Cookies() {
                @Override public String get(String url) { return CookieManager.getInstance().getCookie(url); }
                @Override public void set(String url, String setCookie) { CookieManager.getInstance().setCookie(url, setCookie); }
            });
        } catch (IOException e) {
            show(getString(R.string.broken), null);
            return;
        }
        channel();
        geo = new Geo(this);
        updater = new Updater(this);
        build(state, null);
        handleNote(getIntent());
        updater.check(false);
    }

    // ---- the WebView ----------------------------------------------------------------------------------------------------
    private void build(Bundle state, String url) {
        try { web = new WebView(this); }
        catch (Throwable t) { Log.e(TAG, "no WebView", t); show(getString(R.string.old_webview), v -> open(Uri.parse("market://details?id=com.google.android.webview"))); return; }
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // (1.3.12: a window a page opens - onCreateWindow - a sign-in's kept here, the rest as before; the page laid out as
        // the phone's Chrome lays it out - its viewport tag, zoom where the page allows it)
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(Policy.userAgent(s.getUserAgentString()));
        net.userAgent(s.getUserAgentString());
        // (no "X-Requested-With: <the app's name>" on the page's requests, as Chrome sends none: sign-in pages refuse an
        // app's web view by it)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            try { WebSettingsCompat.setRequestedWithHeaderOriginAllowList(s, Collections.emptySet()); } catch (RuntimeException ignored) { /* sent as before */ }
        }
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        // (the bridge, then the script: both for FR24's site only, before any page of it loads)
        WebViewCompat.addWebMessageListener(web, "TLNative", ORIGINS, (view, message, sourceOrigin, isMainFrame, reply) -> {
            if (!isMainFrame || sourceOrigin == null || !Policy.scriptOrigin(sourceOrigin.toString())) return;
            page = reply;
            onBridge(message.getData(), reply);
        });
        WebViewCompat.addDocumentStartJavaScript(web, script, ORIGINS);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((u, ua, disposition, mime, length) -> download(u, ua, disposition, mime));
        root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(url != null ? url : HOME);
    }

    private final class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            if (!r.isForMainFrame()) return false;
            return leave(v, r.getUrl());
        }
        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { hideNotice(); }
        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) show(getString(R.string.offline), x -> { hideNotice(); if (web != null) { if (web.getUrl() == null) web.loadUrl(HOME); else web.reload(); } });
        }
        // (the page's renderer stopped - out of memory, or crashed: the app goes on, with a new WebView at the same page)
        @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
            String at = v.getUrl();
            root.removeView(v);
            v.destroy();
            if (v == web) { web = null; page = null; }
            if (++restarts <= 5) build(null, at != null && Policy.inApp(Uri.parse(at).getScheme(), Uri.parse(at).getHost()) ? at : HOME);
            else show(getString(R.string.crashed), x -> { restarts = 0; hideNotice(); build(null, HOME); });
            return true;
        }
    }

    /** a page to go to: FR24's own stays here; a web page, e-mail or phone number goes to the phone's own app for it;
     *  anything else is not followed */
    private boolean leave(WebView v, Uri u) {
        String scheme = Policy.lower(u.getScheme());
        if (Policy.inApp(scheme, u.getHost())) return false;
        if ("http".equals(scheme) && Policy.inApp("https", u.getHost())) { v.loadUrl(u.buildUpon().scheme("https").build().toString()); return true; }
        if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) || "market".equals(scheme)) open(u);
        return true;
    }

    private void open(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show(); }
    }

    private final class Chrome extends WebChromeClient {
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            if (!Policy.scriptOrigin(origin)) { cb.invoke(origin, false, false); return; }
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) { cb.invoke(origin, true, false); return; }
            geoOrigin = origin; geoCb = cb;
            requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
        }
        @Override public void onGeolocationPermissionsHidePrompt() { geoOrigin = null; geoCb = null; }
        @Override public void onPermissionRequest(PermissionRequest r) { r.deny(); }
        // (1.3.12) a window the page opens: what it shows decides where - a sign-in (one a tap opened) in a window over the
        // page, FR24's own pages in the app's page, anything else in the phone's browser, as before 1.3.12
        @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            if (resultMsg == null || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
            closePopup();
            WebView p;
            try { p = new WebView(MainActivity.this); } catch (Throwable t) { return false; }
            WebSettings ps = p.getSettings();
            ps.setJavaScriptEnabled(true);
            ps.setDomStorageEnabled(true);
            ps.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            ps.setAllowFileAccess(false);
            ps.setAllowContentAccess(false);
            ps.setSupportMultipleWindows(false);
            ps.setJavaScriptCanOpenWindowsAutomatically(false);
            ps.setUserAgentString(web != null ? web.getSettings().getUserAgentString() : Policy.userAgent(ps.getUserAgentString()));
            if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                try { WebSettingsCompat.setRequestedWithHeaderOriginAllowList(ps, Collections.emptySet()); } catch (RuntimeException ignored) { /* sent */ }
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(p, true);
            p.setBackgroundColor(0xFFFFFFFF);
            p.setVisibility(View.INVISIBLE);                           // (shown once it is a sign-in's)
            p.setWebViewClient(new PopupClient(isUserGesture));
            p.setWebChromeClient(new WebChromeClient() {
                @Override public void onCloseWindow(WebView w) { if (w == popup) closePopup(); }
            });
            popup = p;
            root.addView(p, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            ((WebView.WebViewTransport) resultMsg.obj).setWebView(p);
            resultMsg.sendToTarget();
            return true;
        }
        @Override public void onCloseWindow(WebView w) { if (w == popup) closePopup(); }
    }

    // (the window's pages: its first decides where it is shown - Policy.signIn keeps it; then, a sign-in going on, any
    // https page in it - the provider's own steps, back to FR24 - and anything else to the phone's browser)
    private final class PopupClient extends WebViewClient {
        private final boolean tapped;
        private boolean kept;
        PopupClient(boolean tapped) { this.tapped = tapped; }
        private boolean decide(WebView v, Uri u) {
            String scheme = Policy.lower(u.getScheme());
            if (kept) {
                if ("https".equals(scheme)) return false;
                if ("http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) || "market".equals(scheme)) open(u);
                return true;
            }
            if ("about".equals(scheme)) return false;                  // (an empty window, its page set a moment later)
            if (tapped && Policy.signIn(scheme, u.getHost())) { kept = true; v.setVisibility(View.VISIBLE); return false; }
            ui.post(MainActivity.this::closePopup);
            if (Policy.inApp(scheme, u.getHost())) { if (web != null) web.loadUrl(u.toString()); }
            else if ("http".equals(scheme) && Policy.inApp("https", u.getHost())) { if (web != null) web.loadUrl(u.buildUpon().scheme("https").build().toString()); }
            else if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme) || "market".equals(scheme)) open(u);
            return true;
        }
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return r.isForMainFrame() && decide(v, r.getUrl()); }
        @Override public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
            if (!kept && url != null && !"about:blank".equals(url) && decide(v, Uri.parse(url))) v.stopLoading();
        }
        @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) { if (v == popup) { popup = null; root.removeView(v); } v.destroy(); return true; }
    }

    private void closePopup() {
        WebView p = popup; popup = null;
        if (p == null) return;
        root.removeView(p);
        try { p.stopLoading(); p.destroy(); } catch (Throwable ignored) { /* gone */ }
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_LOCATION) return;
        boolean ok = false; for (int r : results) ok |= r == PackageManager.PERMISSION_GRANTED;
        if (geoCb != null) { geoCb.invoke(geoOrigin, ok, false); geoOrigin = null; geoCb = null; }
        // (the page's own asks - src/app/shim.js: answered now, the phone's location or "denied")
        List<Object[]> w = new ArrayList<>(geoWait); geoWait.clear();
        for (Object[] x : w) {
            JSONObject m = (JSONObject) x[0]; JavaScriptReplyProxy reply = (JavaScriptReplyProxy) x[1];
            if (ok) geoNow(m, reply); else send(reply, Geo.fail(m.optString("id"), 1, "not allowed"));
        }
    }

    private boolean located() { return has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION); }

    // (1.3.12) the page asks for the phone's location (FR24's "my location"): the user asked first if the app may
    private void geoAsk(JSONObject m, JavaScriptReplyProxy reply) {
        if (located()) { geoNow(m, reply); return; }
        geoWait.add(new Object[] { m, reply });
        if (geoWait.size() == 1) requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
    }

    private void geoNow(JSONObject m, JavaScriptReplyProxy reply) {
        geo.get(m.optString("id"), m.optBoolean("high", false), m.optLong("timeout", 0), m.optLong("maxAge", 0), out -> ui.post(() -> send(reply, out)));
    }

    private boolean has(String perm) { return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED; }

    // ---- the bridge: what the script asks of the app (src/app/shim.js) ---------------------------------------------------
    private void onBridge(String data, JavaScriptReplyProxy reply) {
        if (data == null) return;
        JSONObject m;
        try { m = new JSONObject(data); } catch (Exception e) { return; }
        switch (m.optString("t")) {
            case "req": net.request(m.optString("id"), m, out -> ui.post(() -> send(reply, out))); break;
            case "abort": net.abort(m.optString("id")); break;
            case "notify": notify(m.optString("id"), m.optString("title"), m.optString("text")); break;
            case "grant": grant(m.optString("id"), m.optString("origin"), reply); break;
            case "save": save(m.optString("name"), m.optString("mime"), m.optString("b64")); break;
            case "geo": geoAsk(m, reply); break;
            case "geoState": send(reply, msg("geoState", m.optString("id"), "state", located() ? "granted" : "prompt")); break;
            case "update": if (updater != null) updater.check(true); break;
            default: break;
        }
    }

    private static void send(JavaScriptReplyProxy reply, String json) {
        try { reply.postMessage(json); } catch (Throwable ignored) { /* the page has gone */ }
    }

    private static String msg(String t, String id, String key, Object v) {
        try { return new JSONObject().put("t", t).put("id", id).put(key, v).toString(); } catch (Exception e) { return "{}"; }
    }

    // (a monitor of the user's own at an address the script's header does not list: the user is asked, once for each host)
    private void grant(String id, String origin, JavaScriptReplyProxy reply) {
        String host = Policy.grantHost(origin);
        if (host == null) { send(reply, msg("granted", id, "ok", false)); return; }
        if (net.allowed(host)) { send(reply, msg("granted", id, "ok", true)); return; }
        if (isFinishing() || isDestroyed()) { send(reply, msg("granted", id, "ok", false)); return; }
        try {
            new AlertDialog.Builder(this)
                .setTitle(R.string.grant_title)
                .setMessage(getString(R.string.grant_text, host))
                .setPositiveButton(R.string.allow, (d, w) -> { hosts.edit().putBoolean(host, true).apply(); send(reply, msg("granted", id, "ok", true)); })
                .setNegativeButton(R.string.deny, (d, w) -> send(reply, msg("granted", id, "ok", false)))
                .setOnCancelListener(d -> send(reply, msg("granted", id, "ok", false)))
                .show();
        } catch (RuntimeException e) { send(reply, msg("granted", id, "ok", false)); }
    }

    // ---- notifications: a watched aircraft's alerts ---------------------------------------------------------------------
    private void channel() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_DEFAULT));
    }

    private void notify(String id, String title, String text) {
        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)) {
            SharedPreferences p = getPreferences(MODE_PRIVATE);
            if (!p.getBoolean("askedNotify", false)) { p.edit().putBoolean("askedNotify", true).apply(); requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY); }
            return;
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        int n = noteSeq.incrementAndGet();
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(EXTRA_NOTE, id);
        PendingIntent pi = PendingIntent.getActivity(this, n, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(n, new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build());
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handleNote(intent); }

    // (a notification tapped: the page that made it is told, and does what its script said - opens the aircraft)
    private void handleNote(Intent intent) {
        String id = intent != null ? intent.getStringExtra(EXTRA_NOTE) : null;
        if (id != null && page != null) send(page, msg("click", id, "ok", true));
    }

    // ---- files: what the page saves (the script's CSV of an aircraft's flights) - into Downloads -------------------------
    private void save(String name, String mime, String b64) {
        final String file = Policy.safeName(name), type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
        new Thread(() -> {
            boolean ok = false;
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                ContentResolver cr = getContentResolver();
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, file);
                cv.put(MediaStore.Downloads.MIME_TYPE, type);
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (u != null) {
                    try (OutputStream os = cr.openOutputStream(u)) { if (os == null) throw new IOException("no stream"); os.write(bytes); }
                    cv.clear(); cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    cr.update(u, cv, null, null);
                    ok = true;
                }
            } catch (Throwable t) { Log.w(TAG, "not saved", t); }
            final boolean done = ok;
            ui.post(() -> Toast.makeText(this, done ? getString(R.string.saved, file) : getString(R.string.not_saved), Toast.LENGTH_LONG).show());
        }, "fr24ladd-save").start();
    }

    // (a download of an ordinary address: FR24's own with the app's cookies, by Android's download manager; any other in
    // the phone's browser. Those of blob: and data: addresses are the page's own, saved by the script - src/app/shim.js)
    private void download(String url, String ua, String disposition, String mime) {
        Uri u = Uri.parse(url);
        if (!Policy.inApp(u.getScheme(), u.getHost())) { if ("https".equals(u.getScheme()) || "http".equals(u.getScheme())) open(u); return; }
        try {
            DownloadManager.Request r = new DownloadManager.Request(u);
            String c = CookieManager.getInstance().getCookie(url);
            if (c != null) r.addRequestHeader("Cookie", c);
            if (ua != null) r.addRequestHeader("User-Agent", ua);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, Policy.safeName(URLUtil.guessFileName(url, disposition, mime)));
            DownloadManager dm = getSystemService(DownloadManager.class);
            if (dm != null) { dm.enqueue(r); Toast.makeText(this, R.string.downloading, Toast.LENGTH_SHORT).show(); }
        } catch (Throwable t) { Log.w(TAG, "download", t); }
    }

    // ---- the window: FR24's page edge to edge, kept clear of the status bar, the navigation bar and the keyboard --------
    private void edgeToEdge() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, ins) -> {
                android.graphics.Insets b = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            });
            WindowInsetsController c = w.getInsetsController();
            if (c != null) c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        if (Build.VERSION.SDK_INT < 35) { w.setStatusBarColor(BG); w.setNavigationBarColor(BG); }
    }

    private void show(String text, View.OnClickListener tap) {
        if (notice == null) {
            notice = new TextView(this);
            notice.setTextColor(0xFFE8EAED);
            notice.setTextSize(16);
            notice.setGravity(Gravity.CENTER);
            notice.setPadding(48, 48, 48, 48);
            notice.setBackgroundColor(BG);
            root.addView(notice, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        notice.setText(text);
        notice.setOnClickListener(tap);
        notice.setVisibility(View.VISIBLE);
    }

    private void hideNotice() { if (notice != null) notice.setVisibility(View.GONE); }

    private String asset(String name) throws IOException {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    // ---- the activity's life --------------------------------------------------------------------------------------------
    @Override public void onBackPressed() {
        if (popup != null) { if (popup.canGoBack()) popup.goBack(); else closePopup(); return; }
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); if (updater != null) updater.resumed(); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); if (web != null) web.saveState(out); }
    @Override protected void onDestroy() {
        closePopup();
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }
}
