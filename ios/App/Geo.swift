import CoreLocation
import Foundation

/// The phone's location for FR24's "my location" (its map's button; the airports nearest you in its search): asked of iOS
/// itself - the page's navigator.geolocation is the app's (src/app/shim.js), over the bridge, as in the Android app:
///   - a fix the phone already has, fresh enough (Policy.geoMaxAge), at once
///   - else a new one, within the time the page allows (Policy.geoTimeout) - else the phone's last fix of the last half
///     hour, else "timed out"
///   - not allowed: "permission denied"; no fix to be had: "position unavailable"
/// Answered { t: 'geo', id, ok: true, lat, lon, acc, alt, altAcc, heading, speed, ts } or { t: 'geo', id, ok: false,
/// code (1 denied, 2 unavailable, 3 timed out), message }. Used on the main thread.
final class Geo: NSObject, CLLocationManagerDelegate {
    private struct Ask { let id: String; let reply: (String) -> Void; let timer: DispatchWorkItem }
    private let lm = CLLocationManager()
    private var waiting: [Ask] = []
    private var afterAuth: [() -> Void] = []

    override init() {
        super.init()
        lm.delegate = self
    }

    var state: String {
        switch lm.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    static func fail(_ id: String, _ code: Int, _ message: String) -> String {
        AppNet.json(["t": "geo", "id": id, "ok": false, "code": code, "message": message])
    }

    static func fix(_ id: String, _ l: CLLocation) -> String {
        var o: [String: Any] = ["t": "geo", "id": id, "ok": true, "lat": l.coordinate.latitude, "lon": l.coordinate.longitude,
                                "acc": l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : 1000, "ts": Int(l.timestamp.timeIntervalSince1970 * 1000)]
        if l.verticalAccuracy >= 0 { o["alt"] = l.altitude; o["altAcc"] = l.verticalAccuracy }
        if l.course >= 0 && l.speed > 0 { o["heading"] = l.course }
        if l.speed >= 0 { o["speed"] = l.speed }
        return AppNet.json(o)
    }

    private static func ageMs(_ l: CLLocation) -> Double { -l.timestamp.timeIntervalSinceNow * 1000 }

    func get(id: String, high: Bool, timeoutMs: Double, maxAgeMs: Double, reply: @escaping (String) -> Void) {
        switch lm.authorizationStatus {
        case .notDetermined:
            afterAuth.append { [weak self] in self?.get(id: id, high: high, timeoutMs: timeoutMs, maxAgeMs: maxAgeMs, reply: reply) }
            lm.requestWhenInUseAuthorization()
            return
        case .denied, .restricted:
            reply(Geo.fail(id, 1, "not allowed"))
            return
        default:
            break
        }
        if let l = lm.location, Geo.ageMs(l) <= Policy.geoMaxAge(maxAgeMs) { reply(Geo.fix(id, l)); return }
        lm.desiredAccuracy = high ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        let timer = DispatchWorkItem { [weak self] in self?.timedOut(id) }
        waiting.append(Ask(id: id, reply: reply, timer: timer))
        DispatchQueue.main.asyncAfter(deadline: .now() + Policy.geoTimeout(timeoutMs) / 1000, execute: timer)
        lm.requestLocation()
    }

    private func timedOut(_ id: String) {
        guard let i = waiting.firstIndex(where: { $0.id == id }) else { return }
        let a = waiting.remove(at: i)
        if let l = lm.location, Geo.ageMs(l) <= 30 * 60000 { a.reply(Geo.fix(id, l)) } else { a.reply(Geo.fail(id, 3, "timed out")) }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .notDetermined { return }
        let w = afterAuth
        afterAuth = []
        w.forEach { $0() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        let w = waiting
        waiting = []
        for a in w { a.timer.cancel(); a.reply(Geo.fix(a.id, l)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        if code == .locationUnknown { return }      // (still looking: the time the page allows decides)
        let w = waiting
        waiting = []
        for a in w { a.timer.cancel(); a.reply(Geo.fail(a.id, code == .denied ? 1 : 2, error.localizedDescription)) }
    }
}
