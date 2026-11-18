package io.github.finlayc1.fr24ladd.app;

import java.util.Collection;
import java.util.Locale;

/**
 * The app's rules, apart from Android so the tests can run them on a computer (PolicyTest):
 *   - which pages open in the app (FR24's own) and which in the phone's browser
 *   - which pages are given the script and its bridge (FR24's site itself: www.flightradar24.com, flightradar24.com - the
 *     userscript's @match)
 *   - which hosts the script's requests may go to: those its header lists (@connect, each with its subdomains, as a
 *     userscript manager takes them) and those the user allowed for a monitor of their own (exactly those)
 *   - a saved file's name
 */
final class Policy {
    private Policy() {}

    static String lower(String s) { return s == null ? "" : s.trim().toLowerCase(Locale.ROOT); }

    /** a page of FR24's own: shown in the app (any of its hosts - its sign-in and its other pages too) */
    static boolean inApp(String scheme, String host) {
        String h = lower(host);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        return "https".equals(lower(scheme)) && ("flightradar24.com".equals(h) || h.endsWith(".flightradar24.com"));
    }

    /** an origin given the script and the bridge: FR24's site itself, as the userscript's @match */
    static boolean scriptOrigin(String origin) {
        String o = lower(origin);
        while (o.endsWith("/")) o = o.substring(0, o.length() - 1);
        return "https://www.flightradar24.com".equals(o) || "https://flightradar24.com".equals(o);
    }

    /** may the script's request go to this host: a @connect host or one under it, or one the user allowed */
    static boolean hostAllowed(String host, Collection<String> connect, Collection<String> granted) {
        String h = lower(host);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty()) return false;
        if (connect != null) for (String c : connect) { String d = lower(c); if (!d.isEmpty() && (h.equals(d) || h.endsWith("." + d))) return true; }
        if (granted != null) for (String g : granted) if (h.equals(lower(g))) return true;
        return false;
    }

    /** the host of an origin the script asks to reach ("https://mon.example.org:8443" -> "mon.example.org"); null if it
     *  is no https origin */
    static String grantHost(String origin) {
        String o = lower(origin);
        if (!o.startsWith("https://")) return null;
        String rest = o.substring(8);
        int cut = rest.length();
        for (char ch : new char[] { '/', '?', '#' }) { int i = rest.indexOf(ch); if (i >= 0 && i < cut) cut = i; }
        rest = rest.substring(0, cut);
        if (rest.contains("@")) return null;
        int colon = rest.lastIndexOf(':');
        if (colon >= 0) { String port = rest.substring(colon + 1); if (!port.matches("\\d{1,5}")) return null; rest = rest.substring(0, colon); }
        return rest.matches("[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+") ? rest : null;
    }

    /** a file's name as saved in Downloads: no folders, nothing but letters, figures and . _ - ( ) and spaces */
    static String safeName(String name) {
        String n = name == null ? "" : name;
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        n = n.replaceAll("[^A-Za-z0-9._() -]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        if (n.length() > 100) { int dot = n.lastIndexOf('.'); String ext = dot > 0 && n.length() - dot <= 10 ? n.substring(dot) : ""; n = n.substring(0, 100 - ext.length()) + ext; }
        return n.isEmpty() ? "download" : n;
    }

    /** the WebView's user agent as a phone's Chrome sends it: without its "wv" and "Version/4.0" marks, which some sites
     *  answer with a page for apps instead of their own */
    static String userAgent(String ua) {
        if (ua == null) return null;
        return ua.replace("; wv)", ")").replaceAll(" Version/\\d+(\\.\\d+)*", "");
    }

    // ---- (1.3.12) a popup window a page opens: kept in the app only for a sign-in --------------------------------------
    /** a sign-in provider's page, opened by FR24's page in a window of its own: kept in a window in the app, where it can
     *  give FR24's page the answer (window.opener) - Google, Apple, Facebook, Microsoft, X */
    static boolean signIn(String scheme, String host) {
        String h = lower(host);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (!"https".equals(lower(scheme))) return false;
        for (String s : new String[] { "accounts.google.com", "appleid.apple.com", "www.facebook.com", "m.facebook.com", "facebook.com", "login.microsoftonline.com", "login.live.com", "api.twitter.com", "twitter.com", "x.com" }) if (h.equals(s)) return true;
        return false;
    }

    // ---- (1.3.12) the app's own update: its GitHub releases ------------------------------------------------------------
    static final String REPO = "FinlayC1/fr24-ladd-unblocker", APK = "fr24-ladd-unblocker-app.apk";
    static final String RELEASES_API = "https://api.github.com/repos/" + REPO + "/releases/latest";
    static final String RELEASES_PAGE = "https://github.com/" + REPO + "/releases/latest";
    static final String DOWNLOADS = "https://github.com/" + REPO + "/releases/download/";

    /** a version ("1.3.12", "v1.3.12") as its numbers; null when it is none */
    static int[] version(String v) {
        String s = lower(v);
        if (s.startsWith("v")) s = s.substring(1);
        if (!s.matches("\\d{1,4}(\\.\\d{1,4}){1,3}")) return null;
        String[] p = s.split("\\.");
        int[] out = new int[p.length];
        for (int i = 0; i < p.length; i++) out[i] = Integer.parseInt(p[i]);
        return out;
    }

    /** is version a later than version b ("1.3.12" over "1.3.11"; never when either is no version) */
    static boolean newer(String a, String b) {
        int[] x = version(a), y = version(b);
        if (x == null || y == null) return false;
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? x[i] : 0, q = i < y.length ? y[i] : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    /** the app in a release, as GitHub's API gives the latest: its version, its address, its SHA-256 where GitHub gives
     *  one ("sha256:..." - lower-case hex here; "" when not given) and its size */
    static final class Release {
        final String version, url, sha256; final long size;
        Release(String version, String url, String sha256, long size) { this.version = version; this.url = url; this.sha256 = sha256; this.size = size; }
    }

    /** the latest release's app, from GitHub's answer - null if it has none, or is not this project's (its address must be
     *  this project's own download, of that release) */
    static Release release(org.json.JSONObject j) {
        if (j == null || j.optBoolean("draft", false) || j.optBoolean("prerelease", false)) return null;
        String tag = j.optString("tag_name", "");
        if (version(tag) == null) return null;
        org.json.JSONArray as = j.optJSONArray("assets");
        if (as == null) return null;
        for (int i = 0; i < as.length(); i++) {
            org.json.JSONObject a = as.optJSONObject(i);
            if (a == null || !APK.equals(a.optString("name", ""))) continue;
            String url = a.optString("browser_download_url", "");
            if (!url.equals(DOWNLOADS + tag + "/" + APK)) return null;
            String d = lower(a.optString("digest", "")), sha = d.startsWith("sha256:") && d.substring(7).matches("[0-9a-f]{64}") ? d.substring(7) : "";
            long size = a.optLong("size", 0);
            if (size <= 0 || size > MAX_APK) return null;
            return new Release(tag.startsWith("v") || tag.startsWith("V") ? tag.substring(1) : tag, url, sha, size);
        }
        return null;
    }

    static final long MAX_APK = 150L * 1024 * 1024;

    /** bytes as lower-case hex */
    static String hex(byte[] b) {
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b) s.append(Character.forDigit((x >> 4) & 15, 16)).append(Character.forDigit(x & 15, 16));
        return s.toString();
    }

    // ---- (1.3.12) the phone's location for FR24's "my location": what the page asked, in the app's limits --------------
    /** how long to wait for a fix: the page's timeout (0: none given) - 20 s when none, 2 s at the least, a minute at most */
    static long geoTimeout(long asked) { return asked <= 0 ? 20000 : Math.max(2000, Math.min(60000, asked)); }
    /** how old a fix the phone already has may be and still be given at once: what the page allows, and half a minute
     *  at least (a page asking for a new one each time - FR24's - gets the phone's from moments ago without waiting) */
    static long geoMaxAge(long asked) { return Math.max(30000, Math.min(30 * 60000, Math.max(0, asked))); }
}
