package io.github.finlayc1.fr24ladd;

import android.app.Activity;
import android.app.Application;
import android.app.Instrumentation;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedHelpers;

/**
 * The page the script runs in, inside FR24's app process: a WebView FR24 never shows, at FR24's own address
 * (https://www.flightradar24.com/__fr24ladd/ - the page and its script answered here, from the module's APK, never asked of
 * FR24), so the script does what it does on FR24's website. It is started once FR24's app is up, and paused while FR24 is
 * in the background.
 *   patch(dir, method, bytes)  one of FR24's gRPC messages through the script (src/page.js window.__tlApp): its bytes back
 *                              changed, or null - as they came (not ready, too slow, on FR24's main thread, or unchanged)
 *   TLNative                   what the page calls (src/mobile/shim.js): the settings, requests, the message to patch
 * The page's renderer stopping is never FR24's app stopping: it is let go, and started again (three times at most).
 */
final class Runtime {
    static final String BASE = "https://www.flightradar24.com/__fr24ladd/";
    static final Handler MAIN = new Handler(Looper.getMainLooper());
    static volatile Prefs prefs = new Prefs();
    static volatile WebView page;
    static volatile boolean ready;
    static volatile String appVersion = "";
    static volatile long bypassUntil;
    static volatile boolean mainSaid;
    static final AtomicInteger seq = new AtomicInteger(), slow = new AtomicInteger();
    static final Map<Integer, Call> calls = new ConcurrentHashMap<>();
    static byte[] hostHtml, runtimeJs;
    static int restarts;
    static Context app;
    static int started;   // (FR24's activities started and not stopped: 0 - in the background. Main thread only)

    static final class Call {
        final String dir, method; final byte[] in; volatile byte[] out; final CountDownLatch done = new CountDownLatch(1);
        Call(String d, String m, byte[] i) { dir = d; method = m; in = i; }
    }

    private Runtime() {}

    /** Before FR24's app starts: the page started once its Application has been created. */
    static void prepare(ClassLoader cl, Prefs p) {
        prefs = p;
        XposedHelpers.findAndHookMethod(Instrumentation.class, "callApplicationOnCreate", Application.class, new XC_MethodHook() {
            @Override protected void afterHookedMethod(MethodHookParam param) {
                try {
                    Application a = (Application) param.args[0];
                    if (app != null || a == null || !BuildConfig.FR24_PACKAGE.equals(a.getPackageName())) return;
                    app = a;
                    try { appVersion = a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName; } catch (Throwable t) { appVersion = ""; }
                    // (started with FR24's first screen - not when FR24 is woken in the background by an alert or a widget)
                    a.registerActivityLifecycleCallbacks(new Lifecycle());
                } catch (Throwable t) { L.e("the page not started", t); }
            }
        });
    }

    // ---- the page --------------------------------------------------------------------------------------------------------
    static void start() {
        try {
            if (page != null || started == 0) return;
            if (hostHtml == null || runtimeJs == null) {
                try (ZipFile z = new ZipFile(Entry.modulePath)) { hostHtml = asset(z, "assets/web/host.html"); runtimeJs = asset(z, "assets/web/runtime.js"); }
            }
            WebView w = new WebView(app);
            WebSettings s = w.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setCacheMode(WebSettings.LOAD_NO_CACHE);
            w.addJavascriptInterface(new Native(), "TLNative");
            w.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                    String u = r.getUrl().toString();
                    if (u.equals(BASE)) return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(hostHtml));
                    if (u.equals(BASE + "runtime.js")) return new WebResourceResponse("application/javascript", "utf-8", new ByteArrayInputStream(runtimeJs));
                    return null;
                }
                @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                    L.e("the page's renderer stopped" + (d != null && d.didCrash() ? " (crashed)" : "") + " - FR24's app goes on; started again shortly");
                    lose(v);
                    if (restarts++ < 3) MAIN.postDelayed(Runtime::start, 10000);   // (with FR24 in view only: start() checks)
                    return true;
                }
            });
            w.setWebChromeClient(new WebChromeClient() {
                @Override public boolean onConsoleMessage(ConsoleMessage m) {
                    if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) L.i("page: " + m.message());
                    return true;
                }
            });
            page = w;
            w.loadUrl(BASE);
            w.onResume(); w.resumeTimers();
            L.i("page started");
        } catch (Throwable t) { L.e("the page not started - FR24's app left as it is", t); page = null; ready = false; }
    }

    static void lose(WebView v) {
        ready = false;
        if (page == v) page = null;
        for (Call c : calls.values()) c.done.countDown();
        try { if (v != null) v.destroy(); } catch (Throwable ignored) { /* gone */ }
    }

    static byte[] asset(ZipFile z, String name) throws java.io.IOException {
        ZipEntry e = z.getEntry(name);
        if (e == null) throw new java.io.FileNotFoundException(name + " missing from the module's APK");
        try (InputStream in = z.getInputStream(e)) { return Hooks.readAll(in).bytes; }
    }

    // (FR24 in the background: the page paused - no timers, no requests - and back with FR24)
    static final class Lifecycle implements Application.ActivityLifecycleCallbacks {
        @Override public void onActivityStarted(Activity a) {
            if (started++ != 0) return;
            WebView w = page;
            // (the first time: a moment after FR24's own start, not in its way)
            if (w == null) MAIN.postDelayed(Runtime::start, 1500);
            else { w.onResume(); w.resumeTimers(); }
        }
        @Override public void onActivityStopped(Activity a) {
            if (started > 0 && --started == 0) { WebView w = page; if (w != null) { w.onPause(); w.pauseTimers(); } }
        }
        @Override public void onActivityCreated(Activity a, Bundle b) {}
        @Override public void onActivityResumed(Activity a) {}
        @Override public void onActivityPaused(Activity a) {}
        @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
        @Override public void onActivityDestroyed(Activity a) {}
    }

    // ---- one message through the script --------------------------------------------------------------------------------
    static byte[] patch(String dir, String method, byte[] in) {
        final WebView w = page;
        if (!ready || w == null || in == null || in.length == 0) return null;
        // (FR24's main thread is the page's own: it cannot wait for it - said once, for whoever reads the log)
        if (Looper.myLooper() == Looper.getMainLooper()) { if (!mainSaid) { mainSaid = true; L.e("FR24 reads its " + method + " messages on its main thread: those pass as they come"); } return null; }
        long now = System.currentTimeMillis();
        if (now < bypassUntil) return null;
        final int id = seq.incrementAndGet();
        Call c = new Call(dir, method, in);
        calls.put(id, c);
        MAIN.post(() -> { try { w.evaluateJavascript("window.__tlAppRun&&window.__tlAppRun(" + id + ")", null); } catch (Throwable t) { c.done.countDown(); } });
        boolean ok = false;
        try { ok = c.done.await("resp".equals(dir) ? 2500 : 1000, TimeUnit.MILLISECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        calls.remove(id);
        if (!ok) {
            // (three too slow in a row: the script left out for a minute - FR24's app is never held up for long)
            if (slow.incrementAndGet() >= 3) { slow.set(0); bypassUntil = now + 60000; L.e("the page too slow - FR24's messages pass as they come for a minute"); }
            return null;
        }
        slow.set(0);
        return c.out;
    }

    // ---- what the page calls ------------------------------------------------------------------------------------------
    static final class Native {
        @JavascriptInterface public String config() {
            try {
                JSONObject o = new JSONObject().put("v", 1).put("module", BuildConfig.VERSION_NAME).put("app", appVersion);
                JSONObject mon = prefs.monJson();
                o.put("mon", mon == null ? JSONObject.NULL : mon);
                return o.toString();
            } catch (Throwable t) { return "{\"v\":1}"; }
        }
        @JavascriptInterface public void ready(String v) { ready = true; L.i("script ready in the page (" + v + ")"); }
        @JavascriptInterface public String take(int id) {
            Call c = calls.get(id);
            if (c == null) return null;
            try { return new JSONObject().put("d", c.dir).put("m", c.method).put("b", Base64.encodeToString(c.in, Base64.NO_WRAP)).toString(); }
            catch (Throwable t) { return null; }
        }
        @JavascriptInterface public void done(int id, String b64) {
            Call c = calls.get(id);
            if (c == null) return;
            try { c.out = b64 == null || b64.isEmpty() ? null : Base64.decode(b64, Base64.NO_WRAP); } catch (Throwable t) { c.out = null; }
            c.done.countDown();
        }
        @JavascriptInterface public void request(int id, String json) { Net.request(id, json); }
        @JavascriptInterface public void abort(int id) { Net.abort(id); }
        @JavascriptInterface public String result(int id) { return Net.result(id); }
    }

    /** The page told an answer is in (Net): it reads it with TLNative.result. */
    static void notifyNet(int id) {
        MAIN.post(() -> { WebView w = page; if (w != null) try { w.evaluateJavascript("window.__tlNet&&window.__tlNet(" + id + ")", null); } catch (Throwable ignored) { /* gone */ } });
    }

    static String b64(byte[] b) { return Base64.encodeToString(b, Base64.NO_WRAP); }
    static byte[] bytes(InputStream in) { ByteArrayOutputStream o = new ByteArrayOutputStream(); try { byte[] b = new byte[16384]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); } catch (Throwable ignored) { /* as far as it went */ } return o.toByteArray(); }
}
