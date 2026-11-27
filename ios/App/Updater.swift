import UIKit

/// The app's update, from the project's GitHub releases: looked for when the app opens (every twelve hours at most) and
/// when the script's Update button asks (LADD Unblock's window; src/app/shim.js TL_APP.update).
/// (1.4.3) A later release's script update (its fr24-ladd-unblocker-ios-update.json and .sig) is downloaded and kept by
/// itself - signed with the project's own key and made for this app's native part (ScriptStore) - and the page offered a
/// reload with it: nothing to install. An app installed outside the App Store cannot install its own .ipa on iOS, so a
/// release that changed the app's native part (or has no signed update) still opens its release page, its .ipa installed
/// with whatever installed this one (AltStore, Sideloadly ...).
final class Updater {
    static let every: TimeInterval = 12 * 3600
    /// (an update's size at most: the script is under 3 MB)
    static let maxUpdate = 32 * 1024 * 1024, maxSig = 8 * 1024
    private weak var host: UIViewController?
    private let prefs = UserDefaults.standard
    private var busy = false
    /// the version running: the script's (a kept update's, or the app's own)
    var running: String
    /// the page told to run the update kept - now (true) or at the next start (false)
    private let updated: (Bool) -> Void

    init(host: UIViewController, running: String, updated: @escaping (Bool) -> Void) { self.host = host; self.running = running; self.updated = updated }

    func check(asked: Bool) {
        if busy { return }
        let now = Date().timeIntervalSince1970
        if !asked && now - prefs.double(forKey: "updateCheckedAt") < Updater.every { return }
        prefs.set(now, forKey: "updateCheckedAt")
        busy = true
        var r = URLRequest(url: Policy.releasesAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        r.setValue("fr24-ladd-unblocker-ios", forHTTPHeaderField: "User-Agent")
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: r) { [weak self] data, resp, _ in
            var version: String?, files: (json: URL, sig: URL)?
            if let d = data, (resp as? HTTPURLResponse)?.statusCode == 200, let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { version = Policy.releaseVersion(j); files = Policy.updateFiles(j) }
            DispatchQueue.main.async { self?.found(version, files, asked: asked) }
        }.resume()
    }

    private func found(_ version: String?, _ files: (json: URL, sig: URL)?, asked: Bool) {
        let mine = running
        guard let v = version else { busy = false; if asked { tell("No update could be found right now.") }; return }
        guard Policy.newer(v, mine) else { busy = false; if asked { tell("This is the latest version (\(mine)).") }; return }
        guard let f = files else { busy = false; offerIpa(v, asked: asked); return }
        // (the release's script update: kept by itself when it is one this app takes - else its .ipa, as before)
        fetch(f.json, Updater.maxUpdate) { [weak self] data in
            guard let self = self else { return }
            guard let data = data else { self.busy = false; self.offerIpa(v, asked: asked); return }
            self.fetch(f.sig, Updater.maxSig) { [weak self] sig in
                guard let self = self else { return }
                self.busy = false
                guard let sig = sig, let got = ScriptStore.keep(data, sig, over: mine) else { self.offerIpa(v, asked: asked); return }
                self.running = got
                self.offerReload(got)
            }
        }
    }

    /// a file of the release, its bytes on the main thread - nil when it could not be had whole
    private func fetch(_ url: URL, _ max: Int, _ done: @escaping (Data?) -> Void) {
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        r.setValue("fr24-ladd-unblocker-ios", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: r) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200 && data != nil && (data?.count ?? 0) <= max
            DispatchQueue.main.async { done(ok ? data : nil) }
        }.resume()
    }

    private func offerReload(_ v: String) {
        let a = UIAlertController(title: "Updated to \(v)", message: "LADD Unblocker has updated itself to version \(v). Reload FR24 now to use it, or it is used the next time the app opens.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Reload now", style: .default) { [weak self] _ in self?.updated(true) })
        a.addAction(UIAlertAction(title: "Later", style: .cancel) { [weak self] _ in self?.updated(false) })
        present(a)
    }

    private func offerIpa(_ v: String, asked: Bool) {
        if !asked && prefs.string(forKey: "updateLater") == v { return }
        let a = UIAlertController(title: "Update available", message: "Version \(v) of LADD Unblocker is out (this phone has \(running)). It changes the app itself, so it cannot update on its own: its release page opens - download fr24-ladd-unblocker-ios.ipa there and install it with the app you installed this one with. Your settings stay.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Open the release page", style: .default) { _ in UIApplication.shared.open(Policy.releasesPage) })
        a.addAction(UIAlertAction(title: "Not now", style: .cancel) { [weak self] _ in self?.prefs.set(v, forKey: "updateLater") })
        present(a)
    }

    private func tell(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a)
    }

    private func present(_ a: UIAlertController) {
        guard var top = host else { return }
        while let p = top.presentedViewController { top = p }
        top.present(a, animated: true)
    }
}
