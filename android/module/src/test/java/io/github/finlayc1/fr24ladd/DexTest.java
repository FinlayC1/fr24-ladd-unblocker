package io.github.finlayc1.fr24ladd;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.android.tools.smali.dexlib2.Opcode;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedClassDef;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedMethod;
import com.android.tools.smali.dexlib2.iface.instruction.Instruction;
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction;
import com.android.tools.smali.dexlib2.iface.reference.StringReference;

import org.junit.Assume;
import org.junit.Test;

import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The module's own dex reader (Dex) and its search (Targets):
 *   - on a dex made from the module's test classes (android/tools/fixture - shaped as gRPC's descriptor and marshaller, with
 *     a switch table and array data): the hook targets found, by what the code does
 *   - every method's strings, as the module's reader walks its code, the same as dexlib2's reading - on that dex, and with
 *     FR24_APK set, on every method of FR24's APK
 */
public class DexTest {
    static byte[] fixture() throws Exception {
        try (InputStream in = DexTest.class.getClassLoader().getResourceAsStream("fixture.dex")) { return Hooks.readAll(in).bytes; }
    }

    @Test public void targetsFoundByWhatTheCodeDoes() throws Exception {
        Targets.Found f = Targets.find(Collections.singletonList(new Dex(fixture())));
        assertTrue("found: " + f, f.complete());
        assertEquals("fx.Desc", f.descriptorClass);
        assertEquals("[Lfx/Kind;, Ljava/lang/String;, Lfx/Mar;, Lfx/Mar;, Z]", f.descriptorCtor.toString());
        assertEquals("fx.Mar", f.marshallerClass);
        assertEquals("parse", f.parseName);
        assertEquals("stream", f.streamName);
        assertEquals("Ljava/io/InputStream;", f.streamReturn);
    }

    @Test public void notADex() {
        try { new Dex(new byte[200]); throw new AssertionError("read"); } catch (IllegalArgumentException expected) { /* refused */ }
        assertTrue(!Targets.find(Collections.emptyList()).complete());
    }

    @Test public void stringsAsDexlib2ReadsThem_fixture() throws Exception {
        assertEquals(0, compare(fixture(), null));
    }

    @Test public void stringsAsDexlib2ReadsThem_fr24() throws Exception {
        String apk = System.getenv("FR24_APK");
        Assume.assumeTrue("FR24_APK not set: no FR24 APK on this computer", apk != null && new File(apk).isFile());
        int methods = 0;
        for (Dex d : Dex.ofApk(new File(apk))) methods += compare(d.b, d);
        assertTrue("methods compared: " + methods, methods > 100000);
        Targets.Found f = Targets.find(new File(apk));
        assertTrue("found: " + f, f.complete());
    }

    /** Each method's loaded strings, by both readers: the methods with code compared (0 for the fixture: it returns that too). */
    static int compare(byte[] bytes, Dex mine) throws Exception {
        Dex d = mine != null ? mine : new Dex(bytes);
        DexBackedDexFile ref = new DexBackedDexFile(Opcodes.getDefault(), bytes);
        Map<String, List<String>> want = new HashMap<>();
        for (DexBackedClassDef c : ref.getClasses()) for (DexBackedMethod m : c.getMethods()) {
            if (m.getImplementation() == null) continue;
            List<String> s = new ArrayList<>();
            for (Instruction ins : m.getImplementation().getInstructions()) {
                if ((ins.getOpcode() == Opcode.CONST_STRING || ins.getOpcode() == Opcode.CONST_STRING_JUMBO) && ins instanceof ReferenceInstruction) s.add(((StringReference) ((ReferenceInstruction) ins).getReference()).getString());
            }
            want.put(c.getType() + "->" + m.getName() + m.getParameterTypes() + m.getReturnType(), s);
        }
        int n = 0;
        for (int c = 0; c < d.nClasses; c++) for (Dex.Method m : d.methodsOf(c)) {
            if (m.codeOff == 0) continue;
            String key = d.classType(c) + "->" + d.methodName(m.idx) + d.methodParams(m.idx) + d.methodReturn(m.idx);
            List<String> got = new ArrayList<>();
            for (int si : d.stringsLoaded(m.codeOff)) got.add(d.string(si));
            assertEquals(key, want.get(key), got);
            n++;
        }
        assertEquals("every method with code compared", want.size(), n);
        return mine != null ? n : 0;
    }
}
