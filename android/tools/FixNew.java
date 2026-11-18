import com.android.tools.smali.dexlib2.Opcode;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedClassDef;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedMethod;
import com.android.tools.smali.dexlib2.iface.instruction.Instruction;
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction;
import com.android.tools.smali.dexlib2.iface.reference.TypeReference;
import io.github.finlayc1.fr24ladd.Targets;
import com.android.tools.smali.dexlib2.DexFileFactory;
import com.android.tools.smali.dexlib2.iface.MultiDexContainer;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * For Fr24Check only: dex2jar's reading of FR24's release build put right where R8 replaced a class's own (trivial)
 * constructor with its parent's - dex: new-instance C, invoke-direct Parent.<init> - which dex2jar writes as "new Parent"
 * (an abstract class, or simply the wrong one). Each method's allocations are taken from the dex as written there, in order,
 * and given to the JVM code's "new"s in the same order - only where the two count alike (else the method is left as it was,
 * and counted: a wrong guess shows as an error, never as a pass).
 * usage: java -cp dexlib2:guava:asm:. FixNew <FR24 base.apk> in.jar out.jar
 */
public class FixNew {
    public static void main(String[] a) throws Exception {
        Map<String, List<String>> allocs = new HashMap<>();   // "owner name desc" -> new-instance types, in order
        for (DexBackedDexFile dex : dexFiles(new File(a[0]))) for (DexBackedClassDef c : dex.getClasses()) for (DexBackedMethod m : c.getMethods()) {
            if (m.getImplementation() == null) continue;
            List<String> l = null;
            for (Instruction ins : m.getImplementation().getInstructions()) {
                if (ins.getOpcode() != Opcode.NEW_INSTANCE) continue;
                if (l == null) l = new ArrayList<>();
                String t = ((TypeReference) ((ReferenceInstruction) ins).getReference()).getType();
                l.add(t.substring(1, t.length() - 1));
            }
            if (l != null) {
                StringBuilder d = new StringBuilder("(");
                for (CharSequence p : m.getParameterTypes()) d.append(p);
                d.append(')').append(m.getReturnType());
                allocs.put(c.getType().substring(1, c.getType().length() - 1) + " " + m.getName() + " " + d, l);
            }
        }
        int[] fixed = { 0 }, skipped = { 0 };
        try (ZipInputStream in = new ZipInputStream(new FileInputStream(a[1])); ZipOutputStream out = new ZipOutputStream(new FileOutputStream(a[2]))) {
            ZipEntry e;
            while ((e = in.getNextEntry()) != null) {
                byte[] b = readAll(in);
                if (e.getName().endsWith(".class")) {
                    ClassReader cr = new ClassReader(b);
                    final String owner = cr.getClassName();
                    // (first pass: each method's "new"s, to compare counts)
                    final Map<String, Integer> news = new HashMap<>();
                    cr.accept(new ClassVisitor(Opcodes.ASM9) {
                        @Override public MethodVisitor visitMethod(int acc, String name, String desc, String sig, String[] ex) {
                            final String k = owner + " " + name + " " + desc;
                            return new MethodVisitor(Opcodes.ASM9) { @Override public void visitTypeInsn(int op, String type) { if (op == Opcodes.NEW) news.merge(k, 1, Integer::sum); } };
                        }
                    }, 0);
                    ClassWriter cw = new ClassWriter(0);
                    final boolean[] changed = { false };
                    cr.accept(new ClassVisitor(Opcodes.ASM9, cw) {
                        @Override public MethodVisitor visitMethod(int acc, String name, String desc, String sig, String[] ex) {
                            MethodVisitor mv = super.visitMethod(acc, name, desc, sig, ex);
                            final String k = owner + " " + name + " " + desc;
                            final List<String> want = allocs.get(k);
                            Integer have = news.get(k);
                            if (want == null || have == null) return mv;
                            if (have != want.size()) { skipped[0]++; return mv; }
                            return new MethodVisitor(Opcodes.ASM9, mv) {
                                int i = 0;
                                @Override public void visitTypeInsn(int op, String type) {
                                    if (op == Opcodes.NEW) { String w = want.get(i++); if (!w.equals(type)) { fixed[0]++; changed[0] = true; super.visitTypeInsn(op, w); return; } }
                                    super.visitTypeInsn(op, type);
                                }
                            };
                        }
                    }, 0);
                    if (changed[0]) b = cw.toByteArray();
                }
                out.putNextEntry(new ZipEntry(e.getName()));
                out.write(b);
                out.closeEntry();
            }
        }
        System.out.println(a[1] + ": " + fixed[0] + " allocations put right, " + skipped[0] + " methods left (counts differ)");
    }

    // (FR24's dex files as dexlib2 reads them - the reference this check reads FR24's code with, beside the module's own reader)
    static List<DexBackedDexFile> dexFiles(File apk) throws Exception {
        List<DexBackedDexFile> out = new ArrayList<>();
        MultiDexContainer<? extends DexBackedDexFile> c = DexFileFactory.loadDexContainer(apk, com.android.tools.smali.dexlib2.Opcodes.getDefault());
        for (String name : c.getDexEntryNames()) { MultiDexContainer.DexEntry<? extends DexBackedDexFile> e = c.getEntry(name); if (e != null) out.add(e.getDexFile()); }
        return out;
    }

    static byte[] readAll(InputStream in) throws Exception { ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; while ((n = in.read(b)) > 0) o.write(b, 0, n); return o.toByteArray(); }
}
