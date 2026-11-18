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
}
