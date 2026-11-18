import UIKit

/// The app's update, from the project's GitHub releases: looked for when the app opens (every twelve hours at most) and
/// when the script's Update button asks (LADD Unblock's window; src/app/shim.js TL_APP.update). An app installed outside
/// the App Store cannot install its own update on iOS: a later version found, the user is told, and the release page
/// opens - its .ipa is installed with whatever installed this one (AltStore, Sideloadly ...).
final class Updater {
    static let every: TimeInterval = 12 * 3600
    private weak var host: UIViewController?
    private let prefs = UserDefaults.standard
    private var busy = false

    init(host: UIViewController) { self.host = host }

    var installed: String { (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "" }

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
            var version: String?
            if let d = data, (resp as? HTTPURLResponse)?.statusCode == 200, let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { version = Policy.releaseVersion(j) }
            DispatchQueue.main.async { self?.offer(version, asked: asked) }
        }.resume()
    }

    private func offer(_ version: String?, asked: Bool) {
        busy = false
        let mine = installed
        guard let v = version else { if asked { tell("No update could be found right now.") }; return }
        guard Policy.newer(v, mine) else { if asked { tell("This is the latest version (\(mine)).") }; return }
        if !asked && prefs.string(forKey: "updateLater") == v { return }
        let a = UIAlertController(title: "Update available", message: "Version \(v) of LADD Unblocker is out (this phone has \(mine)). Its release page opens: download fr24-ladd-unblocker-ios.ipa there and install it with the app you installed this one with. Your settings stay.", preferredStyle: .alert)
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
