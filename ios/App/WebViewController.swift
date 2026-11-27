import UIKit
import UserNotifications
import WebKit

/// FR24 LADD Unblocker for iPhone and iPad - the Android app's twin (android/app MainActivity.java): FR24's site, as FR24
/// serves it to a phone, full-screen in the app's web view, with the script in it. The script (dist/app/app.js:
/// src/app/shim.js, the page part, the userscript) is put into each page of FR24's site at document start, before FR24's
/// own code runs, top frame only (WKUserScript); it runs only on FR24's site itself (app.js's own check). What a
/// userscript manager gives the script comes from here over a bridge (TLNative: the page's messages to the app, the app's
/// answers back) that only FR24's pages are given: its requests to the other sites (AppNet), notifications, a monitor
/// host the user allows, files the page saves (the share sheet), the phone's location (Geo), the app's update (Updater).
/// FR24's other pages open here too; a sign-in page FR24's page opens in a window of its own opens in one over the page;
/// anything else opens in Safari.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let home = URL(string: "https://www.flightradar24.com/")!
    static let bg = UIColor(red: 0x1C / 255.0, green: 0x1F / 255.0, blue: 0x24 / 255.0, alpha: 1)

    private var web: WKWebView?
    private var popup: WKWebView?
    private var popupBox: UIView?
    private var popupKept = false
    private var notice: UILabel?
    private var net: AppNet?
    private let geo = Geo()
    private var updater: Updater?
    /// (the name the app's answers reach the page's bridge by: this run's own)
    private let token = "__tl" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
    private var grantedHosts: [String] {
        get { UserDefaults.standard.stringArray(forKey: "hosts") ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: "hosts") }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = WebViewController.bg
        // (1.4.3: the app's own script, or a newer release's it updated itself to - ScriptStore)
        guard let script = ScriptStore.current() else {
            show("The app's files are incomplete. Install it again.")
            return
        }
        net = AppNet(connect: script.hosts, granted: { UserDefaults.standard.stringArray(forKey: "hosts") ?? [] })

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        // (as Safari on the phone: FR24 gives an app's web view its page for apps)
        cfg.applicationNameForUserAgent = "Version/17.0 Mobile/15E148 Safari/604.1"
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        let ucc = WKUserContentController()
        ucc.addUserScript(WKUserScript(source: prelude(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: script.source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.add(WeakHandler(self), name: "TLNative")
        cfg.userContentController = ucc

        let w = WKWebView(frame: .zero, configuration: cfg)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.allowsBackForwardNavigationGestures = true
        w.isOpaque = false
        w.backgroundColor = WebViewController.bg
        w.scrollView.backgroundColor = WebViewController.bg
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(w)
        NSLayoutConstraint.activate([
            w.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            w.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            w.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            w.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        web = w
        w.load(URLRequest(url: WebViewController.home))

        NotificationCenter.default.addObserver(self, selector: #selector(noteTapped(_:)), name: .tlNoteTapped, object: nil)
        updater = Updater(host: self, running: script.version) { [weak self] now in if now { self?.useUpdate() } }
        updater?.check(asked: false)
    }

    // (1.4.3) the update just kept, in use now: the page's scripts and the hosts its requests may go to replaced, and FR24
    // loaded again with them
    private func useUpdate() {
        guard let w = web, let script = ScriptStore.current() else { return }
        net = AppNet(connect: script.hosts, granted: { UserDefaults.standard.stringArray(forKey: "hosts") ?? [] })
        let ucc = w.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.addUserScript(WKUserScript(source: prelude(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: script.source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        updater?.running = script.version
        if let u = w.url, Policy.scriptOrigin((u.scheme ?? "") + "://" + (u.host ?? "")) { w.reload() } else { w.load(URLRequest(url: WebViewController.home)) }
    }

    // (the bridge in the page, before the script: TLNative as the script takes it - its messages to the app, the app's
    // answers to it - on FR24's site only, in its top frame)
    private func prelude() -> String {
        return """
        (function () {
          try {
            if (window.top !== window || !/^https:\\/\\/(www\\.)?flightradar24\\.com$/.test(location.origin)) return;
            var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.TLNative; if (!h) return;
            var ls = [];
            window.TLNative = { postMessage: function (s) { h.postMessage(String(s)); }, addEventListener: function (t, f) { if (t === 'message' && typeof f === 'function') ls.push(f); } };
            Object.defineProperty(window, '\(token)', { value: function (s) { for (var i = 0; i < ls.length; i++) { try { ls[i]({ data: s }); } catch (e) {} } } });
            window.__tlAppPlatform = 'ios';
          } catch (e) {}
        })();
        """
    }

    // ---- the bridge: what the script asks of the app (src/app/shim.js) --------------------------------------------------
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "TLNative", message.frameInfo.isMainFrame, let w = message.webView, w === web else { return }
        let o = message.frameInfo.securityOrigin
        guard o.protocol == "https", Policy.scriptOrigin("https://" + o.host) else { return }
        guard let s = message.body as? String, let d = s.data(using: .utf8), let m = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        let id = (m["id"] as? String) ?? ""
        switch (m["t"] as? String) ?? "" {
        case "req": net?.request(id: id, msg: m) { [weak self] out in DispatchQueue.main.async { self?.send(out) } }
        case "abort": net?.abort(id)
        case "notify": notify(id: id, title: (m["title"] as? String) ?? "", text: (m["text"] as? String) ?? "")
        case "grant": grant(id: id, origin: (m["origin"] as? String) ?? "")
        case "save": save(name: (m["name"] as? String) ?? "", b64: (m["b64"] as? String) ?? "")
        case "geo":
            geo.get(id: id, high: (m["high"] as? Bool) ?? false, timeoutMs: (m["timeout"] as? NSNumber)?.doubleValue ?? 0, maxAgeMs: (m["maxAge"] as? NSNumber)?.doubleValue ?? 0) { [weak self] out in
                DispatchQueue.main.async { self?.send(out) }
            }
        case "geoState": send(AppNet.json(["t": "geoState", "id": id, "state": geo.state == "granted" ? "granted" : "prompt"]))
        case "update": updater?.check(asked: true)
        default: break
        }
    }

    /// an answer to the page: its bridge's own name for this run
    private func send(_ json: String) {
        guard let w = web, let lit = WebViewController.jsString(json) else { return }
        w.evaluateJavaScript("window['\(token)'] && window['\(token)'](\(lit));", completionHandler: nil)
    }

    private static func jsString(_ s: String) -> String? {
        guard let d = try? JSONSerialization.data(withJSONObject: [s], options: []), var t = String(data: d, encoding: .utf8), t.count >= 2 else { return nil }
        t.removeFirst()
        t.removeLast()
        return t
    }

    private func msg(_ t: String, _ id: String, _ key: String, _ v: Any) -> String { AppNet.json(["t": t, "id": id, key: v]) }

    // (a monitor of the user's own at an address the script's header does not list: the user is asked, once for each host)
    private func grant(id: String, origin: String) {
        guard let host = Policy.grantHost(origin) else { send(msg("granted", id, "ok", false)); return }
        if net?.allowed(host) == true { send(msg("granted", id, "ok", true)); return }
        let a = UIAlertController(title: "A monitor of your own", message: "Let the script reach \(host)? It is the monitor address you entered in LADD Unblock.", preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Allow", style: .default) { [weak self] _ in
            guard let self = self else { return }
            var h = self.grantedHosts
            if !h.contains(host) { h.append(host) }
            self.grantedHosts = h
            self.send(self.msg("granted", id, "ok", true))
        })
        a.addAction(UIAlertAction(title: "Don't allow", style: .cancel) { [weak self] _ in self?.send(self?.msg("granted", id, "ok", false) ?? "{}") })
        top().present(a, animated: true)
    }

    // ---- notifications: a watched aircraft's alerts ---------------------------------------------------------------------
    private func notify(id: String, title: String, text: String) {
        let c = UNUserNotificationCenter.current()
        c.requestAuthorization(options: [.alert, .sound]) { ok, _ in
            guard ok else { return }
            let n = UNMutableNotificationContent()
            n.title = title
            n.body = text
            n.sound = .default
            n.userInfo = ["tl_note": id]
            c.add(UNNotificationRequest(identifier: UUID().uuidString, content: n, trigger: nil))
        }
    }

    @objc private func noteTapped(_ n: Notification) {
        guard let id = n.userInfo?["id"] as? String else { return }
        AppDelegate.pendingNote = nil
        send(msg("click", id, "ok", true))
    }

    // ---- files: what the page saves (the script's CSV of an aircraft's flights) - the share sheet: Files, AirDrop ... --
    private func save(name: String, b64: String) {
        guard let d = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else { return }
        let u = FileManager.default.temporaryDirectory.appendingPathComponent(Policy.safeName(name))
        do { try d.write(to: u, options: .atomic) } catch { return }
        let vc = UIActivityViewController(activityItems: [u], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        top().present(vc, animated: true)
    }

    private func top() -> UIViewController {
        var t: UIViewController = self
        while let p = t.presentedViewController { t = p }
        return t
    }

    // ---- where a page goes: FR24's own stays here; a web page, e-mail or phone number goes to the phone's own app for
    // it; anything else is not followed -----------------------------------------------------------------------------------
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if webView === popup { decisionHandler(popupDecide(url) ? .allow : .cancel); return }
        guard navigationAction.targetFrame?.isMainFrame == true else { decisionHandler(.allow); return }
        let scheme = Policy.lower(url.scheme)
        if Policy.inApp(scheme, url.host) || scheme == "about" { decisionHandler(.allow); return }
        if scheme == "http" && Policy.inApp("https", url.host), var c = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            c.scheme = "https"
            if let u = c.url { webView.load(URLRequest(url: u)) }
            decisionHandler(.cancel)
            return
        }
        if ["http", "https", "mailto", "tel"].contains(scheme) { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === web { hideNotice() } }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === web else { return }
        if net?.userAgent == nil { webView.evaluateJavaScript("navigator.userAgent") { [weak self] ua, _ in self?.net?.userAgent = ua as? String } }
        if let id = AppDelegate.pendingNote { AppDelegate.pendingNote = nil; send(msg("click", id, "ok", true)) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard webView === web else { return }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        show("Flightradar24 could not be reached.\n\nTap to try again.")
    }

    // (the page's process stopped - out of memory, or crashed: the same page again)
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView === web { webView.reload() } else if webView === popup { closePopup() }
    }

    // ---- a window the page opens: what it shows decides where - a sign-in in a window over the page, FR24's own pages in
    // the app's page, anything else in Safari ------------------------------------------------------------------------------
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let url = navigationAction.request.url, scheme = Policy.lower(url?.scheme)
        if let u = url, !u.absoluteString.isEmpty, scheme != "about" {
            if Policy.signIn(scheme, u.host) { let p = openPopup(configuration); popupKept = true; popupBox?.isHidden = false; return p }
            if Policy.inApp(scheme, u.host) { web?.load(URLRequest(url: u)); return nil }
            if ["http", "https", "mailto", "tel"].contains(scheme) { UIApplication.shared.open(u) }
            return nil
        }
        return openPopup(configuration)      // (an empty window, its page set a moment later: its first page decides)
    }

    private func openPopup(_ configuration: WKWebViewConfiguration) -> WKWebView {
        closePopup()
        let box = UIView()
        box.backgroundColor = .white
        box.isHidden = true
        box.translatesAutoresizingMaskIntoConstraints = false
        let bar = UIView()
        bar.backgroundColor = WebViewController.bg
        bar.translatesAutoresizingMaskIntoConstraints = false
        let done = UIButton(type: .system)
        done.setTitle("Close", for: .normal)
        done.tintColor = .white
        done.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        done.translatesAutoresizingMaskIntoConstraints = false
        let p = WKWebView(frame: .zero, configuration: configuration)
        p.navigationDelegate = self
        p.uiDelegate = self
        p.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(done)
        box.addSubview(bar)
        box.addSubview(p)
        view.addSubview(box)
        NSLayoutConstraint.activate([
            box.leadingAnchor.constraint(equalTo: view.leadingAnchor), box.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            box.topAnchor.constraint(equalTo: view.topAnchor), box.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bar.leadingAnchor.constraint(equalTo: box.leadingAnchor), bar.trailingAnchor.constraint(equalTo: box.trailingAnchor),
            bar.topAnchor.constraint(equalTo: box.topAnchor), bar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 44),
            done.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16), done.bottomAnchor.constraint(equalTo: bar.bottomAnchor, constant: -8),
            p.leadingAnchor.constraint(equalTo: box.leadingAnchor), p.trailingAnchor.constraint(equalTo: box.trailingAnchor),
            p.topAnchor.constraint(equalTo: bar.bottomAnchor), p.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        popup = p
        popupBox = box
        popupKept = false
        return p
    }

    /// the window's page: true to show it there. Its first decides: a sign-in - kept, and any https page after it (the
    /// provider's own steps, back to FR24); FR24's own - in the app's page; anything else - Safari
    private func popupDecide(_ url: URL) -> Bool {
        let scheme = Policy.lower(url.scheme)
        if popupKept {
            if scheme == "https" || scheme == "about" { return true }
            if ["http", "mailto", "tel"].contains(scheme) { UIApplication.shared.open(url) }
            return false
        }
        if scheme == "about" { return true }
        DispatchQueue.main.async { [weak self] in self?.closePopup() }
        if Policy.inApp(scheme, url.host) { web?.load(URLRequest(url: url)) }
        else if ["http", "https", "mailto", "tel"].contains(scheme) { UIApplication.shared.open(url) }
        return false
    }

    func webViewDidClose(_ webView: WKWebView) { if webView === popup { closePopup() } }

    @objc private func closeTapped() { closePopup() }

    private func closePopup() {
        guard let p = popup else { return }
        p.stopLoading()
        p.navigationDelegate = nil
        p.uiDelegate = nil
        popupBox?.removeFromSuperview()
        popup = nil
        popupBox = nil
        popupKept = false
    }

    // ---- the page's own dialogs ------------------------------------------------------------------------------------------
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        top().present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        top().present(a, animated: true)
    }

    // (camera and microphone: never)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    // ---- a notice over the page (offline) ------------------------------------------------------------------------------
    private func show(_ text: String) {
        if notice == nil {
            let l = UILabel()
            l.numberOfLines = 0
            l.textAlignment = .center
            l.textColor = UIColor(white: 0.91, alpha: 1)
            l.backgroundColor = WebViewController.bg
            l.isUserInteractionEnabled = true
            l.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(noticeTapped)))
            l.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(l)
            NSLayoutConstraint.activate([
                l.leadingAnchor.constraint(equalTo: view.leadingAnchor), l.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                l.topAnchor.constraint(equalTo: view.topAnchor), l.bottomAnchor.constraint(equalTo: view.bottomAnchor)
            ])
            notice = l
        }
        notice?.text = text
        notice?.isHidden = false
    }

    private func hideNotice() { notice?.isHidden = true }

    @objc private func noticeTapped() {
        hideNotice()
        guard let w = web else { return }
        if w.url == nil { w.load(URLRequest(url: WebViewController.home)) } else { w.reload() }
    }
}

/// (the bridge's handler, held weakly: the page's content controller keeps its handlers for good)
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
