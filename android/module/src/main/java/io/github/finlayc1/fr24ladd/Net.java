package io.github.finlayc1.fr24ladd;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The script's requests to the other sites (adsb.lol, adsb.fi, the monitor, the registers ...) - GM_xmlhttpRequest on the
 * website (src/mobile/shim.js) - made here, by FR24's app process: https only, no cookies, no page's cross-origin rules.
 * Each answer is kept until the page reads it (TLNative.result), told it is in by Runtime.notifyNet:
 *   { status, statusText, url, headers, text } - { b64 } for bytes - or { error, timeout }
 */
final class Net {
    static final ExecutorService POOL = Executors.newFixedThreadPool(4, r -> { Thread t = new Thread(r, "fr24ladd-net"); t.setDaemon(true); return t; });
    static final Map<Integer, String> results = new ConcurrentHashMap<>();
    static final Map<Integer, HttpURLConnection> open = new ConcurrentHashMap<>();
    static final int MAX = 64 * 1024 * 1024;

    private Net() {}

    static void request(final int id, final String json) {
        POOL.execute(() -> {
            String out;
            try { out = fetch(id, new JSONObject(json)).toString(); }
            catch (SocketTimeoutException e) { out = err("timeout", true); }
            catch (Throwable t) { out = err(String.valueOf(t.getMessage() != null ? t.getMessage() : t), false); }
            finally { open.remove(id); }
            results.put(id, out);
            Runtime.notifyNet(id);
        });
    }

    static String result(int id) { return results.remove(id); }

    static void abort(int id) {
        HttpURLConnection c = open.remove(id);
        if (c != null) try { c.disconnect(); } catch (Throwable ignored) { /* closed */ }
        results.remove(id);
    }

    static String err(String msg, boolean timeout) {
        try { return new JSONObject().put("error", msg).put("timeout", timeout).toString(); } catch (Throwable t) { return "{\"error\":\"failed\"}"; }
    }

    static JSONObject fetch(int id, JSONObject o) throws Exception {
        String url = o.getString("url");
        if (!url.startsWith("https://")) throw new IllegalArgumentException("https only: " + url);
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        open.put(id, c);
        int timeout = o.optInt("timeout", 0);
        c.setConnectTimeout(timeout > 0 ? timeout : 30000);
        c.setReadTimeout(timeout > 0 ? timeout : 60000);
        c.setInstanceFollowRedirects(true);
        c.setUseCaches(false);
        String method = o.optString("method", "GET").toUpperCase();
        c.setRequestMethod(method);
        JSONObject h = o.optJSONObject("headers");
        if (h != null) for (Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, String.valueOf(h.get(k))); }
        Object data = o.opt("data");
        if (data instanceof String && !"GET".equals(method) && !"HEAD".equals(method)) {
            byte[] body = ((String) data).getBytes(StandardCharsets.UTF_8);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = c.getOutputStream()) { os.write(body); }
        }
        int status = c.getResponseCode();
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
            for (String v : e.getValue()) hs.append(e.getKey().toLowerCase()).append(": ").append(v).append("\r\n");
        }
        JSONObject r = new JSONObject().put("status", status).put("statusText", c.getResponseMessage() == null ? "" : c.getResponseMessage()).put("url", c.getURL().toString()).put("headers", hs.toString());
        if (o.optBoolean("binary", false)) r.put("b64", Runtime.b64(bytes));
        else r.put("text", new String(bytes, charsetOf(c.getContentType())));
        return r;
    }

    static Charset charsetOf(String contentType) {
        if (contentType != null) {
            for (String part : contentType.split(";")) {
                String p = part.trim();
                if (p.toLowerCase().startsWith("charset=")) {
                    try { return Charset.forName(p.substring(8).replace("\"", "").trim()); } catch (Throwable ignored) { /* unknown: UTF-8 */ }
                }
            }
        }
        return StandardCharsets.UTF_8;
    }
}
