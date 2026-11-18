import Foundation

/// The app's rules - the Android app's (android/app Policy.java), the same: which pages open in the app (FR24's own) and
/// which in the phone's browser; which pages are given the script and its bridge (FR24's site itself); which hosts the
/// script's requests may go to (those its header lists - @connect, each with its subdomains - and those the user allowed
/// for a monitor of their own, exactly those); a saved file's name; a sign-in window; the app's release.
enum Policy {
    static func lower(_ s: String?) -> String { (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }

    private static func bareHost(_ host: String?) -> String {
        var h = lower(host)
        if h.hasSuffix(".") { h.removeLast() }
        return h
    }

    /// a page of FR24's own: shown in the app (any of its hosts - its sign-in and its other pages too)
    static func inApp(_ scheme: String?, _ host: String?) -> Bool {
        let h = bareHost(host)
        return lower(scheme) == "https" && (h == "flightradar24.com" || h.hasSuffix(".flightradar24.com"))
    }

    /// an origin given the script and the bridge: FR24's site itself, as the userscript's @match
    static func scriptOrigin(_ origin: String) -> Bool {
        var o = lower(origin)
        while o.hasSuffix("/") { o.removeLast() }
        return o == "https://www.flightradar24.com" || o == "https://flightradar24.com"
    }

    /// may the script's request go to this host: a @connect host or one under it, or one the user allowed
    static func hostAllowed(_ host: String?, _ connect: [String], _ granted: [String]) -> Bool {
        let h = bareHost(host)
        if h.isEmpty { return false }
        for c in connect { let d = lower(c); if !d.isEmpty && (h == d || h.hasSuffix("." + d)) { return true } }
        for g in granted where h == lower(g) { return true }
        return false
    }

    /// the host of an origin the script asks to reach ("https://mon.example.org:8443" -> "mon.example.org"); nil if it is
    /// no https origin
    static func grantHost(_ origin: String) -> String? {
        let o = lower(origin)
        guard o.hasPrefix("https://") else { return nil }
        var rest = String(o.dropFirst(8))
        if let cut = rest.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) { rest = String(rest[..<cut]) }
        if rest.contains("@") { return nil }
        if let colon = rest.lastIndex(of: ":") {
            let port = rest[rest.index(after: colon)...]
            if port.isEmpty || port.count > 5 || !port.allSatisfy({ $0.isASCII && $0.isNumber }) { return nil }
            rest = String(rest[..<colon])
        }
        let label = "[a-z0-9]([a-z0-9-]*[a-z0-9])?"
        return rest.range(of: "^\(label)(\\.\(label))+$", options: .regularExpression) != nil ? rest : nil
    }

    /// a file's name as saved: no folders, nothing but letters, figures and . _ - ( ) and spaces
    static func safeName(_ name: String?) -> String {
        var n = name ?? ""
        if let slash = n.lastIndex(where: { $0 == "/" || $0 == "\\" }) { n = String(n[n.index(after: slash)...]) }
        n = String(n.map { ch -> Character in
            if ch.isASCII && (ch.isLetter || ch.isNumber || "._() -".contains(ch)) { return ch }
            return "_"
        }).trimmingCharacters(in: .whitespaces)
        while n.hasPrefix(".") { n.removeFirst() }
        if n.count > 100 {
            let dot = n.lastIndex(of: ".")
            let ext = dot.map { String(n[$0...]) } ?? ""
            n = String(n.prefix(100 - (ext.count <= 10 ? ext.count : 0))) + (ext.count <= 10 ? ext : "")
        }
        return n.isEmpty ? "download" : n
    }

    /// a sign-in provider's page, opened by FR24's page in a window of its own: kept in a window in the app, where it can
    /// give FR24's page the answer (window.opener)
    static func signIn(_ scheme: String?, _ host: String?) -> Bool {
        let h = bareHost(host)
        guard lower(scheme) == "https" else { return false }
        return ["accounts.google.com", "appleid.apple.com", "www.facebook.com", "m.facebook.com", "facebook.com", "login.microsoftonline.com", "login.live.com", "api.twitter.com", "twitter.com", "x.com"].contains(h)
    }

    // ---- the app's release: the project's GitHub releases -----------------------------------------------------------
    static let repo = "FinlayC1/fr24-ladd-unblocker", ipa = "fr24-ladd-unblocker-ios.ipa"
    static let releasesAPI = URL(string: "https://api.github.com/repos/\(repo)/releases/latest")!
    static let releasesPage = URL(string: "https://github.com/\(repo)/releases/latest")!

    /// a version ("1.3.12", "v1.3.12") as its numbers; nil when it is none
    static func version(_ v: String?) -> [Int]? {
        var s = lower(v)
        if s.hasPrefix("v") { s.removeFirst() }
        guard s.range(of: "^[0-9]{1,4}(\\.[0-9]{1,4}){1,3}$", options: .regularExpression) != nil else { return nil }
        return s.split(separator: ".").compactMap { Int($0) }
    }

    /// is version a later than version b (never when either is no version)
    static func newer(_ a: String?, _ b: String?) -> Bool {
        guard let x = version(a), let y = version(b) else { return false }
        for i in 0..<max(x.count, y.count) {
            let p = i < x.count ? x[i] : 0, q = i < y.count ? y[i] : 0
            if p != q { return p > q }
        }
        return false
    }

    /// the latest release's version, where it has this app in it (this project's own download of that release)
    static func releaseVersion(_ j: [String: Any]) -> String? {
        if (j["draft"] as? Bool) == true || (j["prerelease"] as? Bool) == true { return nil }
        guard let tag = j["tag_name"] as? String, version(tag) != nil, let assets = j["assets"] as? [[String: Any]] else { return nil }
        let want = "https://github.com/\(repo)/releases/download/\(tag)/\(ipa)"
        guard assets.contains(where: { ($0["name"] as? String) == ipa && ($0["browser_download_url"] as? String) == want }) else { return nil }
        return tag.hasPrefix("v") || tag.hasPrefix("V") ? String(tag.dropFirst()) : tag
    }

    // ---- the phone's location for FR24's "my location": what the page asked, in the app's limits (milliseconds) ------
    static func geoTimeout(_ asked: Double) -> Double { asked <= 0 ? 20000 : max(2000, min(60000, asked)) }
    static func geoMaxAge(_ asked: Double) -> Double { max(30000, min(30 * 60000, max(0, asked))) }
}
