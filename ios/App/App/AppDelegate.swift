import UIKit
import Capacitor
import UserNotifications
import FBSDKCoreKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Initialize Facebook SDK before Capacitor
        FBSDKCoreKit.ApplicationDelegate.shared.application(application, didFinishLaunchingWithOptions: launchOptions)

        UNUserNotificationCenter.current().delegate = self

        // Register local plugins after the bridge initializes
        DispatchQueue.main.async {
            if let vc = self.window?.rootViewController as? CAPBridgeViewController {
                let widgetPlugin = WidgetBridgePlugin()
                vc.bridge?.registerPluginInstance(widgetPlugin)
                print("[AppDelegate] registered WidgetBridgePlugin on bridge")

                let metaPlugin = MetaEventsPlugin()
                vc.bridge?.registerPluginInstance(metaPlugin)
                print("[AppDelegate] registered MetaEventsPlugin on bridge")
            } else {
                print("[AppDelegate] WARNING: could not find CAPBridgeViewController to register plugins")
            }
        }

        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Only let FB SDK process its own URLs (fb{appId}:// scheme).
        // Non-Facebook URLs (Supabase auth callbacks, deep links) go
        // straight to Capacitor without touching the FB SDK pipeline.
        if url.scheme?.hasPrefix("fb") == true {
            if FBSDKCoreKit.ApplicationDelegate.shared.application(app, open: url, options: options) {
                return true
            }
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.badge, .sound, .banner, .list])
    }

}
