import UIKit
import Capacitor
import UserNotifications
import CapApp_SPM

/// Storyboard root. Registers notification plugins before the web view loads.
///
/// NotificationAuth is a class in this target, so it does not depend on
/// NSClassFromString. It calls UNUserNotificationCenter.requestAuthorization
/// directly. PushNotificationsPlugin lives in SPM; register it from the
/// linked class when the package class list did not already put it on the
/// bridge. Do not init a second copy over a plugin that is already registered.
@objc(TidyWiseBridgeViewController)
class TidyWiseBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        configureShellWebView()
        guard let bridge = self.bridge else {
            print("[Push] no bridge in capacitorDidLoad")
            return
        }
        bridge.registerPluginInstance(NotificationAuthPlugin())
        print("[Push] registered NotificationAuthPlugin")
        registerLinkedPushNotificationsPlugin(on: bridge)
        // A token that arrived before this plugin's load() is posted again
        // so the observer added in load() can still notify JavaScript.
        ApnsTokenStore.repostCachedToken()
        registerLinkedShellPlugins(on: bridge)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureShellWebView()
    }

    /// Interactive pop goes back through WKWebView history (hash routes use
    /// pushState, so they are on that list). Bounces stay off so the fixed
    /// shell does not rubber-band; list scrolling still happens inside the page.
    ///
    /// limitsNavigationsToAppBoundDomains stays false in capacitor.config.json.
    /// Embedded Stripe Checkout navigates this web view to Stripe
    /// (js.stripe.com and the other hosts in allowNavigation). App-bound
    /// domains would block that checkout.
    private func configureShellWebView() {
        webView?.allowsBackForwardNavigationGestures = true
        webView?.scrollView.bounces = false
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        // Register local plugins after the bridge initializes
        DispatchQueue.main.async {
            if let vc = self.window?.rootViewController as? CAPBridgeViewController {
                let widgetPlugin = WidgetBridgePlugin()
                vc.bridge?.registerPluginInstance(widgetPlugin)
                print("[AppDelegate] registered WidgetBridgePlugin on bridge")
            } else {
                print("[AppDelegate] WARNING: could not find CAPBridgeViewController to register plugins")
            }
        }

        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        ApnsTokenStore.remember(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        ApnsTokenStore.rememberFailure(error)
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
