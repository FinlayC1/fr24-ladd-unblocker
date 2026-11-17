package io.github.finlayc1.fr24ladd;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Where FR24's app does what the module hooks - found in the app's own code by what it does, never by name. FR24's code
 * is obfuscated (the gRPC library's MethodDescriptor is "bmb" in 11.14.0, its protobuf marshaller "ptd$a") and the names
 * change with every release; the messages these library classes carry do not:
 *   gRPC's MethodDescriptor   a constructor that checks "fullMethodName", "requestMarshaller", "responseMarshaller"
 *   its protobuf marshaller   parse(InputStream), which reports "Invalid protobuf byte sequence"; and
 *                             stream(Object) -> InputStream beside it (a request message to bytes)
 * Read with the module's own dex reader (Dex). The same class runs on the phone (in FR24's process, once per FR24
 * version - the answer kept) and on a computer against FR24's APK (android/tools/fr24check.sh, and the module's tests with
 * FR24_APK), so what is hooked on the phone is what was checked there.
 */
public final class Targets {
    /** What was found, as names and JVM type descriptors - everything a hook needs, kept as one line of text. */
    public static final class Found {
        public String descriptorClass = "";      // e.g. "bmb"
        public List<String> descriptorCtor = new ArrayList<>();   // its constructor's parameter types, "Lbmb$c;" ...
        public String marshallerClass = "";      // e.g. "ptd$a"
        public String parseName = "";            // parse(InputStream)
        public String streamName = "";           // stream(Object) -> InputStream
        public String streamReturn = "";

        public boolean complete() {
            return !descriptorClass.isEmpty() && !descriptorCtor.isEmpty() && !marshallerClass.isEmpty() && !parseName.isEmpty() && !streamName.isEmpty();
        }
        /** One line: the form kept between runs (keyed by FR24's version). */
        public String encode() {
            return "v1|" + descriptorClass + "|" + String.join(",", descriptorCtor) + "|" + marshallerClass + "|" + parseName + "|" + streamName + "|" + streamReturn;
        }
        public static Found decode(String s) {
            if (s == null) return null;
            String[] p = s.split("\\|", -1);
            if (p.length != 7 || !"v1".equals(p[0])) return null;
            Found f = new Found();
            f.descriptorClass = p[1];
            for (String t : p[2].split(",")) if (!t.isEmpty()) f.descriptorCtor.add(t);
            f.marshallerClass = p[3]; f.parseName = p[4]; f.streamName = p[5]; f.streamReturn = p[6];
            return f.complete() ? f : null;
        }
        @Override public String toString() { return encode(); }
    }

    static final String DESC_A = "requestMarshaller", DESC_B = "responseMarshaller", DESC_C = "fullMethodName";
    static final String PARSE_MARK = "Invalid protobuf byte sequence";

    /** "Lcom/foo/Bar$Baz;" -> "com.foo.Bar$Baz" (Class.forName's form) */
    public static String javaName(String desc) {
        if (desc.startsWith("L") && desc.endsWith(";")) return desc.substring(1, desc.length() - 1).replace('/', '.');
        return desc;
    }

    /** The hook targets in an APK's code (each of its dex files read; an APK that holds none, nothing found). */
    public static Found find(File apk) throws java.io.IOException { return find(Dex.ofApk(apk)); }

    /**
     * The hook targets in these dex files. Only a dex whose string table holds the marker strings is read further, and only
     * the methods that load them are looked at closely; a dex file that cannot be read is passed over.
     */
    public static Found find(List<Dex> dexes) {
        Found f = new Found();
        for (Dex d : dexes) {
            try { findIn(d, f); } catch (RuntimeException e) { /* a dex file not understood: passed over */ }
            if (f.complete()) return f;
        }
        return f;
    }

    static void findIn(Dex d, Found f) {
        int[] marks = { d.stringIndex(DESC_A), d.stringIndex(DESC_B), d.stringIndex(DESC_C), d.stringIndex(PARSE_MARK) };
        boolean descHere = marks[0] >= 0 && marks[1] >= 0 && marks[2] >= 0, parseHere = marks[3] >= 0;
        if (!descHere && !parseHere) return;
        for (int c = 0; c < d.nClasses && !f.complete(); c++) {
            List<Dex.Method> ms = d.methodsOf(c);
            for (Dex.Method m : ms) {
                int got = d.loads(m.codeOff, marks);
                if (got == 0) continue;
                if (f.descriptorClass.isEmpty() && (got & 7) == 7 && "<init>".equals(d.methodName(m.idx))) {
                    f.descriptorClass = javaName(d.classType(c));
                    f.descriptorCtor = d.methodParams(m.idx);
                }
                if (f.marshallerClass.isEmpty() && (got & 8) != 0) {
                    List<String> ps = d.methodParams(m.idx);
                    if (ps.size() != 1 || !"Ljava/io/InputStream;".equals(ps.get(0))) continue;
                    f.marshallerClass = javaName(d.classType(c));
                    f.parseName = d.methodName(m.idx);
                    // (its stream(Object): the one other virtual method of the class taking an Object, giving an object back)
                    for (Dex.Method o : ms) {
                        if (!o.virtual || o.idx == m.idx) continue;
                        List<String> op = d.methodParams(o.idx);
                        String ret = d.methodReturn(o.idx);
                        if (op.size() == 1 && "Ljava/lang/Object;".equals(op.get(0)) && ret.startsWith("L") && !d.methodName(o.idx).equals(f.parseName)) {
                            f.streamName = d.methodName(o.idx); f.streamReturn = ret; break;
                        }
                    }
                }
            }
        }
    }
}
