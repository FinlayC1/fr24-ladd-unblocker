package io.github.finlayc1.fr24ladd;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Assume;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

/**
 * The module's own parts that need no phone (the rest: test/unit_mobile.cjs - the script in Chromium; android/tools/Fr24Check -
 * its messages read by FR24's own code):
 *   - the hook targets as kept between runs, read back the same; a line of another form refused
 *   - JVM type descriptors as classes (the constructor FR24's MethodDescriptor is hooked by)
 *   - a stream read to its end; a failed read handed on as the same failure, after the bytes it read
 *   - the monitor's address as the script accepts it; the settings handed to the script
 *   - with FR24_APK set (an FR24 APK on this computer): the hook targets found in it
 */
public class ModuleTest {
    @Test public void foundKeptAndReadBack() {
        Targets.Found f = new Targets.Found();
        f.descriptorClass = "bmb"; f.descriptorCtor = Arrays.asList("Lbmb$c;", "Ljava/lang/String;", "Lptd$a;", "Lptd$a;", "Z");
        f.marshallerClass = "ptd$a"; f.parseName = "b"; f.streamName = "a"; f.streamReturn = "Lntd;";
        Targets.Found g = Targets.Found.decode(f.encode());
        assertEquals(f.encode(), g.encode());
        assertTrue(g.complete());
        assertNull(Targets.Found.decode("v2|bmb|x|ptd$a|b|a|Lntd;"));
        assertNull(Targets.Found.decode("v1|bmb||ptd$a|b|a|Lntd;"));
        assertNull(Targets.Found.decode(null));
    }

    @Test public void typesOfDescriptors() throws Exception {
        ClassLoader cl = getClass().getClassLoader();
        assertEquals(boolean.class, Hooks.typeOf("Z", cl));
        assertEquals(int.class, Hooks.typeOf("I", cl));
        assertEquals(String.class, Hooks.typeOf("Ljava/lang/String;", cl));
        assertEquals(byte[].class, Hooks.typeOf("[B", cl));
        assertEquals(String[].class, Hooks.typeOf("[Ljava/lang/String;", cl));
        assertEquals("com.foo.Bar$Baz", Targets.javaName("Lcom/foo/Bar$Baz;"));
        try { Hooks.typeOf("Q", cl); fail(); } catch (ClassNotFoundException expected) { /* not a type */ }
    }

    @Test public void readToItsEndAndFailedReadsHandedOn() throws Exception {
        byte[] big = new byte[100000]; for (int i = 0; i < big.length; i++) big[i] = (byte) i;
        Hooks.Read r = Hooks.readAll(new ByteArrayInputStream(big));
        assertNull(r.error); assertArrayEquals(big, r.bytes);
        final IOException boom = new IOException("connection reset");
        InputStream failing = new InputStream() {
            int n = 0;
            @Override public int read() throws IOException { if (n < 3) return n++; throw boom; }
            @Override public int read(byte[] b, int off, int len) throws IOException { if (n >= 3) throw boom; b[off] = (byte) n++; return 1; }
        };
        Hooks.Read f = Hooks.readAll(failing);
        assertEquals(boom, f.error); assertArrayEquals(new byte[]{ 0, 1, 2 }, f.bytes);
        InputStream again = f.replay();
        byte[] got = new byte[3]; assertEquals(3, again.read(got, 0, 3)); assertArrayEquals(new byte[]{ 0, 1, 2 }, got);
        try { again.read(); fail(); } catch (IOException e) { assertEquals(boom, e); }
    }

    @Test public void monitorAddresses() throws Exception {
        assertEquals("https://mon.example.org", Prefs.clean(" https://mon.example.org/ "));
        assertEquals("https://143-47-224-210.sslip.io", Prefs.clean("https://143-47-224-210.sslip.io"));
        assertEquals("", Prefs.clean("http://mon.example.org"));
        assertEquals("", Prefs.clean("https://mon.example.org/path"));
        assertEquals("", Prefs.clean("https://"));
        assertEquals("", Prefs.clean(null));
        Prefs p = new Prefs();
        assertNull(p.monJson());
        p.monUrl = "https://mon.example.org"; p.monToken = "s3cret";
        assertEquals("https://mon.example.org", p.monJson().getString("url"));
        assertEquals("s3cret", p.monJson().getString("token"));
        p.monOff = true;
        assertTrue(p.monJson().getBoolean("off"));
    }

    @Test public void targetsInARealFr24Apk() throws Exception {
        String apk = System.getenv("FR24_APK");
        Assume.assumeTrue("FR24_APK not set: no FR24 APK on this computer", apk != null && new File(apk).isFile());
        Targets.Found f = Targets.find(new File(apk));
        assertTrue("found: " + f, f.complete());
        assertTrue(f.descriptorCtor.contains("Ljava/lang/String;"));
        assertTrue(f.streamReturn.startsWith("L"));
    }
}
