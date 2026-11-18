package io.github.finlayc1.fr24ladd.app;

import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * (1.3.12) The phone's location for FR24's "my location" (its map's button; the airports nearest you in its search):
 * asked of Android itself, here - the page's navigator.geolocation is the app's (src/app/shim.js), over the bridge.
 * 1.3.11 left it to the WebView's own, which waited for a fix for good on some phones - FR24's button spun and never
 * moved the map.
 *   - a fix the phone already has, fresh enough (Policy.geoMaxAge), at once
 *   - else a new one from each provider that is on (the phone's fused one where it has it, the network's, GPS), the first
 *     to come; within the time the page allows (Policy.geoTimeout) - else the phone's last fix of the last half hour,
 *     else "timed out"
 *   - location off on the phone: "position unavailable" (FR24 then centres the map on the network's location itself)
 * Answered { t: 'geo', id, ok: true, lat, lon, acc, alt, altAcc, heading, speed, ts } or { t: 'geo', id, ok: false,
 * code (1 denied, 2 unavailable, 3 timed out), message }. Run on the main thread; the caller has the permission.
 */
final class Geo {
    interface Reply { void send(String json); }

    private final LocationManager lm;
    private final Handler ui = new Handler(Looper.getMainLooper());

    Geo(Context c) { lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE); }

    static String fail(String id, int code, String message) {
        try { return new JSONObject().put("t", "geo").put("id", id).put("ok", false).put("code", code).put("message", message).toString(); }
        catch (Exception e) { return "{}"; }
    }

    static String fix(String id, Location l) {
        try {
            JSONObject o = new JSONObject().put("t", "geo").put("id", id).put("ok", true).put("lat", l.getLatitude()).put("lon", l.getLongitude())
                .put("acc", l.hasAccuracy() ? l.getAccuracy() : 1000).put("ts", l.getTime() > 0 ? l.getTime() : System.currentTimeMillis());
            if (l.hasAltitude()) o.put("alt", l.getAltitude());
            if (Build.VERSION.SDK_INT >= 26 && l.hasVerticalAccuracy()) o.put("altAcc", l.getVerticalAccuracyMeters());
            if (l.hasBearing() && l.hasSpeed() && l.getSpeed() > 0) o.put("heading", l.getBearing());
            if (l.hasSpeed()) o.put("speed", l.getSpeed());
            return o.toString();
        } catch (Exception e) { return fail(id, 2, "no position"); }
    }

    private static long ageMs(Location l) { return (SystemClock.elapsedRealtimeNanos() - l.getElapsedRealtimeNanos()) / 1000000L; }

    /** the providers that are on, the quickest first (the fused one; then the network's - or GPS first when the page asks
     *  for the best it can have) */
    private List<String> providers(boolean high) {
        List<String> out = new ArrayList<>();
        if (lm == null) return out;
        List<String> order = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) order.add(LocationManager.FUSED_PROVIDER);
        if (high) { order.add(LocationManager.GPS_PROVIDER); order.add(LocationManager.NETWORK_PROVIDER); }
        else { order.add(LocationManager.NETWORK_PROVIDER); order.add(LocationManager.GPS_PROVIDER); }
        for (String p : order) {
            try { if (lm.getAllProviders().contains(p) && lm.isProviderEnabled(p)) out.add(p); } catch (RuntimeException ignored) { /* not this one */ }
        }
        return out;
    }

    /** the phone's newest fix of any provider; null if none */
    private Location last() {
        Location best = null;
        if (lm == null) return null;
        for (String p : lm.getAllProviders()) {
            try {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getElapsedRealtimeNanos() > best.getElapsedRealtimeNanos())) best = l;
            } catch (SecurityException | IllegalArgumentException ignored) { /* not this one */ }
        }
        return best;
    }

    @SuppressWarnings({ "deprecation", "MissingPermission" })
    void get(String id, boolean high, long timeoutAsked, long maxAgeAsked, Reply reply) {
        if (lm == null) { reply.send(fail(id, 2, "no location service")); return; }
        Location had = last();
        if (had != null && ageMs(had) <= Policy.geoMaxAge(maxAgeAsked)) { reply.send(fix(id, had)); return; }
        List<String> ps = providers(high);
        if (ps.isEmpty()) { reply.send(fail(id, 2, "location is off")); return; }
        final AtomicBoolean done = new AtomicBoolean(false);
        final List<Runnable> stops = new ArrayList<>();
        final Runnable stopAll = () -> { for (Runnable r : stops) try { r.run(); } catch (RuntimeException ignored) { /* stopped */ } };
        final java.util.function.Consumer<Location> got = l -> {
            if (l == null || !done.compareAndSet(false, true)) return;
            stopAll.run();
            reply.send(fix(id, l));
        };
        for (String p : ps) {
            try {
                if (Build.VERSION.SDK_INT >= 30) {
                    CancellationSignal cs = new CancellationSignal();
                    stops.add(cs::cancel);
                    lm.getCurrentLocation(p, cs, Runnable::run, l -> ui.post(() -> got.accept(l)));
                } else {
                    LocationListener ll = new LocationListener() {
                        @Override public void onLocationChanged(Location l) { got.accept(l); }
                        @Override public void onStatusChanged(String provider, int status, Bundle extras) { /* not used */ }
                        @Override public void onProviderEnabled(String provider) { /* not used */ }
                        @Override public void onProviderDisabled(String provider) { /* not used */ }
                    };
                    stops.add(() -> lm.removeUpdates(ll));
                    lm.requestSingleUpdate(p, ll, Looper.getMainLooper());
                }
            } catch (SecurityException e) {
                if (done.compareAndSet(false, true)) { stopAll.run(); reply.send(fail(id, 1, "not allowed")); }
                return;
            } catch (RuntimeException ignored) { /* this provider cannot be asked: the others are */ }
        }
        ui.postDelayed(() -> {
            if (!done.compareAndSet(false, true)) return;
            stopAll.run();
            Location l = last();
            if (l != null && ageMs(l) <= 30 * 60000L) reply.send(fix(id, l));
            else reply.send(fail(id, 3, "timed out"));
        }, Policy.geoTimeout(timeoutAsked));
    }
}
