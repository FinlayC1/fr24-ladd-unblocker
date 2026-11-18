package io.github.finlayc1.fr24ladd;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * A reader of Android's dex format, as far as the module needs it (Targets): the string table, the types, the methods and
 * their signatures, the classes and their methods, and in each method's code the strings it loads (const-string). Written
 * from the format's specification (source.android.com/docs/core/runtime/dex-format) - the module carries no code but its
 * own. Every read is bounds-checked: a dex file it cannot make sense of throws, and is simply not used.
 */
final class Dex {
    final byte[] b;
    final int nStrings, oStrings, nTypes, oTypes, oProtos, nMethods, oMethods, nClasses, oClasses;

    Dex(byte[] bytes) {
        b = bytes;
        if (b.length < 0x70 || b[0] != 'd' || b[1] != 'e' || b[2] != 'x' || b[3] != '\n') throw new IllegalArgumentException("not a dex file");
        if (u4(0x28) != 0x12345678) throw new IllegalArgumentException("not a little-endian dex file");
        nStrings = u4(0x38); oStrings = u4(0x3C);
        nTypes = u4(0x40); oTypes = u4(0x44);
        oProtos = u4(0x4C);
        nMethods = u4(0x58); oMethods = u4(0x5C);
        nClasses = u4(0x60); oClasses = u4(0x64);
    }

    // ---- reading ------------------------------------------------------------------------------------------------------
    int u1(int p) { return b[p] & 0xff; }
    int u2(int p) { return (b[p] & 0xff) | ((b[p + 1] & 0xff) << 8); }
    int u4(int p) { return (b[p] & 0xff) | ((b[p + 1] & 0xff) << 8) | ((b[p + 2] & 0xff) << 16) | ((b[p + 3] & 0xff) << 24); }
    /** An unsigned LEB128 at p[0]: its value; p[0] moved past it. */
    int uleb(int[] p) {
        int r = 0, s = 0, x;
        do { x = b[p[0]++] & 0xff; r |= (x & 0x7f) << s; s += 7; } while ((x & 0x80) != 0 && s < 35);
        return r;
    }

    /** String i: its MUTF-8 bytes decoded (the format's own UTF-8 with 0 as two bytes and supplementary characters as pairs). */
    String string(int i) {
        int[] p = { u4(oStrings + 4 * i) };
        int n = uleb(p);
        StringBuilder sb = new StringBuilder(n);
        int q = p[0];
        while (true) {
            int c = b[q++] & 0xff;
            if (c == 0) break;
            if (c < 0x80) sb.append((char) c);
            else if ((c & 0xe0) == 0xc0) { int c2 = b[q++] & 0x3f; sb.append((char) (((c & 0x1f) << 6) | c2)); }
            else { int c2 = b[q++] & 0x3f, c3 = b[q++] & 0x3f; sb.append((char) (((c & 0x0f) << 12) | (c2 << 6) | c3)); }
        }
        return sb.toString();
    }

    /** The index of string s, or -1: a binary search - the table is sorted by its strings' UTF-16 values. */
    int stringIndex(String s) {
        int lo = 0, hi = nStrings - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1, c = string(mid).compareTo(s);
            if (c == 0) return mid;
            if (c < 0) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }

    String type(int i) { return string(u4(oTypes + 4 * i)); }
    /** Method i: its class's type descriptor. */
    String methodClass(int i) { return type(u2(oMethods + 8 * i)); }
    String methodName(int i) { return string(u4(oMethods + 8 * i + 4)); }
    String methodReturn(int i) { int proto = u2(oMethods + 8 * i + 2); return type(u4(oProtos + 12 * proto + 4)); }
    List<String> methodParams(int i) {
        int proto = u2(oMethods + 8 * i + 2), off = u4(oProtos + 12 * proto + 8);
        List<String> out = new ArrayList<>();
        if (off == 0) return out;
        int n = u4(off);
        for (int k = 0; k < n; k++) out.add(type(u2(off + 4 + 2 * k)));
        return out;
    }

    // ---- classes, methods, code -----------------------------------------------------------------------------------------
    /** One method of a class as its class data lists it: its method index, whether virtual, and its code's offset (0: none). */
    static final class Method { int idx, codeOff; boolean virtual; }

    String classType(int c) { return type(u4(oClasses + 32 * c)); }

    List<Method> methodsOf(int c) {
        List<Method> out = new ArrayList<>();
        int dataOff = u4(oClasses + 32 * c + 24);
        if (dataOff == 0) return out;
        int[] p = { dataOff };
        int sf = uleb(p), inf = uleb(p), dm = uleb(p), vm = uleb(p);
        for (int k = 0; k < sf + inf; k++) { uleb(p); uleb(p); }
        for (int pass = 0; pass < 2; pass++) {
            int n = pass == 0 ? dm : vm, idx = 0;
            for (int k = 0; k < n; k++) {
                idx += uleb(p); uleb(p);
                Method m = new Method(); m.idx = idx; m.codeOff = uleb(p); m.virtual = pass == 1;
                out.add(m);
            }
        }
        return out;
    }

    /** Whether the code at codeOff loads any of these strings (const-string, const-string/jumbo) - and which: a bit for each, in their order. */
    int loads(int codeOff, int[] strings) {
        final int[] found = { 0 };
        walk(codeOff, si -> { for (int k = 0; k < strings.length; k++) if (strings[k] >= 0 && strings[k] == si) found[0] |= 1 << k; });
        return found[0];
    }

    /** Every string the code at codeOff loads, in order (for the tests: the walk checked against another reader's). */
    List<Integer> stringsLoaded(int codeOff) { List<Integer> out = new ArrayList<>(); walk(codeOff, out::add); return out; }

    interface StringUse { void at(int stringIndex); }

    /** The code's instructions walked by their lengths, payloads (switch tables, array data) stepped over. */
    void walk(int codeOff, StringUse use) {
        if (codeOff == 0) return;
        int n = u4(codeOff + 12), p = codeOff + 16, end = p + 2 * n;
        while (p < end) {
            int unit = u2(p), op = unit & 0xff, len;
            if (op == 0x00 && unit != 0) {
                // (a payload: packed-switch 0x0100, sparse-switch 0x0200, fill-array-data 0x0300)
                if (unit == 0x0100) len = 4 + u2(p + 2) * 2;
                else if (unit == 0x0200) len = 2 + u2(p + 2) * 4;
                else if (unit == 0x0300) { long w = u2(p + 2), size = u4(p + 4) & 0xffffffffL; len = (int) (4 + (w * size + 1) / 2); }
                else len = 1;
            } else {
                len = LEN[op];
                if (op == 0x1a) use.at(u2(p + 2));
                else if (op == 0x1b) use.at(u4(p + 2));
            }
            p += 2 * len;
        }
    }

    /** Each opcode's length in 16-bit units (the format's instruction formats); unused ones 1. */
    static final int[] LEN = new int[256];
    static {
        java.util.Arrays.fill(LEN, 1);
        int[][] spans = {
            { 0x02, 0x02, 2 }, { 0x03, 0x03, 3 }, { 0x05, 0x05, 2 }, { 0x06, 0x06, 3 }, { 0x08, 0x08, 2 }, { 0x09, 0x09, 3 },
            { 0x13, 0x13, 2 }, { 0x14, 0x14, 3 }, { 0x15, 0x16, 2 }, { 0x17, 0x17, 3 }, { 0x18, 0x18, 5 }, { 0x19, 0x19, 2 },
            { 0x1a, 0x1a, 2 }, { 0x1b, 0x1b, 3 }, { 0x1c, 0x1c, 2 }, { 0x1f, 0x20, 2 }, { 0x22, 0x23, 2 }, { 0x24, 0x26, 3 },
            { 0x29, 0x29, 2 }, { 0x2a, 0x2c, 3 }, { 0x2d, 0x3d, 2 }, { 0x44, 0x6d, 2 }, { 0x6e, 0x72, 3 }, { 0x74, 0x78, 3 },
            { 0x90, 0xaf, 2 }, { 0xd0, 0xe2, 2 }, { 0xfa, 0xfb, 4 }, { 0xfc, 0xfd, 3 }, { 0xfe, 0xff, 2 }
        };
        for (int[] s : spans) for (int op = s[0]; op <= s[1]; op++) LEN[op] = s[2];
    }

    // ---- an APK's dex files -----------------------------------------------------------------------------------------------
    /** classes.dex, classes2.dex ... of an APK (none: an APK without code, such as a split of resources). */
    static List<Dex> ofApk(File apk) throws IOException {
        List<Dex> out = new ArrayList<>();
        try (ZipFile z = new ZipFile(apk)) {
            for (Enumeration<? extends ZipEntry> en = z.entries(); en.hasMoreElements(); ) {
                ZipEntry e = en.nextElement();
                if (!e.getName().matches("classes\\d*\\.dex")) continue;
                try (InputStream in = z.getInputStream(e)) {
                    ByteArrayOutputStream bo = new ByteArrayOutputStream((int) Math.max(1024, e.getSize()));
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                    out.add(new Dex(bo.toByteArray()));
                }
            }
        }
        return out;
    }
}
