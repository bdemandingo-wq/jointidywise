import Capacitor
import UIKit
import UserNotifications

/// Asks iOS for notification permission from the app target.
///
/// PushNotificationsPlugin lives in an SPM product. Its JS proxy can fail to
/// deliver requestPermissions (the await never reaches native). This class is
/// compiled into the App target and registered in capacitorDidLoad, the same
/// way WidgetBridge is, so the system prompt does not depend on that plugin.
@objc(NotificationAuthPlugin)
public class NotificationAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NotificationAuthPlugin"
    public let jsName = "NotificationAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
    ]

    @objc func checkPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(Self.payload(status: settings.authorizationStatus, error: nil))
        }
    }

    /// Presents the system prompt. Settings → TidyWise → Notifications appears
    /// only after this call. registerForRemoteNotifications is a separate
    /// method so the JS listener is attached before APNs returns a token.
    @objc func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
                let message = error?.localizedDescription
                UNUserNotificationCenter.current().getNotificationSettings { settings in
                    call.resolve(Self.payload(status: settings.authorizationStatus, error: message))
                }
            }
        }
    }

    @objc func register(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
            call.resolve(["source": "NotificationAuth"])
        }
    }

    private static func payload(status: UNAuthorizationStatus, error: String?) -> [String: Any] {
        var result: [String: Any] = [
            "receive": receiveValue(status),
            "authorizationStatus": statusName(status),
            "source": "NotificationAuth",
        ]
        if let error, !error.isEmpty {
            result["error"] = error
        }
        return result
    }

    private static func receiveValue(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return "prompt"
        case .denied:
            return "denied"
        case .authorized, .provisional, .ephemeral:
            return "granted"
        @unknown default:
            return "prompt"
        }
    }

    private static func statusName(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .authorized:
            return "authorized"
        case .provisional:
            return "provisional"
        case .ephemeral:
            return "ephemeral"
        @unknown default:
            return "unknown"
        }
    }
}
