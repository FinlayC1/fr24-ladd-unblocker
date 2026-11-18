package io.github.finlayc1.fr24ladd.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** The app's rules (Policy) and its requests (AppNet), against fake servers: what the script may reach, and how. */
public class AppTest {
    static final List<String> CONNECT = Arrays.asList("api.adsb.lol", "adsb.lol", "opendata.adsb.fi", "sslip.io", "api.flightradar24.com");

    // ---- Policy ---------------------------------------------------------------------------------------------------------
    @Test public void fr24PagesStayInTheAppOthersDoNot() {
        assertTrue(Policy.inApp("https", "www.flightradar24.com"));
        assertTrue(Policy.inApp("https", "flightradar24.com"));
        assertTrue(Policy.inApp("https", "my.flightradar24.com"));
        assertTrue(Policy.inApp("HTTPS", "WWW.FLIGHTRADAR24.COM."));
        assertFalse("http is not kept", Policy.inApp("http", "www.flightradar24.com"));
        assertFalse(Policy.inApp("https", "evilflightradar24.com"));
        assertFalse(Policy.inApp("https", "flightradar24.com.evil.com"));
        assertFalse(Policy.inApp("https", "www.jetphotos.com"));
        assertFalse(Policy.inApp("https", null));
    }

    @Test public void theScriptAndItsBridgeOnlyOnFr24sSiteItself() {
        assertTrue(Policy.scriptOrigin("https://www.flightradar24.com"));
        assertTrue(Policy.scriptOrigin("https://flightradar24.com/"));
        assertFalse(Policy.scriptOrigin("https://my.flightradar24.com"));
        assertFalse(Policy.scriptOrigin("http://www.flightradar24.com"));
        assertFalse(Policy.scriptOrigin("https://www.flightradar24.com.evil.com"));
        assertFalse(Policy.scriptOrigin("https://ads.example.com"));
    }

    @Test public void requestsOnlyToTheHeadersHostsTheirSubdomainsAndThoseAllowed() {
        List<String> granted = Collections.singletonList("mon.example.org");
        assertTrue(Policy.hostAllowed("api.adsb.lol", CONNECT, granted));
        assertTrue("a @connect host's subdomain, as a userscript manager takes it", Policy.hostAllowed("globe.adsb.lol", CONNECT, granted));
        assertTrue("the monitor's address", Policy.hostAllowed("143-47-224-210.sslip.io", CONNECT, granted));
        assertTrue("one the user allowed", Policy.hostAllowed("MON.example.org.", CONNECT, granted));
        assertFalse("not under it", Policy.hostAllowed("notadsb.lol", CONNECT, granted));
        assertFalse(Policy.hostAllowed("adsb.lol.evil.com", CONNECT, granted));
        assertFalse("an allowed host exactly, not its subdomains", Policy.hostAllowed("x.mon.example.org", CONNECT, granted));
        assertFalse(Policy.hostAllowed("www.flightradar24.com", CONNECT, granted));
        assertFalse(Policy.hostAllowed("", CONNECT, granted));
        assertFalse(Policy.hostAllowed("192.168.1.1", CONNECT, granted));
    }

    @Test public void aMonitorOriginsHost() {
        assertEquals("mon.example.org", Policy.grantHost("https://mon.example.org"));
        assertEquals("mon.example.org", Policy.grantHost("https://Mon.Example.org:8443/x?y"));
        assertNull("https only", Policy.grantHost("http://mon.example.org"));
        assertNull(Policy.grantHost("https://user@mon.example.org"));
        assertNull(Policy.grantHost("https://mon.example.org:http"));
        assertNull(Policy.grantHost("https://localhost"));
        assertNull(Policy.grantHost("javascript:alert(1)"));
        assertNull(Policy.grantHost(null));
    }

    @Test public void savedFilesNames() {
        assertEquals("G-ABCD-flights.csv", Policy.safeName("G-ABCD-flights.csv"));
        assertEquals("passwd", Policy.safeName("../../etc/passwd"));
        assertEquals("x.csv", Policy.safeName("C:\\temp\\x.csv"));
        assertEquals("hidden", Policy.safeName(".hidden"));
        assertEquals("a_b.csv", Policy.safeName("a\u00e9b.csv".replace("\u00e9", "\u00e9")));
        assertEquals("download", Policy.safeName(""));
        assertEquals("download", Policy.safeName(null));
        String longName = Policy.safeName(new String(new char[150]).replace('\0', 'a') + ".csv");
        assertEquals(100, longName.length());
        assertTrue(longName.endsWith(".csv"));
    }

    @Test public void theUserAgentAsAPhonesChrome() {
        String wv = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36";
        assertEquals("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.135 Mobile Safari/537.36", Policy.userAgent(wv));
        assertNull(Policy.userAgent(null));
    }

    // ---- AppNet, against fake servers -----------------------------------------------------------------------------------
    /** a server's answer to one connection */
    static final class Fake extends HttpURLConnection {
        final int status; final Map<String, List<String>> headers = new LinkedHashMap<>(); final byte[] body; final boolean timeout;
        final Map<String, String> sent = new HashMap<>(); final ByteArrayOutputStream out = new ByteArrayOutputStream();
        Fake(URL u, int status, byte[] body, boolean timeout, String... hs) {
            super(u); this.status = status; this.body = body; this.timeout = timeout;
            for (int i = 0; i + 1 < hs.length; i += 2) headers.computeIfAbsent(hs[i], k -> new ArrayList<>()).add(hs[i + 1]);
        }
        @Override public void setRequestProperty(String k, String v) { sent.put(k.toLowerCase(), v); }
        @Override public int getResponseCode() throws IOException { if (timeout) throw new SocketTimeoutException("read timed out"); return status; }
        @Override public String getResponseMessage() { return status == 200 ? "OK" : ""; }
        @Override public String getHeaderField(String k) { for (Map.Entry<String, List<String>> e : headers.entrySet()) if (e.getKey().equalsIgnoreCase(k)) return e.getValue().get(0); return null; }
        @Override public Map<String, List<String>> getHeaderFields() { return headers; }
        @Override public String getContentType() { return getHeaderField("Content-Type"); }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(body); }
        @Override public InputStream getErrorStream() { return new ByteArrayInputStream(body); }
        @Override public OutputStream getOutputStream() { return out; }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
    }

    static final class Server implements AppNet.Opener {
        final Map<String, java.util.function.Function<URL, Fake>> routes = new HashMap<>();
        final List<Fake> opened = Collections.synchronizedList(new ArrayList<>());
        @Override public HttpURLConnection open(URL u) {
            java.util.function.Function<URL, Fake> f = routes.get(u.toString());
            Fake c = f != null ? f.apply(u) : new Fake(u, 404, new byte[0], false);
            opened.add(c); return c;
        }
    }

    static final class Jar implements AppNet.Cookies {
        final Map<String, String> kept = new HashMap<>(); final List<String> set = new ArrayList<>();
        @Override public String get(String url) { return kept.get(hostOf(url)); }
        @Override public void set(String url, String c) { set.add(hostOf(url) + " " + c); }
        static String hostOf(String url) { try { return new URL(url).getHost(); } catch (Exception e) { return ""; } }
    }

    static JSONObject run(AppNet n, String id, JSONObject req) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> out = new AtomicReference<>();
        n.request(id, req, s -> { out.set(s); done.countDown(); });
        assertTrue("answered", done.await(5, TimeUnit.SECONDS));
        return new JSONObject(out.get());
    }

    static JSONObject get(String url) throws Exception { return new JSONObject().put("t", "req").put("url", url).put("method", "GET"); }

    @Test public void anAllowedHostAnsweredWithTheAppsCookiesKeptBothWays() throws Exception {
        Server s = new Server(); Jar jar = new Jar(); jar.kept.put("api.flightradar24.com", "_frPl=abc");
        s.routes.put("https://api.flightradar24.com/common/v1/x.json", u -> new Fake(u, 200, "{\"ok\":1}".getBytes(StandardCharsets.UTF_8), false, "Content-Type", "application/json; charset=utf-8", "Set-Cookie", "k=v; Path=/"));
        AppNet n = new AppNet(CONNECT, Collections::emptyList, jar, s);
        JSONObject r = run(n, "p1.1", get("https://api.flightradar24.com/common/v1/x.json").put("headers", new JSONObject().put("Accept", "application/json").put("Cookie", "forged=1").put("Host", "evil")));
        assertEquals("res", r.getString("t")); assertEquals("p1.1", r.getString("id"));
        assertEquals(200, r.getInt("status")); assertEquals("{\"ok\":1}", r.getString("text"));
        assertEquals("the app's own cookie for the host, not the script's", "_frPl=abc", s.opened.get(0).sent.get("cookie"));
        assertNull("no Host of the script's", s.opened.get(0).sent.get("host"));
        assertEquals("application/json", s.opened.get(0).sent.get("accept"));
        assertEquals(Collections.singletonList("api.flightradar24.com k=v; Path=/"), jar.set);
    }

    @Test public void aHostNotListedNorAllowedIsNotAsked() throws Exception {
        Server s = new Server(); AppNet n = new AppNet(CONNECT, Collections::emptyList, new Jar(), s);
        JSONObject r = run(n, "p1.2", get("https://intranet.example.com/secret"));
        assertTrue(r.getString("error").contains("not a host the script may reach"));
        assertFalse(r.getBoolean("timeout"));
        assertTrue("no connection opened", s.opened.isEmpty());
        JSONObject h = run(n, "p1.3", get("http://api.adsb.lol/v2/hex/abc"));
        assertTrue(h.getString("error").contains("https only")); assertTrue(s.opened.isEmpty());
        // (one the user allowed: asked)
        AppNet g = new AppNet(CONNECT, () -> Collections.singletonList("mon.example.org"), new Jar(), s);
        s.routes.put("https://mon.example.org/legs", u -> new Fake(u, 200, "[]".getBytes(StandardCharsets.UTF_8), false));
        assertEquals(200, run(g, "p1.4", get("https://mon.example.org/legs")).getInt("status"));
    }

    @Test public void redirectsFollowedOnlyToAllowedHosts() throws Exception {
        Server s = new Server(); AppNet n = new AppNet(CONNECT, Collections::emptyList, new Jar(), s);
        s.routes.put("https://adsb.lol/a", u -> new Fake(u, 302, new byte[0], false, "Location", "https://api.adsb.lol/b"));
        s.routes.put("https://api.adsb.lol/b", u -> new Fake(u, 200, "B".getBytes(StandardCharsets.UTF_8), false));
        JSONObject ok = run(n, "p2.1", get("https://adsb.lol/a"));
        assertEquals(200, ok.getInt("status")); assertEquals("B", ok.getString("text")); assertEquals("https://api.adsb.lol/b", ok.getString("url"));
        s.routes.put("https://adsb.lol/out", u -> new Fake(u, 301, new byte[0], false, "Location", "https://evil.example.com/x"));
        JSONObject bad = run(n, "p2.2", get("https://adsb.lol/out"));
        assertTrue(bad.getString("error").contains("not a host the script may reach: evil.example.com"));
        s.routes.put("https://adsb.lol/down", u -> new Fake(u, 302, new byte[0], false, "Location", "http://adsb.lol/x"));
        assertTrue(run(n, "p2.3", get("https://adsb.lol/down")).getString("error").contains("https only"));
        s.routes.put("https://adsb.lol/loop", u -> new Fake(u, 302, new byte[0], false, "Location", "/loop"));
        assertTrue(run(n, "p2.4", get("https://adsb.lol/loop")).getString("error").contains("too many redirects"));
        // (a POST answered 303: the next hop a GET without its body)
        s.routes.put("https://adsb.lol/post", u -> new Fake(u, 303, new byte[0], false, "Location", "https://adsb.lol/after"));
        s.routes.put("https://adsb.lol/after", u -> new Fake(u, 200, "done".getBytes(StandardCharsets.UTF_8), false));
        int before = s.opened.size();
        JSONObject p = run(n, "p2.5", new JSONObject().put("url", "https://adsb.lol/post").put("method", "POST").put("data", "{\"a\":1}"));
        assertEquals("done", p.getString("text"));
        assertEquals("{\"a\":1}", s.opened.get(before).out.toString("UTF-8"));
        assertEquals("GET", s.opened.get(before + 1).getRequestMethod());
        assertEquals(0, s.opened.get(before + 1).out.size());
    }

    @Test public void bytesTimeoutsAndErrors() throws Exception {
        Server s = new Server(); AppNet n = new AppNet(CONNECT, Collections::emptyList, new Jar(), s);
        byte[] bin = { 0, 1, 2, (byte) 0xff, 0x28, (byte) 0xb5 };
        s.routes.put("https://opendata.adsb.fi/bin", u -> new Fake(u, 200, bin, false));
        JSONObject b = run(n, "p3.1", get("https://opendata.adsb.fi/bin").put("binary", true));
        assertTrue(Arrays.equals(bin, Base64.getDecoder().decode(b.getString("b64"))));
        assertFalse(b.has("text"));
        s.routes.put("https://opendata.adsb.fi/slow", u -> new Fake(u, 200, new byte[0], true));
        JSONObject t = run(n, "p3.2", get("https://opendata.adsb.fi/slow"));
        assertEquals("timeout", t.getString("error")); assertTrue(t.getBoolean("timeout"));
        s.routes.put("https://opendata.adsb.fi/gone", u -> new Fake(u, 410, "gone".getBytes(StandardCharsets.UTF_8), false));
        JSONObject e = run(n, "p3.3", get("https://opendata.adsb.fi/gone"));
        assertEquals("an error status answered as it came, its body read", 410, e.getInt("status")); assertEquals("gone", e.getString("text"));
    }

    @Test public void anAbortedRequestIsNotAnswered() throws Exception {
        Server s = new Server(); CountDownLatch opened = new CountDownLatch(1), release = new CountDownLatch(1);
        s.routes.put("https://adsb.lol/hold", u -> { opened.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { /* on */ } return new Fake(u, 200, "late".getBytes(StandardCharsets.UTF_8), false); });
        AppNet n = new AppNet(CONNECT, Collections::emptyList, new Jar(), s);
        CountDownLatch answered = new CountDownLatch(1);
        n.request("p4.1", get("https://adsb.lol/hold"), x -> answered.countDown());
        assertTrue(opened.await(5, TimeUnit.SECONDS));
        n.abort("p4.1"); release.countDown();
        assertFalse("no answer for an aborted request", answered.await(700, TimeUnit.MILLISECONDS));
    }

    // ---- (1.3.12) the app's own update, its sign-in windows, its location ----------------------------------------------
    @Test public void versionsCompare() {
        assertTrue(Policy.newer("1.3.12", "1.3.11")); assertTrue(Policy.newer("v1.4.0", "1.3.99")); assertTrue(Policy.newer("1.3.10", "1.3.9"));
        assertFalse(Policy.newer("1.3.11", "1.3.11")); assertFalse(Policy.newer("1.3.9", "1.3.10")); assertFalse(Policy.newer("latest", "1.3.11")); assertFalse(Policy.newer("1.3.12", ""));
        assertNull(Policy.version("1.3.12-beta")); assertEquals(3, Policy.version("v1.3.12").length);
    }

    private static JSONObject release(String tag, String name, String url, String digest, long size) throws Exception {
        JSONObject a = new JSONObject().put("name", name).put("browser_download_url", url).put("size", size);
        if (digest != null) a.put("digest", digest);
        return new JSONObject().put("tag_name", tag).put("draft", false).put("prerelease", false).put("assets", new org.json.JSONArray().put(new JSONObject().put("name", "other.zip").put("browser_download_url", "https://github.com/x/y.zip").put("size", 5)).put(a));
    }

    @Test public void aReleasesAppIsReadOnlyFromThisProjectsOwnDownload() throws Exception {
        String sha = "ab".repeat(32), url = "https://github.com/FinlayC1/fr24-ladd-unblocker/releases/download/v1.3.12/fr24-ladd-unblocker-app.apk";
        Policy.Release r = Policy.release(release("v1.3.12", "fr24-ladd-unblocker-app.apk", url, "sha256:" + sha.toUpperCase(), 7340032));
        assertEquals("1.3.12", r.version); assertEquals(url, r.url); assertEquals(sha, r.sha256); assertEquals(7340032, r.size);
        assertEquals("no digest given: none required here (the signer is checked)", "", Policy.release(release("v1.3.12", "fr24-ladd-unblocker-app.apk", url, null, 10)).sha256);
        assertNull("another address", Policy.release(release("v1.3.12", "fr24-ladd-unblocker-app.apk", "https://evil.example.com/fr24-ladd-unblocker-app.apk", null, 10)));
        assertNull("another release's file", Policy.release(release("v1.3.12", "fr24-ladd-unblocker-app.apk", "https://github.com/FinlayC1/fr24-ladd-unblocker/releases/download/v1.3.11/fr24-ladd-unblocker-app.apk", null, 10)));
        assertNull("no app in it", Policy.release(release("v1.3.12", "fr24-ladd-unblocker-module.apk", url, null, 10)));
        assertNull("no version", Policy.release(release("nightly", "fr24-ladd-unblocker-app.apk", url, null, 10)));
        assertNull("too large", Policy.release(release("v1.3.12", "fr24-ladd-unblocker-app.apk", url, null, Policy.MAX_APK + 1)));
        JSONObject pre = release("v1.3.12", "fr24-ladd-unblocker-app.apk", url, null, 10).put("prerelease", true);
        assertNull("a pre-release", Policy.release(pre));
        assertEquals("00ff10", Policy.hex(new byte[] { 0, (byte) 255, 16 }));
    }

    @Test public void onlyASignInIsKeptInAWindow() {
        assertTrue(Policy.signIn("https", "accounts.google.com")); assertTrue(Policy.signIn("https", "appleid.apple.com.")); assertTrue(Policy.signIn("HTTPS", "www.facebook.com"));
        assertFalse(Policy.signIn("http", "accounts.google.com")); assertFalse(Policy.signIn("https", "accounts.google.com.evil.com")); assertFalse(Policy.signIn("https", "www.flightradar24.com")); assertFalse(Policy.signIn("https", "ads.example.com"));
    }

    @Test public void theLocationsLimits() {
        assertEquals(20000, Policy.geoTimeout(0)); assertEquals(2000, Policy.geoTimeout(10)); assertEquals(60000, Policy.geoTimeout(600000)); assertEquals(9000, Policy.geoTimeout(9000));
        assertEquals(30000, Policy.geoMaxAge(0)); assertEquals(60000, Policy.geoMaxAge(60000)); assertEquals(30 * 60000, Policy.geoMaxAge(Long.MAX_VALUE));
    }

    @Test public void requestsGoAtOnceAndAsThePhonesBrowser() throws Exception {
        Server s = new Server(); final java.util.concurrent.atomic.AtomicInteger inFlight = new java.util.concurrent.atomic.AtomicInteger(), most = new java.util.concurrent.atomic.AtomicInteger();
        CountDownLatch all = new CountDownLatch(12), release = new CountDownLatch(1);
        s.routes.put("https://adsb.lol/slow", u -> { int n = inFlight.incrementAndGet(); most.accumulateAndGet(n, Math::max); all.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { /* on */ } inFlight.decrementAndGet(); return new Fake(u, 200, "ok".getBytes(StandardCharsets.UTF_8), false); });
        s.routes.put("https://adsb.lol/ua", u -> new Fake(u, 200, "ok".getBytes(StandardCharsets.UTF_8), false));
        AppNet n = new AppNet(CONNECT, Collections::emptyList, new Jar(), s);
        n.userAgent("Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537.36");
        CountDownLatch done = new CountDownLatch(12);
        for (int i = 0; i < 12; i++) n.request("p5." + i, get("https://adsb.lol/slow"), x -> done.countDown());
        assertTrue("twelve slow answers at once - 1.3.11's four left the rest (the monitor's check) waiting", all.await(5, TimeUnit.SECONDS));
        release.countDown(); assertTrue(done.await(5, TimeUnit.SECONDS));
        assertTrue(most.get() >= 12); assertTrue(n.threads() >= 32);
        JSONObject a = run(n, "p5.20", get("https://adsb.lol/ua")), b = run(n, "p5.21", get("https://adsb.lol/ua").put("headers", new JSONObject().put("User-Agent", "own/1")));
        assertEquals(200, a.getInt("status")); assertEquals(200, b.getInt("status"));
        List<String> uas = new ArrayList<>(); synchronized (s.opened) { for (Fake f : s.opened) if (f.getURL().toString().endsWith("/ua")) uas.add(f.sent.get("user-agent")); }
        assertEquals("the WebView's where the script sets none; the script's own where it does", Arrays.asList("Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537.36", "own/1"), uas);
    }
}
