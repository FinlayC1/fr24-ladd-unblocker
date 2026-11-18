package io.github.finlayc1.fr24ladd;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The module's own screen (from the launcher, or LSPosed's module list): on or off, and a monitor of the user's own.
 * Saved where FR24's app can read it (LSPosed's shared settings: MODE_WORLD_READABLE, which LSPosed allows for a module
 * that declares xposedsharedprefs). FR24's app reads the settings as it starts: they apply once FR24 is closed and opened
 * again.
 */
public final class SettingsActivity extends Activity {
    private SharedPreferences sp;

    @SuppressWarnings("deprecation")
    private SharedPreferences prefs() {
        try { return getSharedPreferences(Prefs.FILE, Context.MODE_WORLD_READABLE); }
        catch (SecurityException e) { shared = false; return getSharedPreferences(Prefs.FILE, Context.MODE_PRIVATE); }
    }
    private boolean shared = true;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        sp = prefs();
        Prefs p = Prefs.from(sp);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("FR24 LADD Unblocker " + BuildConfig.VERSION_NAME);
        title.setTextSize(20);
        col.addView(title);
        TextView about = new TextView(this);
        about.setText("Shows the aircraft FR24's app hides (LADD, blocked, N/A) with their registration, type, operator and route, inside FR24's own app.\n\n"
                + "In LSPosed: enable this module, with Flightradar24 (com.flightradar24free) ticked. After any change here, close FR24 (swipe it away) and open it again."
                + (shared ? "" : "\n\nLSPosed has not given this module its shared settings yet (the module is not enabled in LSPosed): what is saved here cannot reach FR24's app until it is."));
        about.setPadding(0, pad / 2, 0, pad);
        col.addView(about);

        final Switch on = new Switch(this);
        on.setText("Turned on (off: FR24's app left exactly as it is)");
        on.setChecked(p.on);
        col.addView(on);

        final Switch monOff = new Switch(this);
        monOff.setText("No monitor at all");
        monOff.setChecked(p.monOff);
        col.addView(monOff);

        TextView ml = new TextView(this);
        ml.setText("\nYour own monitor (https://...): empty for the public one");
        col.addView(ml);
        final EditText url = new EditText(this);
        url.setSingleLine(true);
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setHint("https://your-monitor.example");
        url.setText(p.monUrl);
        col.addView(url);

        TextView tl = new TextView(this);
        tl.setText("Its secret (MON_TOKEN): left empty, the one saved is kept" + (p.monToken.isEmpty() ? "" : " (one is saved)"));
        col.addView(tl);
        final EditText token = new EditText(this);
        token.setSingleLine(true);
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        col.addView(token);

        Button save = new Button(this);
        save.setText("Save");
        save.setOnClickListener(v -> {
            String u = url.getText().toString().trim();
            if (!u.isEmpty() && Prefs.clean(u).isEmpty()) { Toast.makeText(this, "A monitor's address is https:// and its host only", Toast.LENGTH_LONG).show(); return; }
            SharedPreferences.Editor e = sp.edit().putBoolean(Prefs.ON, on.isChecked()).putBoolean(Prefs.MON_OFF, monOff.isChecked()).putString(Prefs.MON_URL, Prefs.clean(u));
            String t = token.getText().toString().trim();
            if (!t.isEmpty()) e.putString(Prefs.MON_TOKEN, t);
            if (u.isEmpty()) e.putString(Prefs.MON_TOKEN, "");
            e.apply();
            token.setText("");
            Toast.makeText(this, "Saved - close FR24 and open it again", Toast.LENGTH_LONG).show();
        });
        col.addView(save);

        ScrollView sv = new ScrollView(this);
        sv.addView(col, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(sv);
    }
}
