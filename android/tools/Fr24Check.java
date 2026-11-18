import com.android.tools.smali.dexlib2.Opcode;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedClassDef;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedMethod;
import com.android.tools.smali.dexlib2.iface.instruction.Instruction;
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction;
import com.android.tools.smali.dexlib2.iface.reference.MethodReference;
import com.android.tools.smali.dexlib2.iface.reference.StringReference;
import io.github.finlayc1.fr24ladd.Targets;
import com.android.tools.smali.dexlib2.DexFileFactory;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.iface.MultiDexContainer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A check, on a computer, of the module's messages by FR24's own code (never in the repository's CI: FR24's code is FR24's,
 * and is only read here from an APK the user supplies):
 *   - the hook targets found in FR24's APK (Targets - what the module looks for on the phone)
 *   - each gRPC method's request and answer message types, as FR24's own code pairs them with the method's name
 *   - every message the script gave back (test/unit_mobile.cjs with TL_DUMP) read by FR24's own marshaller - parse(),
 *     as FR24's app reads an answer - and written again by it - stream() - as the module gives FR24 a changed request;
 *     what FR24's own code then holds compared with what the script meant it to
 * usage: java -cp <dexlib2, guava, the module's Targets>:. Fr24Check <FR24 base.apk> <its classes as jars, dir> <android.jar> <TL_DUMP dir>
 */
public class Fr24Check {
    static int fails = 0;
    static void check(String name, boolean ok, Object extra) { if (!ok) fails++; System.out.println((ok ? "PASS  " : "FAIL  ") + name + (extra == null ? "" : "  " + extra)); }

    public static void main(String[] a) throws Exception {
        File apk = new File(a[0]), jarDir = new File(a[1]), androidJar = new File(a[2]), dump = new File(a[3]);
        List<DexBackedDexFile> dexes = dexFiles(apk);
        Targets.Found f = Targets.find(apk);
        check("the module's hook targets found in FR24's APK", f.complete(), f.encode());

        // (each method's message types, as FR24's generated stub pairs them: the default instances given to the marshaller -
        // the request's first, the answer's second - in the method that names the method)
        Map<String, String[]> types = new LinkedHashMap<>();
        for (DexBackedDexFile dex : dexes) for (DexBackedClassDef c : dex.getClasses()) for (DexBackedMethod m : c.getMethods()) {
            if (m.getImplementation() == null) continue;
            String rpc = null; List<String[]> getters = new ArrayList<>();
            boolean svc = false;
            for (Instruction ins : m.getImplementation().getInstructions()) {
                Opcode op = ins.getOpcode();
                if ((op == Opcode.CONST_STRING || op == Opcode.CONST_STRING_JUMBO) && ins instanceof ReferenceInstruction) {
                    String s = ((StringReference) ((ReferenceInstruction) ins).getReference()).getString();
                    if ("fr24.feed.api.v1.Feed".equals(s)) svc = true;
                    else if (svc && rpc == null && s.matches("[A-Z][A-Za-z]+")) rpc = s;
                } else if (rpc != null && op == Opcode.INVOKE_STATIC && ins instanceof ReferenceInstruction) {
                    MethodReference mr = (MethodReference) ((ReferenceInstruction) ins).getReference();
                    if (mr.getParameterTypes().isEmpty() && mr.getReturnType().equals(mr.getDefiningClass())) getters.add(new String[]{ mr.getDefiningClass(), mr.getName() });
                }
            }
            if (rpc != null && getters.size() >= 2 && !types.containsKey(rpc)) types.put(rpc, new String[]{ getters.get(0)[0], getters.get(0)[1], getters.get(1)[0], getters.get(1)[1] });
        }
        check("each gRPC method's message types read from FR24's own code (LiveFeed, FollowFlight ...)", types.containsKey("LiveFeed") && types.containsKey("FollowFlight"), types.keySet());

        List<URL> urls = new ArrayList<>();
        for (File j : jarDir.listFiles()) if (j.getName().endsWith(".jar")) urls.add(j.toURI().toURL());
        urls.add(androidJar.toURI().toURL());
        ClassLoader cl = new URLClassLoader(urls.toArray(new URL[0]), ClassLoader.getPlatformClassLoader());
        Class<?> mar = cl.loadClass(f.marshallerClass);
        Constructor<?> ctor = mar.getDeclaredConstructors()[0]; ctor.setAccessible(true);
        Method parse = mar.getMethod(f.parseName, InputStream.class), stream = mar.getMethod(f.streamName, Object.class);

        for (String[] t : new String[][]{ { "LiveFeed", "resp" }, { "LiveFeed", "req" }, { "FollowFlight", "resp" }, { "FollowFlight", "req" } }) {
            String[] ty = types.get(t[0]);
            boolean req = t[1].equals("req");
            Class<?> mc = cl.loadClass(Targets.javaName(req ? ty[0] : ty[2]));
            Object def = mc.getMethod(req ? ty[1] : ty[3]).invoke(null);
            Object m = ctor.newInstance(def);
            byte[] in = Files.readAllBytes(new File(dump, t[0] + "." + t[1] + ".in").toPath()), out = Files.readAllBytes(new File(dump, t[0] + "." + t[1] + ".out").toPath());
            String name = t[0] + (req ? " request" : " answer");
            Object msg; byte[] again;
            try {
                msg = parse.invoke(m, new ByteArrayInputStream(out));
                again = readAll((InputStream) stream.invoke(m, msg));
            } catch (Throwable e) { check(name + " as the script gave it back: read by FR24's own marshaller", false, e.getCause() != null ? e.getCause() : e); continue; }
            check(name + " as the script gave it back: read by FR24's own marshaller and written again by it, as " + mc.getSimpleName(), again.length > 0, out.length + " bytes in, " + again.length + " written");
            Map<String, Object> want = new LinkedHashMap<>(), got = new LinkedHashMap<>();
            if (t[0].equals("LiveFeed") && !req) {
                byte[] fo = sub(out, 1), fa = sub(again, 1);
                want.put("callsign", str(fo, 11)); got.put("callsign", str(fa, 11));
                want.put("reg", str(sub(fo, 13), 2)); got.put("reg", str(sub(fa, 13), 2));
                want.put("type", str(sub(fo, 13), 4)); got.put("type", str(sub(fa, 13), 4));
                want.put("id", num(fo, 1)); got.put("id", num(fa, 1));
                want.put("alt", num(fo, 5)); got.put("alt", num(fa, 5));
            } else if (t[0].equals("LiveFeed")) {
                want.put("mask", strs(sub(out, 10), 1)); got.put("mask", strs(sub(again, 10), 1));
            } else if (!req) {
                byte[] ao = sub(out, 1), aa = sub(again, 1);
                want.put("hex", num(ao, 1)); got.put("hex", num(aa, 1));
                want.put("reg", str(ao, 2)); got.put("reg", str(aa, 2));
                want.put("desc", str(ao, 6)); got.put("desc", str(aa, 6));
                want.put("efi id", num(sub(out, 5), 1)); got.put("efi id", num(sub(again, 5), 1));
            } else {
                want.put("bytes", java.util.Arrays.toString(out)); got.put("bytes", java.util.Arrays.toString(again));
            }
            check("... what FR24's own code holds of it is what the script put in", want.equals(got), "script " + want + " / FR24 " + got);
            // (the map: FR24's own mapper from its LiveFeed answer to the flights its map draws - GrpcFlightDataMapper, by the
            // source file name its code keeps - run on the message as FR24's marshaller read it)
            if (t[0].equals("LiveFeed") && !req) {
                Object fd = null; String how = "";
                for (DexBackedDexFile dex : dexes) for (DexBackedClassDef c : dex.getClasses()) {
                    if (!"GrpcFlightDataMapper.kt".equals(c.getSourceFile())) continue;
                    for (DexBackedMethod mm : c.getMethods()) {
                        if (mm.getParameterTypes().size() != 1 || !mm.getParameterTypes().get(0).toString().equals("L" + mc.getName().replace('.', '/') + ";")) continue;
                        Method mapper = cl.loadClass(Targets.javaName(c.getType())).getMethod(mm.getName(), mc);
                        Object res = mapper.invoke(null, msg);
                        how = Targets.javaName(c.getType()) + "." + mm.getName();
                        fd = findFlightData(res, 0);
                    }
                }
                Map<String, Object> app = new LinkedHashMap<>();
                if (fd != null) for (String k : new String[]{ "callSign", "registration", "aircraft", "flightId" }) { java.lang.reflect.Field fl = fd.getClass().getField(k); app.put(k, fl.get(fd)); }
                check("... and FR24's own mapper (" + how + ") gives its map the flight with them: callsign, registration, aircraft type", fd != null && "N601XY".equals(app.get("callSign")) && "N601XY".equals(app.get("registration")) && "C68A".equals(app.get("aircraft")), app);
            }
        }
        System.out.println(fails == 0 ? "\nall passed" : "\n" + fails + " failed");
        System.exit(fails == 0 ? 0 : 1);
    }

    // (the first FR24 FlightData in what its mapper made: its fields, maps and lists looked through, two levels deep)
    static Object findFlightData(Object o, int depth) throws Exception {
        if (o == null || depth > 3) return null;
        if (o.getClass().getName().equals("com.flightradar24free.models.entity.FlightData")) return o;
        if (o instanceof Map) { for (Object v : ((Map<?, ?>) o).values()) { Object r = findFlightData(v, depth + 1); if (r != null) return r; } return null; }
        if (o instanceof Iterable) { for (Object v : (Iterable<?>) o) { Object r = findFlightData(v, depth + 1); if (r != null) return r; } return null; }
        if (o.getClass().getName().startsWith("java.")) return null;
        for (java.lang.reflect.Field f : o.getClass().getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isStatic(f.getModifiers()) || f.getType().isPrimitive()) continue;
            f.setAccessible(true);
            Object r = findFlightData(f.get(o), depth + 1); if (r != null) return r;
        }
        return null;
    }

    // (FR24's dex files as dexlib2 reads them - the reference this check reads FR24's code with, beside the module's own reader)
    static List<DexBackedDexFile> dexFiles(File apk) throws Exception {
        List<DexBackedDexFile> out = new ArrayList<>();
        MultiDexContainer<? extends DexBackedDexFile> c = DexFileFactory.loadDexContainer(apk, Opcodes.getDefault());
        for (String name : c.getDexEntryNames()) { MultiDexContainer.DexEntry<? extends DexBackedDexFile> e = c.getEntry(name); if (e != null) out.add(e.getDexFile()); }
        return out;
    }

    static byte[] readAll(InputStream in) throws Exception { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); return o.toByteArray(); }

    // ---- protobuf fields (enough to read what was meant) ------------------------------------------------------------------
    static long[] varint(byte[] b, int p) { long r = 0; int s = 0; while (true) { int x = b[p++] & 0xff; r |= (long) (x & 0x7f) << s; s += 7; if ((x & 0x80) == 0) break; } return new long[]{ r, p }; }
    static List<Object[]> fields(byte[] b) {
        List<Object[]> out = new ArrayList<>(); int p = 0;
        if (b == null) return out;
        while (p < b.length) {
            long[] t = varint(b, p); p = (int) t[1]; int fn = (int) (t[0] >>> 3), wt = (int) (t[0] & 7);
            if (wt == 0) { long[] v = varint(b, p); p = (int) v[1]; out.add(new Object[]{ fn, v[0] }); }
            else if (wt == 2) { long[] l = varint(b, p); p = (int) l[1]; byte[] v = java.util.Arrays.copyOfRange(b, p, p + (int) l[0]); p += (int) l[0]; out.add(new Object[]{ fn, v }); }
            else if (wt == 5) { out.add(new Object[]{ fn, java.util.Arrays.copyOfRange(b, p, p + 4) }); p += 4; }
            else if (wt == 1) { out.add(new Object[]{ fn, java.util.Arrays.copyOfRange(b, p, p + 8) }); p += 8; }
            else throw new IllegalStateException("wire type " + wt);
        }
        return out;
    }
    static byte[] sub(byte[] b, int fn) { for (Object[] f : fields(b)) if ((int) f[0] == fn && f[1] instanceof byte[]) return (byte[]) f[1]; return null; }
    static String str(byte[] b, int fn) { byte[] v = sub(b, fn); return v == null ? "" : new String(v, java.nio.charset.StandardCharsets.UTF_8); }
    static long num(byte[] b, int fn) { for (Object[] f : fields(b)) if ((int) f[0] == fn && f[1] instanceof Long) return (Long) f[1]; return -1; }
    static List<String> strs(byte[] b, int fn) { List<String> o = new ArrayList<>(); for (Object[] f : fields(b)) if ((int) f[0] == fn && f[1] instanceof byte[]) o.add(new String((byte[]) f[1], java.nio.charset.StandardCharsets.UTF_8)); return o; }
}
