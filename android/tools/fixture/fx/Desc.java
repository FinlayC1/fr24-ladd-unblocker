package fx;

/** For the module's tests (android/module/src/test): shaped as gRPC's MethodDescriptor is - the checks its constructor makes. */
public final class Desc {
    final Kind k; final String n; final Mar a, b; final boolean z;
    public Desc(Kind k, String n, Mar a, Mar b, boolean z) {
        this.k = req(k, "type"); this.n = req(n, "fullMethodName"); this.a = req(a, "requestMarshaller"); this.b = req(b, "responseMarshaller"); this.z = z;
    }
    static <T> T req(T o, String what) { if (o == null) throw new NullPointerException(what); return o; }
}
