package io.github.finlayc1.fr24ladd;

import android.content.pm.ApplicationInfo;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

import de.robv.android.xposed.IXposedHookLoadPackage;
import de.robv.android.xposed.IXposedHookZygoteInit;
import de.robv.android.xposed.callbacks.XC_LoadPackage;

/**
 * Where LSPosed starts the module, in each app it is enabled for - FR24's only (res/values/arrays.xml). In FR24's main
 * process: the hook targets found in FR24's code (Targets - kept for that version of FR24, so once per FR24 update),
 * the gRPC hooks put in (Hooks), and the page the script runs in started once FR24's app is up (Runtime).
 * Nothing found, or anything going wrong: FR24's app is left as it is - never stopped.
 */
public final class Entry implements IXposedHookLoadPackage, IXposedHookZygoteInit {
    static volatile String modulePath = "";

    @Override
    public void initZygote(StartupParam startupParam) { modulePath = startupParam.modulePath; }

    @Override
    public void handleLoadPackage(XC_LoadPackage.LoadPackageParam lp) {
        if (!BuildConfig.FR24_PACKAGE.equals(lp.packageName) || !BuildConfig.FR24_PACKAGE.equals(lp.processName)) return;
        try {
            Prefs p = Prefs.inApp();
            if (!p.on) { L.i("switched off in the module's settings: FR24's app left as it is"); return; }
            Targets.Found f = targets(lp.appInfo);
            if (f == null || !f.complete()) { L.e("FR24's app (this version) not recognised: nothing hooked - FR24 works as it is. Found: " + f); return; }
            if (!Hooks.install(lp.classLoader, f)) return;
            Runtime.prepare(lp.classLoader, p);
            L.i("ready in FR24 " + lp.appInfo.sourceDir + " - module " + BuildConfig.VERSION_NAME);
        } catch (Throwable t) { L.e("not started - FR24's app left as it is", t); }
    }

    // ---- the hook targets, kept for this version of FR24 --------------------------------------------------------------
    /** FR24's APK (and its parts that hold code): what identifies this version of it, and this version of the module. */
    static String keyOf(ApplicationInfo ai) {
        StringBuilder k = new StringBuilder("m" + BuildConfig.VERSION_CODE);
        for (String p : apkPaths(ai)) { File f = new File(p); k.append('|').append(p).append(':').append(f.length()).append(':').append(f.lastModified()); }
        return k.toString();
    }

    static List<String> apkPaths(ApplicationInfo ai) {
        List<String> out = new ArrayList<>();
        if (ai.sourceDir != null) out.add(ai.sourceDir);
        if (ai.splitSourceDirs != null) for (String s : ai.splitSourceDirs) if (s != null) out.add(s);
        return out;
    }

    static Targets.Found targets(ApplicationInfo ai) {
        File dir = new File(ai.dataDir, "files/fr24ladd"), file = new File(dir, "targets.txt");
        String key = keyOf(ai);
        try {
            if (file.canRead()) {
                List<String> lines = Files.readAllLines(file.toPath(), StandardCharsets.UTF_8);
                if (lines.size() >= 2 && key.equals(lines.get(0))) {
                    Targets.Found f = Targets.Found.decode(lines.get(1));
                    if (f != null) return f;
                }
            }
        } catch (Throwable t) { L.e("the kept hook targets unreadable - looked for again", t); }
        long t0 = System.currentTimeMillis();
        List<Dex> dexes = new ArrayList<>();
        for (String p : apkPaths(ai)) {
            try { dexes.addAll(Dex.ofApk(new File(p))); } catch (Throwable t) { /* a part without code */ }
        }
        Targets.Found f = Targets.find(dexes);
        L.i("FR24's code read for its hook targets in " + (System.currentTimeMillis() - t0) + " ms: " + f);
        if (f.complete()) {
            try {
                if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("cannot make " + dir);
                try (FileOutputStream o = new FileOutputStream(file)) { o.write((key + "\n" + f.encode() + "\n").getBytes(StandardCharsets.UTF_8)); }
            } catch (Throwable t) { L.e("the hook targets not kept (looked for again next time)", t); }
        }
        return f;
    }
}
