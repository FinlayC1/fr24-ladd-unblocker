import UIKit

/// The app's update, from the project's GitHub releases: looked for when the app opens (every twelve hours at most) and
/// when the script's Update button asks (its banner and LADD Unblock's window; src/app/shim.js TL_APP.update). Offered as
/// the Android app offers its own (android/app Updater.java, in the same words): "Update available - Version x of LADD
/// Unblocker is out (this phone has y). Update now?", Update or Not now - a version put off is not offered again by itself,
/// only when Update is pressed in the page.
/// (1.4.3) Update: the release's script update for this app's native part (fr24-ladd-unblocker-ios-update-<id>.json and its
/// .sig) is downloaded, checked - signed with the project's own key, made for this very app (ScriptStore) - and kept, and
/// FR24 loaded again with it: nothing to install. An app installed outside the App Store cannot install its own .ipa on
/// iOS, so a release that changed the app's native part (it has no update for this one) opens its release page instead,
/// its .ipa installed with whatever installed this one (AltStore, Sideloadly ...).
final class Updater {
    static let every: TimeInterval = 12 * 3600
    /// (an update's size at most: the script is under 3 MB)
    static let maxUpdate = 32 * 1024 * 1024, maxSig = 8 * 1024
    private weak var host: UIViewController?
    private let prefs = UserDefaults.standard
    private var busy = false
    private weak var toastView: UIView?
    /// the version running: the script's (a kept update's, or the app's own)
    var running: String
    /// FR24 loaded again with the update just kept
    private let updated: () -> Void

    init(host: UIViewController, running: String, updated: @escaping () -> Void) { self.host = host; self.running = running; self.updated = updated }

    /// look for a later version; asked: the user pressed Update (told the outcome either way)
    func check(asked: Bool) {
        if busy { if asked { toast("The update is already on its way.") }; return }
        let now = Date().timeIntervalSince1970
        if !asked && now - prefs.double(forKey: "updateCheckedAt") < Updater.every { return }
        prefs.set(now, forKey: "updateCheckedAt")
        busy = true
        if asked { toast("Looking for an update…") }
        let shell = ScriptStore.shellId
        var r = URLRequest(url: Policy.releasesAPI, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        r.setValue("fr24-ladd-unblocker-ios", forHTTPHeaderField: "User-Agent")
        r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: r) { [weak self] data, resp, err in
            var version: String?, files: (json: URL, sig: URL)?, why: String?
            let code = (resp as? HTTPURLResponse)?.statusCode
            if let d = data, code == 200, let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                files = Policy.updateFiles(j, shell: shell)
                // (a release with this app's update in it, or its .ipa)
                version = files != nil ? Policy.tagVersion(j) : Policy.releaseVersion(j)
            } else if let e = err { why = e.localizedDescription } else if let c = code, c != 200 { why = "GitHub answered \(c)" }
            DispatchQueue.main.async { self?.offer(version, files, asked: asked, why) }
        }.resume()
    }

    private func offer(_ version: String?, _ files: (json: URL, sig: URL)?, asked: Bool, _ why: String?) {
        busy = false
        let mine = running
        guard let v = version else { if asked { toast(why.map { "The update did not go through: \($0)" } ?? "No update could be found right now.") }; return }
        guard Policy.newer(v, mine) else { if asked { toast("This is the latest version (\(mine)).") }; return }
        if !asked && prefs.string(forKey: "updateLater") == v { return }
        let text = files != nil
            ? "Version \(v) of LADD Unblocker is out (this phone has \(mine)). Update now?"
            : "Version \(v) of LADD Unblocker is out (this phone has \(mine)). It changes the app itself, so it is installed from its release page: download fr24-ladd-unblocker-ios.ipa there and install it with the app you installed this one with - your settings stay. Update now?"
        let a = UIAlertController(title: "Update available", message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Update", style: .default) { [weak self] _ in
            if let f = files { self?.start(v, f) } else { UIApplication.shared.open(Policy.releasesPage) }
        })
        a.addAction(UIAlertAction(title: "Not now", style: .cancel) { [weak self] _ in self?.prefs.set(v, forKey: "updateLater") })
        present(a)
    }

    /// Update pressed: the release's update downloaded, checked and kept, then FR24 loaded again with it
    private func start(_ v: String, _ f: (json: URL, sig: URL)) {
        if busy { toast("The update is already on its way."); return }
        busy = true
        toast("Downloading version \(v)…")
        let from = running
        fetch(f.json, Updater.maxUpdate) { [weak self] data in
            guard let self = self else { return }
            guard let data = data else { self.failed("it could not be downloaded"); return }
            self.fetch(f.sig, Updater.maxSig) { [weak self] sig in
                guard let self = self else { return }
                guard let sig = sig else { self.failed("it could not be downloaded"); return }
                guard let got = ScriptStore.keep(data, sig, over: from) else { self.failed("it is not one this app can take"); return }
                self.busy = false
                self.running = got
                self.updated()
                self.toast("Updated to version \(got).")
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

    /// (the update could not be had or checked: its .ipa, from the release page)
    private func failed(_ why: String) {
        busy = false
        let a = UIAlertController(title: nil, message: "The update did not go through: \(why). The release page has the app's .ipa, to install with the app you installed this one with - your settings stay.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Open the release page", style: .default) { _ in UIApplication.shared.open(Policy.releasesPage) })
        a.addAction(UIAlertAction(title: "Not now", style: .cancel))
        present(a)
    }

    /// a short note over the page, gone by itself (as Android's toast)
    private func toast(_ text: String) {
        guard let v = host?.view else { return }
        toastView?.removeFromSuperview()
        let box = UIView(), l = UILabel()
        box.backgroundColor = UIColor(white: 0.12, alpha: 0.94)
        box.layer.cornerRadius = 18
        box.isUserInteractionEnabled = false
        box.translatesAutoresizingMaskIntoConstraints = false
        l.text = text
        l.textColor = .white
        l.font = .systemFont(ofSize: 15)
        l.numberOfLines = 0
        l.textAlignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(l)
        v.addSubview(box)
        NSLayoutConstraint.activate([
            l.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 16),
            l.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -16),
            l.topAnchor.constraint(equalTo: box.topAnchor, constant: 10),
            l.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -10),
            box.centerXAnchor.constraint(equalTo: v.centerXAnchor),
            box.leadingAnchor.constraint(greaterThanOrEqualTo: v.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            box.bottomAnchor.constraint(equalTo: v.safeAreaLayoutGuide.bottomAnchor, constant: -72)
        ])
        toastView = box
        box.alpha = 0
        UIView.animate(withDuration: 0.2) { box.alpha = 1 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { [weak box] in
            guard let b = box else { return }
            UIView.animate(withDuration: 0.3, animations: { b.alpha = 0 }, completion: { _ in b.removeFromSuperview() })
        }
    }

    private func present(_ a: UIAlertController) {
        guard var top = host else { return }
        while let p = top.presentedViewController { top = p }
        top.present(a, animated: true)
    }
}
