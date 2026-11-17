package fx;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

/** For the module's tests: shaped as gRPC's protobuf marshaller is - with a switch table and array data in its code, too. */
public final class Mar {
    static final int[] TABLE = { 3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9 };
    public Object parse(InputStream in) {
        int c;
        try { c = in.read(); } catch (IOException e) { throw new RuntimeException("reading", e); }
        if (c < 0) throw new IllegalStateException("Invalid protobuf byte sequence");
        switch (c) {
            case 0: return "zero";
            case 1: return "one";
            case 2: return "two";
            case 3: return "three";
            case 100: return "hundred";
            case 1000: return "thousand";
            default: return TABLE[c % TABLE.length] > 4 ? "big" : null;
        }
    }
    public InputStream stream(Object o) { return new ByteArrayInputStream(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }); }
    public Object other(String s) { return s + "other"; }
}
