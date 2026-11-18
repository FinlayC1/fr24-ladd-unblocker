import Foundation

/// The script's requests to the other sites (adsb.lol, adsb.fi, the monitor, the registers ...) - GM_xmlhttpRequest in a
/// userscript manager (src/app/shim.js) - made here, by the app, as the Android app's AppNet.java makes them:
///   - https only, to the hosts the script's header lists (@connect, with their subdomains) and those the user allowed -
///     each hop of a redirect checked too (followed here, one at a time, never by the system)
///   - as the phone's browser: the web view's user agent where the script sets none
///   - as many at once as the script sends (it keeps to each site's own limit itself)
///   - answered { t: 'res', id, status, statusText, url, headers, text } - { b64 } for bytes - or { t: 'res', id, error,
///     timeout }; an aborted one not answered
final class AppNet {
    static let maxBytes = 64 * 1024 * 1024, hops = 5

    private let connect: [String]
    private let granted: () -> [String]
    private let session: URLSession
    private let noRedirect = NoRedirect()
    private let lock = NSLock()
    private var tasks: [String: Task<Void, Never>] = [:]
    private var finished: Set<String> = []
    private var aborted: Set<String> = []
    var userAgent: String?

    init(connect: [String], granted: @escaping () -> [String]) {
        self.connect = connect
        self.granted = granted
        let cfg = URLSessionConfiguration.default
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.httpMaximumConnectionsPerHost = 6
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        cfg.httpShouldSetCookies = true
        session = URLSession(configuration: cfg)
    }

    func allowed(_ host: String?) -> Bool { Policy.hostAllowed(host, connect, granted()) }

    func request(id: String, msg: [String: Any], done: @escaping (String) -> Void) {
        let task = Task { [weak self] in
            guard let self = self else { return }
            var out = await self.fetch(msg)
            let skip = self.end(id)
            if skip { return }
            out["t"] = "res"
            out["id"] = id
            done(AppNet.json(out))
        }
        lock.lock()
        if finished.remove(id) == nil { tasks[id] = task }
        lock.unlock()
    }

    func abort(_ id: String) {
        lock.lock()
        if aborted.count > 1000 { aborted.removeAll() }
        aborted.insert(id)
        let t = tasks.removeValue(forKey: id)
        lock.unlock()
        t?.cancel()
    }

    /// the request done: true when it was aborted (not answered)
    private func end(_ id: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if tasks.removeValue(forKey: id) == nil { finished.insert(id); if finished.count > 1000 { finished.removeAll() } }
        return aborted.remove(id) != nil
    }

    private static func err(_ message: String, timeout: Bool = false) -> [String: Any] { ["error": message, "timeout": timeout] }

    static func json(_ o: [String: Any]) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: []), let s = String(data: d, encoding: .utf8) else { return "{}" }
        return s
    }

    private func fetch(_ m: [String: Any]) async -> [String: Any] {
        guard let s = m["url"] as? String, var url = URL(string: s) else { return AppNet.err("no address") }
        var method = ((m["method"] as? String) ?? "GET").uppercased()
        var body: Data? = method == "GET" || method == "HEAD" ? nil : (m["data"] as? String)?.data(using: .utf8)
        let timeoutMs = (m["timeout"] as? NSNumber)?.doubleValue ?? 0
        let headers = (m["headers"] as? [String: Any]) ?? [:]
        let binary = (m["binary"] as? Bool) ?? false
        for hop in 0...AppNet.hops {
            guard Policy.lower(url.scheme) == "https" else { return AppNet.err("https only: \(url.absoluteString)") }
            guard allowed(url.host) else { return AppNet.err("not a host the script may reach: \(url.host ?? "")") }
            var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeoutMs > 0 ? timeoutMs / 1000 : 60)
            r.httpMethod = method
            var ownUa = false
            for (k, v) in headers {
                let lk = k.lowercased()
                if lk == "host" || lk == "cookie" || lk == "content-length" { continue }
                if lk == "user-agent" { ownUa = true }
                r.setValue("\(v)", forHTTPHeaderField: k)
            }
            if !ownUa, let ua = userAgent { r.setValue(ua, forHTTPHeaderField: "User-Agent") }
            if let b = body { r.httpBody = b }
            let data: Data, resp: URLResponse
            do { (data, resp) = try await session.data(for: r, delegate: noRedirect) }
            catch {
                let ns = error as NSError
                if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorTimedOut { return AppNet.err("timeout", timeout: true) }
                return AppNet.err(ns.localizedDescription)
            }
            guard let h = resp as? HTTPURLResponse else { return AppNet.err("no answer") }
            // (followed by the system after all: never read from a host the script may not reach)
            if let final = h.url, Policy.lower(final.host) != Policy.lower(url.host), !allowed(final.host) { return AppNet.err("redirected to a host the script may not reach") }
            if (300..<400).contains(h.statusCode), h.statusCode != 304, let loc = h.value(forHTTPHeaderField: "Location"), let next = URL(string: loc, relativeTo: url)?.absoluteURL {
                if hop >= AppNet.hops { return AppNet.err("too many redirects") }
                if h.statusCode == 303 || ((h.statusCode == 301 || h.statusCode == 302) && method == "POST") { method = "GET"; body = nil }
                url = next
                continue
            }
            if data.count > AppNet.maxBytes { return AppNet.err("answer over 64 MB") }
            var hs = ""
            for (k, v) in h.allHeaderFields { hs += "\(String(describing: k).lowercased()): \(v)\r\n" }
            var out: [String: Any] = ["status": h.statusCode, "statusText": h.statusCode == 200 ? "OK" : "", "url": url.absoluteString, "headers": hs]
            if binary { out["b64"] = data.base64EncodedString() } else { out["text"] = AppNet.text(data, h.textEncodingName) }
            return out
        }
        return AppNet.err("too many redirects")
    }

    static func text(_ data: Data, _ charset: String?) -> String {
        if let cs = charset {
            let cf = CFStringConvertIANACharSetNameToEncoding(cs as CFString)
            if cf != kCFStringEncodingInvalidId, let s = String(data: data, encoding: String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))) { return s }
        }
        return String(decoding: data, as: UTF8.self)
    }
}

/// (no redirect followed by the system: each hop is checked and followed by AppNet itself)
private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest) async -> URLRequest? {
        return nil
    }
}
