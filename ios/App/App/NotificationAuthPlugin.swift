import Capacitor
import UIKit
import UserNotifications

/// Asks iOS for notification permission from the app target.
///
/// PushNotificationsPlugin lives in an SPM product. Its JS proxy can fail to
/// deliver requestPermissions (the await never reaches native). This class is
/// compiled into the App target and registered in capacitorDidLoad, the same
/// way WidgetBridge is, so the system prompt does not depend on that plugin.
///
/// This file is part of the App target, not a node_modules plugin, so
/// `npx cap sync ios` does not regenerate it. checkPermissions and
/// requestPermissions override CAPPlugin's open methods; without `override`
/// the bridge calls the empty base implementation. IPHONEOS_DEPLOYMENT_TARGET
/// is 16.0 on every configuration in project.pbxproj. There is no Podfile.
/// Sync reads that target when it rewrites CapApp-SPM/Package.swift and does
/// not put 15.0 back.
@objc(NotificationAuthPlugin)
public class NotificationAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NotificationAuthPlugin"
    public let jsName = "NotificationAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
    ]

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(Self.payload(status: settings.authorizationStatus, error: nil))
        }
    }

    /// Presents the system prompt. Settings → TidyWise → Notifications appears
    /// only after this call. registerForRemoteNotifications is a separate
    /// method so the JS listener is attached before APNs returns a token.
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
                let message = error?.localizedDescription
                UNUserNotificationCenter.current().getNotificationSettings { settings in
                    call.resolve(Self.payload(status: settings.authorizationStatus, error: message))
                }
            }
        }
    }

    /// Resolves with the cached APNs token, or waits for the app delegate.
    /// registerForRemoteNotifications itself does not return the token.
    @objc func register(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let token = ApnsTokenStore.cachedToken(), !token.isEmpty {
                call.resolve(["source": "NotificationAuth", "token": token])
                return
            }

            let center = NotificationCenter.default
            var tokenObserver: NSObjectProtocol?
            var failObserver: NSObjectProtocol?
            var settled = false
            let settle = { (token: String?, error: String?) in
                if settled { return }
                settled = true
                if let tokenObserver { center.removeObserver(tokenObserver) }
                if let failObserver { center.removeObserver(failObserver) }
                if let token, !token.isEmpty {
                    call.resolve(["source": "NotificationAuth", "token": token])
                } else {
                    call.reject(error ?? "APNs registration failed")
                }
            }

            tokenObserver = center.addObserver(
                forName: .capacitorDidRegisterForRemoteNotifications,
                object: nil,
                queue: .main
            ) { note in
                if let data = note.object as? Data {
                    let hex = data.map { String(format: "%02X", $0) }.joined()
                    settle(hex, nil)
                } else if let string = note.object as? String, !string.isEmpty {
                    settle(string, nil)
                }
            }
            failObserver = center.addObserver(
                forName: .capacitorDidFailToRegisterForRemoteNotifications,
                object: nil,
                queue: .main
            ) { note in
                let message = (note.object as? Error)?.localizedDescription ?? "APNs registration failed"
                settle(nil, message)
            }

            UIApplication.shared.registerForRemoteNotifications()
            DispatchQueue.main.asyncAfter(deadline: .now() + 22) {
                settle(nil, "Push registration timed out. Please try again.")
            }
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

/// Caches the APNs token in the app target.
///
/// PushNotifications.register() resolves as soon as it calls
/// registerForRemoteNotifications. The token reaches JavaScript only when the
/// SPM plugin instance that observed this notification is the instance on the
/// bridge. A token that arrives first is kept here and can be returned by
/// NotificationAuth.register(), and posted again after that plugin loads.
enum ApnsTokenStore {
    private static let lock = NSLock()
    private static var token: String?

    static func remember(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02X", $0) }.joined()
        lock.lock()
        token = hex
        lock.unlock()
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    static func rememberFailure(_ error: Error) {
        lock.lock()
        token = nil
        lock.unlock()
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    static func cachedToken() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    /// Posts a cached string token. The push plugin accepts Data or String.
    static func repostCachedToken() {
        guard let token = cachedToken(), !token.isEmpty else { return }
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
    }
}
