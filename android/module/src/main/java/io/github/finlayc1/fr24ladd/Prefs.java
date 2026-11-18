package io.github.finlayc1.fr24ladd;

import android.content.SharedPreferences;

/**
 * The module's settings, as its own screen (SettingsActivity) writes them and FR24's process reads them (LSPosed's
 * XSharedPreferences: the module declares xposedsharedprefs, so the file it writes is readable from FR24's app).
 *   on        the module at work (off: FR24's app left exactly as it is - nothing hooked)
 *   monUrl    a monitor of the user's own (https://...), or "" for the public one
 *   monToken  its secret (never logged, never shown back in full)
 *   monOff    no monitor at all
 */
final class Prefs {
    static final String FILE = "settings";
    static final String ON = "on", MON_URL = "monUrl", MON_TOKEN = "monToken", MON_OFF = "monOff";

    boolean on = true, monOff = false;
    String monUrl = "", monToken = "";

    static Prefs from(SharedPreferences sp) {
        Prefs p = new Prefs();
        if (sp == null) return p;
        try {
            p.on = sp.getBoolean(ON, true);
            p.monOff = sp.getBoolean(MON_OFF, false);
            p.monUrl = clean(sp.getString(MON_URL, ""));
            p.monToken = sp.getString(MON_TOKEN, "");
            if (p.monToken == null) p.monToken = "";
        } catch (Throwable t) { L.e("settings unreadable - the defaults used", t); return new Prefs(); }
        return p;
    }

    /** In FR24's process: the module's file, through LSPosed. Unreadable (the module not set up in LSPosed yet): the defaults. */
    static Prefs inApp() {
        try {
            de.robv.android.xposed.XSharedPreferences xp = new de.robv.android.xposed.XSharedPreferences(BuildConfig.APPLICATION_ID, FILE);
            if (!xp.getFile().canRead()) { L.i("the module's settings cannot be read from FR24's app (LSPosed's shared settings) - the defaults used"); return new Prefs(); }
            return from(xp);
        } catch (Throwable t) { L.e("settings unreadable - the defaults used", t); return new Prefs(); }
    }

    /** An address the script accepts for a monitor: https, a host and nothing after it - else "" (the public monitor). */
    static String clean(String u) {
        if (u == null) return "";
        u = u.trim();
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        if (!u.startsWith("https://") || u.length() <= 9) return "";
        String rest = u.substring(8);
        return rest.matches("[^/\\s]+") ? u : "";
    }

    /** TL_MOBILE.mon for the script (src/main/01-core.js monRemote): null - the script's own (the public monitor). */
    org.json.JSONObject monJson() {
        try {
            if (monOff) return new org.json.JSONObject().put("off", true);
            if (monUrl.isEmpty()) return null;
            return new org.json.JSONObject().put("url", monUrl).put("token", monToken);
        } catch (Throwable t) { return null; }
    }
}
