package io.github.finlayc1.fr24ladd.app;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * The script's requests to the other sites (adsb.lol, adsb.fi, the monitor, the registers ...) - GM_xmlhttpRequest in a
 * userscript manager (src/app/shim.js) - made here, by the app, as the browser extension's service worker makes them:
 *   - https only, to the hosts the script's header lists (@connect, with their subdomains) and those the user allowed -
 *     each hop of a redirect checked too
 *   - with the app's own cookies for that host, and those it sets kept (the extension: credentials "include")
 *   - answered { t: 'res', id, status, statusText, url, headers, text } - { b64 } for bytes - or { t: 'res', id, error,
 *     timeout }; an aborted one not answered
 *   - as many at once as the script sends (it keeps to each site's own limit itself): 1.3.11's four at a time left the
 *     monitor's check waiting behind slow answers from the other sites until the script gave it up - "the monitor is not
 *     connected" - and everything else waiting with it
 *   - as the phone's browser: its user agent where the script sets none (1.3.11 sent Android's own, "Dalvik/...")
 */
final class AppNet {
    interface Done { void done(String json); }
    /** the app's cookie jar (Android's CookieManager; a map in the tests) */
    interface Cookies { String get(String url); void set(String url, String setCookie); }
    /** opens a connection (the tests give fake ones) */
    interface Opener { HttpURLConnection open(URL url) throws java.io.IOException; }

    static final int MAX = 64 * 1024 * 1024, HOPS = 5, THREADS = 32;
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(THREADS, THREADS, 30, TimeUnit.SECONDS, new LinkedBlockingQueue<>(), r -> { Thread t = new Thread(r, "fr24ladd-net"); t.setDaemon(true); return t; });
    { pool.allowCoreThreadTimeOut(true); }
    private final Map<String, HttpURLConnection> open = new ConcurrentHashMap<>();
    private final Set<String> aborted = ConcurrentHashMap.newKeySet();
    private final Collection<String> connect;
    private final Supplier<Collection<String>> granted;
    private final Cookies cookies;
    private final Opener opener;
    private volatile String userAgent;

    AppNet(Collection<String> connect, Supplier<Collection<String>> granted, Cookies cookies) {
        this(connect, granted, cookies, u -> (HttpURLConnection) u.openConnection());
    }

    AppNet(Collection<String> connect, Supplier<Collection<String>> granted, Cookies cookies, Opener opener) {
        this.connect = connect; this.granted = granted; this.cookies = cookies; this.opener = opener;
    }

    /** the user agent sent where the script sets none: the WebView's, as the page's own requests send it */
    void userAgent(String ua) { userAgent = ua == null || ua.trim().isEmpty() ? null : ua.trim(); }

    /** how many requests can run at once */
    int threads() { return pool.getMaximumPoolSize(); }

    boolean allowed(String host) { return Policy.hostAllowed(host, connect, granted.get()); }

    void request(final String id, final JSONObject o, final Done done) {
        pool.execute(() -> {
            String out;
            try { out = fetch(id, o).put("t", "res").put("id", id).toString(); }
            catch (SocketTimeoutException e) { out = err(id, "timeout", true); }
            catch (Throwable t) { out = err(id, String.valueOf(t.getMessage() != null ? t.getMessage() : t), false); }
            finally { open.remove(id); }
            if (aborted.remove(id)) return;
            done.done(out);
        });
    }

    void abort(String id) {
        if (aborted.size() > 1000) aborted.clear();
        aborted.add(id);
        HttpURLConnection c = open.remove(id);
        if (c != null) try { c.disconnect(); } catch (Throwable ignored) { /* closed */ }
    }

    static String err(String id, String msg, boolean timeout) {
        try { return new JSONObject().put("t", "res").put("id", id).put("error", msg).put("timeout", timeout).toString(); }
        catch (JSONException e) { return "{\"t\":\"res\",\"error\":\"failed\"}"; }
    }

    JSONObject fetch(String id, JSONObject o) throws Exception {
        URL url = new URL(o.getString("url"));
        String method = o.optString("method", "GET").toUpperCase(Locale.ROOT);
        Object data = o.opt("data");
        byte[] body = data instanceof String && !"GET".equals(method) && !"HEAD".equals(method) ? ((String) data).getBytes(StandardCharsets.UTF_8) : null;
        int timeout = o.optInt("timeout", 0);
        for (int hop = 0; ; hop++) {
            if (!"https".equals(url.getProtocol())) throw new IllegalArgumentException("https only: " + url);
            if (!allowed(url.getHost())) throw new IllegalArgumentException("not a host the script may reach: " + url.getHost());
            HttpURLConnection c = opener.open(url);
            open.put(id, c);
            if (aborted.contains(id)) { c.disconnect(); throw new IllegalStateException("aborted"); }
            c.setConnectTimeout(timeout > 0 ? timeout : 30000);
            c.setReadTimeout(timeout > 0 ? timeout : 60000);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setRequestMethod(method);
            JSONObject h = o.optJSONObject("headers");
            boolean ownUa = false;
            if (h != null) for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                String k = it.next();
                if (k.equalsIgnoreCase("host") || k.equalsIgnoreCase("cookie") || k.equalsIgnoreCase("content-length")) continue;
                if (k.equalsIgnoreCase("user-agent")) ownUa = true;
                c.setRequestProperty(k, String.valueOf(h.get(k)));
            }
            String ua = userAgent;
            if (!ownUa && ua != null) c.setRequestProperty("User-Agent", ua);
            String jar = cookies != null ? cookies.get(url.toString()) : null;
            if (jar != null && !jar.isEmpty()) c.setRequestProperty("Cookie", jar);
            if (body != null) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream os = c.getOutputStream()) { os.write(body); }
            }
            int status = c.getResponseCode();
            keepCookies(url, c);
            String loc = c.getHeaderField("Location");
            if (status >= 300 && status < 400 && status != 304 && loc != null) {
                if (hop >= HOPS) throw new IllegalStateException("too many redirects");
                c.disconnect();
                url = new URL(url, loc);
                if (status == 303 || ((status == 301 || status == 302) && "POST".equals(method))) { method = "GET"; body = null; }
                continue;
            }
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] bytes = new byte[0];
            if (in != null) try (InputStream s = in) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[32768]; int n;
                while ((n = s.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > MAX) throw new IllegalStateException("answer over 64 MB"); }
                bytes = bo.toByteArray();
            }
            StringBuilder hs = new StringBuilder();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null) continue;
                for (String v : e.getValue()) hs.append(e.getKey().toLowerCase(Locale.ROOT)).append(": ").append(v).append("\r\n");
            }
            JSONObject r = new JSONObject().put("status", status).put("statusText", c.getResponseMessage() == null ? "" : c.getResponseMessage()).put("url", url.toString()).put("headers", hs.toString());
            if (o.optBoolean("binary", false)) r.put("b64", Base64.getEncoder().encodeToString(bytes));
            else r.put("text", new String(bytes, charsetOf(c.getContentType())));
            return r;
        }
    }

    private void keepCookies(URL url, HttpURLConnection c) {
        if (cookies == null) return;
        for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
            if (e.getKey() == null || !e.getKey().equalsIgnoreCase("set-cookie")) continue;
            for (String v : e.getValue()) try { cookies.set(url.toString(), v); } catch (Throwable ignored) { /* not kept */ }
        }
    }

    static Charset charsetOf(String contentType) {
        if (contentType != null) {
            for (String part : contentType.split(";")) {
                String p = part.trim();
                if (p.toLowerCase(Locale.ROOT).startsWith("charset=")) {
                    try { return Charset.forName(p.substring(8).replace("\"", "").trim()); } catch (Throwable ignored) { /* unknown: UTF-8 */ }
                }
            }
        }
        return StandardCharsets.UTF_8;
    }
}
