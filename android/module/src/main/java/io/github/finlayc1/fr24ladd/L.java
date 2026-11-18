package io.github.finlayc1.fr24ladd;

/** The module's log: Android's (logcat, tag FR24LADD) and, for what goes wrong, LSPosed's own log too. */
final class L {
    static final String TAG = "FR24LADD";
    private L() {}

    static void i(String msg) { try { android.util.Log.i(TAG, msg); } catch (Throwable ignored) { System.out.println(TAG + " " + msg); } }

    static void e(String msg, Throwable t) {
        String line = TAG + ": " + msg + (t != null ? " - " + t : "");
        try { android.util.Log.e(TAG, msg, t); } catch (Throwable ignored) { System.err.println(line); }
        try { de.robv.android.xposed.XposedBridge.log(line); } catch (Throwable ignored) { /* not inside LSPosed */ }
    }

    static void e(String msg) { e(msg, null); }
}
