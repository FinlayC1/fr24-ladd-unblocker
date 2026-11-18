import UIKit
import UserNotifications

extension Notification.Name {
    /// a notification of the app's tapped: its id (WebViewController tells the page that made it)
    static let tlNoteTapped = Notification.Name("tlNoteTapped")
}

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?
    /// (a notification tapped before the page was there: told to it when it is)
    static var pendingNote: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = WebViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    // (shown while the app is open too)
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let id = response.notification.request.content.userInfo["tl_note"] as? String {
            AppDelegate.pendingNote = id
            NotificationCenter.default.post(name: .tlNoteTapped, object: nil, userInfo: ["id": id])
        }
        completionHandler()
    }
}
