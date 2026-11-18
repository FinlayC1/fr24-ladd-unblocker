package io.github.finlayc1.fr24ladd.app;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.util.Log;
import android.widget.Toast;

/**
 * (1.3.12) Android's installer's answer to the app's update (Updater): it wants the user to confirm - its own screen is
 * shown - or the update failed - the user is told why. Not exported: only the app's own installer session (its
 * PendingIntent, for this receiver by name) reaches it. The screen started is the system installer's own: one of the
 * phone's system apps, nothing else.
 */
public final class UpdateReceiver extends BroadcastReceiver {
    static final String ACTION = "io.github.finlayc1.fr24ladd.app.UPDATE_STATUS";

    @Override public void onReceive(Context c, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : legacyExtra(intent);
            Intent safe = confirm != null ? systemScreen(c, confirm) : null;
            if (safe == null) { Toast.makeText(c, c.getString(R.string.update_failed, "no installer"), Toast.LENGTH_LONG).show(); return; }
            try { c.startActivity(safe.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            catch (RuntimeException e) { Log.w(Updater.TAG, "installer", e); Toast.makeText(c, c.getString(R.string.update_failed, "installer"), Toast.LENGTH_LONG).show(); }
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) return;
        if (status == PackageInstaller.STATUS_FAILURE_ABORTED) return;            // (the user said no)
        String why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        if (status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE) Toast.makeText(c, R.string.update_key_text, Toast.LENGTH_LONG).show();
        else Toast.makeText(c, c.getString(R.string.update_failed, why != null ? why : "status " + status), Toast.LENGTH_LONG).show();
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyExtra(Intent i) { Object o = i.getParcelableExtra(Intent.EXTRA_INTENT); return o instanceof Intent ? (Intent) o : null; }

    /** the installer's screen as an explicit intent for the system app it resolves to - null when it resolves to anything
     *  that is not part of the phone's system */
    private static Intent systemScreen(Context c, Intent confirm) {
        PackageManager pm = c.getPackageManager();
        ResolveInfo ri = pm.resolveActivity(confirm, 0);
        ActivityInfo ai = ri != null ? ri.activityInfo : null;
        if (ai == null || ai.applicationInfo == null || (ai.applicationInfo.flags & ApplicationInfo.FLAG_SYSTEM) == 0) return null;
        Intent out = new Intent(confirm);
        out.setComponent(new ComponentName(ai.packageName, ai.name));
        out.setFlags(0);
        return out;
    }
}
