package io.github.finlayc1.fr24ladd.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * (1.3.12) The app's own update, from the project's GitHub releases (Policy.RELEASES_API):
 *   - looked for when the app opens - every twelve hours at most - and when the script's Update button asks
 *     (LADD Unblock's window; src/app/shim.js TL_APP.update)
 *   - a later version there: the user is asked; then its APK is downloaded (this project's own download address only),
 *     checked against the SHA-256 GitHub gives for it, and checked to be this app signed with the same key as the one on
 *     the phone - Android would refuse it otherwise - before Android's installer is given it (it asks the user to confirm)
 *   - signed with another key (a release built without the project's own key - docs/mobile.md): the user is told, and
 *     can open the release page to install it after uninstalling this one
 * Android asks once whether the app may install apps ("Install unknown apps"); the user is taken to that setting.
 */
final class Updater {
    static final String TAG = "FR24LADD";
    static final long EVERY = 12 * 3600 * 1000L;

    private final Activity a;
    private final SharedPreferences prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService bg = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "fr24ladd-update"); t.setDaemon(true); return t; });
    private Policy.Release waiting;          // (asked to update, the install setting still off: carried on once it is on)
    private boolean busy;

    Updater(Activity a) { this.a = a; this.prefs = a.getSharedPreferences("update", Activity.MODE_PRIVATE); }

    String installed() {
        try { return a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    /** look for a later version; asked: the user pressed Update (told the outcome either way) */
    void check(boolean asked) {
        if (busy) { if (asked) toast(a.getString(R.string.update_busy)); return; }
        long now = System.currentTimeMillis();
        if (!asked && now - prefs.getLong("checkedAt", 0) < EVERY) return;
        prefs.edit().putLong("checkedAt", now).apply();
        if (asked) toast(a.getString(R.string.update_checking));
        bg.execute(() -> {
            Policy.Release r = null; String err = null;
            try { r = Policy.release(new JSONObject(new String(get(Policy.RELEASES_API, 2 * 1024 * 1024), StandardCharsets.UTF_8))); }
            catch (Exception e) { err = String.valueOf(e.getMessage()); Log.w(TAG, "update check", e); }
            final Policy.Release rel = r; final String why = err;
            ui.post(() -> offer(rel, asked, why));
        });
    }

    private void offer(Policy.Release r, boolean asked, String err) {
        if (a.isFinishing() || a.isDestroyed()) return;
        String mine = installed();
        if (r == null) { if (asked) toast(err != null ? a.getString(R.string.update_failed, err) : a.getString(R.string.update_none_found)); return; }
        if (!Policy.newer(r.version, mine)) { if (asked) toast(a.getString(R.string.update_latest, mine)); return; }
        if (!asked && r.version.equals(prefs.getString("later", ""))) return;
        try {
            new AlertDialog.Builder(a)
                .setTitle(R.string.update_title)
                .setMessage(a.getString(R.string.update_text, r.version, mine))
                .setPositiveButton(R.string.update_now, (d, w) -> start(r))
                .setNegativeButton(R.string.update_later, (d, w) -> prefs.edit().putString("later", r.version).apply())
                .show();
        } catch (RuntimeException e) { Log.w(TAG, "update dialog", e); }
    }

    private void start(Policy.Release r) {
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            waiting = r;
            try {
                new AlertDialog.Builder(a)
                    .setTitle(R.string.update_allow_title)
                    .setMessage(R.string.update_allow_text)
                    .setPositiveButton(R.string.update_allow_open, (d, w) -> {
                        try { a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName()))); }
                        catch (RuntimeException e) { waiting = null; toast(a.getString(R.string.update_failed, "settings")); }
                    })
                    .setNegativeButton(R.string.update_later, (d, w) -> waiting = null)
                    .show();
            } catch (RuntimeException e) { waiting = null; }
            return;
        }
        download(r);
    }

    /** back in the app: the install setting turned on meanwhile - the update carried on */
    void resumed() {
        Policy.Release r = waiting;
        if (r != null && a.getPackageManager().canRequestPackageInstalls()) { waiting = null; download(r); }
    }

    private void download(Policy.Release r) {
        if (busy) return;
        busy = true;
        toast(a.getString(R.string.update_downloading, r.version));
        bg.execute(() -> {
            File f = new File(a.getCacheDir(), "update.apk");
            String problem = null; boolean otherKey = false;
            try {
                byte[] sha = fetchTo(r.url, f, r.size);
                if (!r.sha256.isEmpty() && !r.sha256.equals(Policy.hex(sha))) problem = "the download does not match the release";
                else {
                    int s = sameApp(f);
                    if (s == 1) problem = "the download is not this app";
                    else if (s == 2) otherKey = true;
                }
                if (problem == null && !otherKey) install(f);
            } catch (Exception e) { problem = String.valueOf(e.getMessage()); Log.w(TAG, "update download", e); }
            final String p = problem; final boolean k = otherKey;
            ui.post(() -> {
                busy = false;
                if (k) otherKey();
                else if (p != null) toast(a.getString(R.string.update_failed, p));
            });
        });
    }

    private void otherKey() {
        if (a.isFinishing() || a.isDestroyed()) return;
        try {
            new AlertDialog.Builder(a)
                .setTitle(R.string.update_key_title)
                .setMessage(R.string.update_key_text)
                .setPositiveButton(R.string.update_key_open, (d, w) -> {
                    try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(Policy.RELEASES_PAGE)).addCategory(Intent.CATEGORY_BROWSABLE)); }
                    catch (RuntimeException e) { toast(a.getString(R.string.no_app)); }
                })
                .setNegativeButton(R.string.update_later, null)
                .show();
        } catch (RuntimeException e) { Log.w(TAG, "update dialog", e); }
    }

    /** 0: this app, signed as the one on the phone; 1: not this app (or not later than it); 2: this app, another key */
    @SuppressWarnings("deprecation")
    private int sameApp(File f) throws PackageManager.NameNotFoundException {
        PackageManager pm = a.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo got = pm.getPackageArchiveInfo(f.getPath(), flags), mine = pm.getPackageInfo(a.getPackageName(), flags);
        if (got == null || !a.getPackageName().equals(got.packageName)) return 1;
        if (got.getLongVersionCode() <= mine.getLongVersionCode()) return 1;
        Set<String> x = certs(got), y = certs(mine);
        // (an archive's signers Android could not read: left to the installer, which refuses another key itself)
        if (x.isEmpty() || y.isEmpty()) return 0;
        return x.equals(y) ? 0 : 2;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> certs(PackageInfo p) {
        Set<String> out = new HashSet<>();
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= 28 && p.signingInfo != null) sigs = p.signingInfo.hasMultipleSigners() ? p.signingInfo.getApkContentsSigners() : p.signingInfo.getSigningCertificateHistory();
        if ((sigs == null || sigs.length == 0) && p.signatures != null) sigs = p.signatures;
        if (sigs != null) for (Signature s : sigs) try { out.add(Policy.hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray()))); } catch (Exception ignored) { /* none */ }
        return out;
    }

    // (Android's installer given the APK: it asks the user to confirm - UpdateReceiver shows its screen - and puts it over
    // this one; the app restarts as the new version)
    private void install(File f) throws IOException {
        PackageInstaller pi = a.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        sp.setAppPackageName(a.getPackageName());
        int id = pi.createSession(sp);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(f); OutputStream out = s.openWrite("app.apk", 0, f.length())) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            Intent done = new Intent(a, UpdateReceiver.class).setAction(UpdateReceiver.ACTION).setPackage(a.getPackageName());
            PendingIntent p = PendingIntent.getBroadcast(a, id, done, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
            s.commit(p.getIntentSender());
        } catch (IOException | RuntimeException e) {
            try { pi.abandonSession(id); } catch (RuntimeException ignored) { /* gone */ }
            throw e;
        }
    }

    private void toast(String s) { ui.post(() -> { if (!a.isFinishing()) Toast.makeText(a, s, Toast.LENGTH_LONG).show(); }); }

    // ---- the two requests: GitHub's answer, and the APK (redirected to GitHub's file host - https throughout) -----------
    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "fr24-ladd-unblocker-app");
        c.setRequestProperty("Accept", url.startsWith("https://api.github.com/") ? "application/vnd.github+json" : "application/octet-stream");
        return c;
    }

    static byte[] get(String url, int max) throws IOException {
        HttpURLConnection c = open(url);
        try {
            int st = c.getResponseCode();
            if (st != 200) throw new IOException("HTTP " + st);
            if (!"https".equals(c.getURL().getProtocol())) throw new IOException("not https");
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[32768]; int n;
                while ((n = in.read(buf)) > 0) { bo.write(buf, 0, n); if (bo.size() > max) throw new IOException("answer too large"); }
                return bo.toByteArray();
            }
        } finally { c.disconnect(); }
    }

    /** the file downloaded into f - no more than the release says it is - and its SHA-256 */
    static byte[] fetchTo(String url, File f, long size) throws Exception {
        HttpURLConnection c = open(url);
        try {
            int st = c.getResponseCode();
            if (st != 200) throw new IOException("HTTP " + st);
            if (!"https".equals(c.getURL().getProtocol())) throw new IOException("not https");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long got = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(f)) {
                byte[] buf = new byte[65536]; int n;
                while ((n = in.read(buf)) > 0) {
                    got += n;
                    if (got > Math.min(size, Policy.MAX_APK)) throw new IOException("larger than the release says");
                    md.update(buf, 0, n); out.write(buf, 0, n);
                }
            }
            if (got != size) throw new IOException("incomplete download");
            return md.digest();
        } finally { c.disconnect(); }
    }
}
