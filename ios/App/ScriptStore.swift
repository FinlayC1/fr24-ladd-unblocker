import Foundation
import Security

/// (1.4.3) The script the app puts into FR24's pages, and the hosts its requests may go to: those built into the app
/// (Web/app.js, Web/hosts.txt), or a newer release's - its fr24-ladd-unblocker-ios-update.json (ios/update-manifest.cjs),
/// downloaded by the Updater. A release's update is taken only when
///   - it is signed with the project's own key, the one its Android app is signed with (RSA PKCS#1 v1.5 over SHA-256,
///     ios/sign-update.sh), checked with the certificate built into the app (Web/update-cert.pem);
///   - it was built for this very app: its native part's id (ios/shell-id.cjs) is this app's (Web/shell-id.txt). A release
///     that changed the native part needs its new .ipa;
///   - it is newer than the app itself.
/// It is kept in the app's own files and checked again each time the app starts; one no newer than the app (a new .ipa
/// installed since) or no longer this app's is deleted.
enum ScriptStore {
    struct Script { let source: String; let hosts: [String]; let version: String; let updated: Bool }
    static let updateName = "fr24-ladd-unblocker-ios-update.json", sigName = "fr24-ladd-unblocker-ios-update.sig"

    private static func bundled(_ name: String, _ ext: String) -> Data? {
        guard let u = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Web") else { return nil }
        return try? Data(contentsOf: u)
    }
    private static func bundledText(_ name: String, _ ext: String) -> String? { bundled(name, ext).flatMap { String(data: $0, encoding: .utf8) } }

    static var appVersion: String { (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "" }
    static var shellId: String { (bundledText("shell-id", "txt") ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    static func hostsOf(_ txt: String) -> [String] {
        txt.split(whereSeparator: { $0 == "\n" || $0 == "\r" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    private static var dir: URL? {
        guard let base = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return nil }
        let d = base.appendingPathComponent("script-update", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// the project's key: the public key of the certificate built into the app
    private static var key: SecKey? {
        guard let pem = bundledText("update-cert", "pem") else { return nil }
        let b64 = pem.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && !$0.hasPrefix("-----") }.joined()
        guard let der = Data(base64Encoded: b64), let cert = SecCertificateCreateWithData(nil, der as CFData) else { return nil }
        return SecCertificateCopyKey(cert)
    }

    /// these bytes signed with the project's key
    static func signed(_ data: Data, _ sig: Data) -> Bool {
        guard !data.isEmpty, !sig.isEmpty, let k = key, SecKeyIsAlgorithmSupported(k, .verify, .rsaSignatureMessagePKCS1v15SHA256) else { return false }
        var err: Unmanaged<CFError>?
        let ok = SecKeyVerifySignature(k, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, sig as CFData, &err)
        err?.release()
        return ok
    }

    /// a release's update, read: signed with the project's key and made for this app's native part - its version, script
    /// and hosts; nil otherwise
    static func read(_ data: Data, _ sig: Data) -> (version: String, source: String, hosts: [String])? {
        let mine = shellId
        guard !mine.isEmpty, signed(data, sig), let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              (j["v"] as? NSNumber)?.intValue == 1, let v = j["version"] as? String, Policy.version(v) != nil,
              let shell = j["shell"] as? String, shell == mine,
              let src = j["script"] as? String, !src.isEmpty, let hs = j["hosts"] as? [String] else { return nil }
        let hosts = hs.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if hosts.isEmpty { return nil }
        return (version: v, source: src, hosts: hosts)
    }

    /// the script to run now: a kept update newer than the app, else the app's own
    static func current() -> Script? {
        if let d = dir, let data = try? Data(contentsOf: d.appendingPathComponent(updateName)), let sig = try? Data(contentsOf: d.appendingPathComponent(sigName)) {
            if let u = read(data, sig), Policy.newer(u.version, appVersion) { return Script(source: u.source, hosts: u.hosts, version: u.version, updated: true) }
            clear()
        }
        guard let s = bundledText("app", "js"), let h = bundledText("hosts", "txt") else { return nil }
        return Script(source: s, hosts: hostsOf(h), version: appVersion, updated: false)
    }

    /// a release's update kept for the app to run from now on: its version - nil when it is not one this app takes, or is
    /// no newer than the one running
    static func keep(_ data: Data, _ sig: Data, over running: String) -> String? {
        guard let u = read(data, sig), Policy.newer(u.version, running), let d = dir else { return nil }
        do {
            try data.write(to: d.appendingPathComponent(updateName), options: .atomic)
            try sig.write(to: d.appendingPathComponent(sigName), options: .atomic)
        } catch { clear(); return nil }
        return u.version
    }

    static func clear() { if let d = dir { try? FileManager.default.removeItem(at: d) } }
}
