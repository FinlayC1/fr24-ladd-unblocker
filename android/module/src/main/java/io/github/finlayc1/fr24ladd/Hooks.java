package io.github.finlayc1.fr24ladd;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.SequenceInputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;

import de.robv.android.xposed.XC_MethodHook;
import de.robv.android.xposed.XposedBridge;
import de.robv.android.xposed.XposedHelpers;

/**
 * FR24's gRPC messages, as its app reads and writes them - the website's grpc-web messages, unframed:
 *   gRPC's MethodDescriptor, as it is made: which method ("fr24.feed.api.v1.Feed/LiveFeed" ...) each of its two protobuf
 *   marshallers serves - the request's, the answer's (kept by the marshaller object itself, never by a name)
 *   the answer marshaller's parse(InputStream), before it reads: the bytes handed to the script (Runtime.patch) and what
 *   it gives back read in their place
 *   the request marshaller's stream(Object), once it has made the request's bytes: handed to the script; changed, they
 *   are read back into a message by the marshaller's own parse and made into bytes again by its own stream - FR24's app
 *   gets the type of stream it expects
 * The methods the script patches on the website: LiveFeed (the map), FollowFlight (the flight panel), FlightDetails (the
 * search card), Playback, TopFlights (most tracked). Any other message passes untouched, as does every message while
 * the script is not ready, slow, or switched off.
 */
final class Hooks {
    static final String SERVICE = "fr24.feed.api.v1.Feed/";
    static final Set<String> WATCH = new HashSet<>(Arrays.asList("LiveFeed", "FollowFlight", "FlightDetails", "Playback", "TopFlights"));
    // (marshaller object -> the method it serves; weak: FR24's own objects are never kept alive by the module)
    static final Map<Object, String> REQ = Collections.synchronizedMap(new WeakHashMap<>());
    static final Map<Object, String> RESP = Collections.synchronizedMap(new WeakHashMap<>());
    static final Stats STATS = new Stats();

    static final class Stats {
        volatile long descriptors, answers, answersChanged, requests, requestsChanged, failures;
        volatile String lastFailure = "";
    }

    private Hooks() {}

    static boolean install(ClassLoader cl, Targets.Found f) {
        try {
            final Class<?> desc = XposedHelpers.findClass(f.descriptorClass, cl);
            final Class<?> mar = XposedHelpers.findClass(f.marshallerClass, cl);
            final Class<?> fr24Stream = typeOf(f.streamReturn, cl);
            final Method parse = XposedHelpers.findMethodExact(mar, f.parseName, InputStream.class);
            final Method stream = XposedHelpers.findMethodExact(mar, f.streamName, Object.class);
            List<Object> ctor = new ArrayList<>();
            for (String t : f.descriptorCtor) ctor.add(typeOf(t, cl));

            // (which marshaller serves which method - recorded as each MethodDescriptor is made)
            ctor.add(new XC_MethodHook() {
                @Override protected void afterHookedMethod(MethodHookParam p) {
                    try {
                        String name = null; List<Object> ms = new ArrayList<>(2);
                        for (Object a : p.args) {
                            if (a instanceof String && name == null) name = (String) a;
                            else if (a != null && mar.isInstance(a)) ms.add(a);
                        }
                        if (name == null || !name.startsWith(SERVICE) || ms.size() != 2) return;
                        String m = name.substring(SERVICE.length());
                        if (!WATCH.contains(m)) return;
                        REQ.put(ms.get(0), m); RESP.put(ms.get(1), m);
                        if (STATS.descriptors++ < 16) L.i("FR24's " + m + " seen - its messages go through the script");
                    } catch (Throwable t) { fail("descriptor", t); }
                }
            });
            XposedHelpers.findAndHookConstructor(desc, ctor.toArray());

            // (an answer, before FR24's code reads it)
            XposedBridge.hookMethod(parse, new XC_MethodHook() {
                @Override protected void beforeHookedMethod(MethodHookParam p) {
                    String m = RESP.get(p.thisObject);
                    if (m == null) return;
                    Object a0 = p.args[0];
                    // (a message passed within the app, not bytes off the network: as it is)
                    if (!(a0 instanceof InputStream) || fr24Stream.isInstance(a0)) return;
                    Read r = readAll((InputStream) a0);
                    if (r.error != null) { p.args[0] = r.replay(); return; }   // (read as far as it went, then the same failure: FR24's own handling)
                    STATS.answers++;
                    byte[] out = Runtime.patch("resp", m, r.bytes);
                    if (out != null) STATS.answersChanged++;
                    p.args[0] = new ByteArrayInputStream(out != null ? out : r.bytes);
                }
            });

            // (a request, once its bytes are made)
            XposedBridge.hookMethod(stream, new XC_MethodHook() {
                @Override protected void afterHookedMethod(MethodHookParam p) {
                    String m = REQ.get(p.thisObject);
                    if (m == null) return;
                    Object res = p.getResult();
                    if (!(res instanceof InputStream) || p.getThrowable() != null) return;
                    Object msg = p.args[0];
                    try {
                        Read r = readAll((InputStream) res);
                        byte[] out = r.error == null ? Runtime.patch("req", m, r.bytes) : null;
                        STATS.requests++;
                        if (out != null) {
                            try { msg = XposedBridge.invokeOriginalMethod(parse, p.thisObject, new Object[]{ new ByteArrayInputStream(out) }); STATS.requestsChanged++; }
                            catch (Throwable t) { fail("request read back", t); msg = p.args[0]; }
                        }
                    } catch (Throwable t) { fail("request", t); msg = p.args[0]; }
                    // (the stream FR24 gets is always made by its own stream(): the one read here is used up)
                    try { p.setResult(XposedBridge.invokeOriginalMethod(stream, p.thisObject, new Object[]{ msg })); }
                    catch (Throwable t) {
                        fail("request stream", t);
                        try { p.setResult(XposedBridge.invokeOriginalMethod(stream, p.thisObject, new Object[]{ p.args[0] })); } catch (Throwable t2) { p.setThrowable(t2); }
                    }
                }
            });
            L.i("hooked " + f.descriptorClass + " / " + f.marshallerClass + "." + f.parseName + " / ." + f.streamName);
            return true;
        } catch (Throwable t) {
            L.e("hooks not put in - FR24's app left as it is", t);
            return false;
        }
    }

    static void fail(String where, Throwable t) {
        STATS.failures++; STATS.lastFailure = where + ": " + t;
        if (STATS.failures <= 20) L.e(where, t);
    }

    // ---- a stream read to its end ---------------------------------------------------------------------------------------
    static final class Read {
        byte[] bytes; IOException error;
        /** What a failed read gives FR24 instead: the bytes it read, then the same failure. */
        InputStream replay() {
            final IOException e = error;
            return new SequenceInputStream(new ByteArrayInputStream(bytes), new InputStream() {
                @Override public int read() throws IOException { throw e; }
                @Override public int read(byte[] b, int off, int len) throws IOException { throw e; }
            });
        }
    }

    static Read readAll(InputStream in) {
        Read r = new Read();
        ByteArrayOutputStream bo = new ByteArrayOutputStream(16384);
        byte[] buf = new byte[16384];
        try { int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n); }
        catch (IOException e) { r.error = e; }
        r.bytes = bo.toByteArray();
        return r;
    }

    // ---- a JVM type descriptor ("Lbmb$c;", "Z", "[B") as a class ---------------------------------------------------------
    static Class<?> typeOf(String d, ClassLoader cl) throws ClassNotFoundException {
        switch (d) {
            case "Z": return boolean.class;
            case "B": return byte.class;
            case "C": return char.class;
            case "S": return short.class;
            case "I": return int.class;
            case "J": return long.class;
            case "F": return float.class;
            case "D": return double.class;
            case "V": return void.class;
            default:
        }
        if (d.startsWith("[")) return Class.forName(d.replace('/', '.'), false, cl);
        if (d.startsWith("L") && d.endsWith(";")) return Class.forName(Targets.javaName(d), false, cl);
        throw new ClassNotFoundException(d);
    }
}
