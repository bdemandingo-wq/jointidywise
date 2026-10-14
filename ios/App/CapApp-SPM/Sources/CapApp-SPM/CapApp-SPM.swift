import Capacitor
import class PushNotificationsPlugin.PushNotificationsPlugin
import class SplashScreenPlugin.SplashScreenPlugin
import class StatusBarPlugin.StatusBarPlugin

public let isCapacitorApp = true

// packageClassList registers plugins with NSClassFromString. A Swift class
// in this package can show up in the binary and still be missing from the
// ObjC runtime until something in the linked image names it. The app target
// calls registerLinkedPushNotificationsPlugin, which keeps this reference
// alive under Release dead-stripping.
public let tidyWisePushNotificationsPlugin: AnyClass = PushNotificationsPlugin.self

/// Registers the SPM push plugin if packageClassList's NSClassFromString
/// lookup did not. A second instance is not created when one is already on
/// the bridge: overriding it runs load() twice and can deliver the APNs
/// token to a plugin the bridge no longer calls.
public func registerLinkedPushNotificationsPlugin(on bridge: CAPBridgeProtocol) {
    _ = tidyWisePushNotificationsPlugin
    if bridge.plugin(withName: "PushNotifications") != nil {
        print("[Push] PushNotificationsPlugin already on the bridge")
        return
    }
    bridge.registerPluginInstance(PushNotificationsPlugin())
    print("[Push] registered PushNotificationsPlugin from the linked SPM class")
}

/// Splash and status bar live in SPM. Registering them here keeps the launch
/// splash and theme-matched status bar working even when `packageClassList`
/// in the generated capacitor.config.json has not been refreshed yet.
/// `npx cap sync ios` rewrites Package.swift from package.json and will keep
/// these two products as long as the npm packages stay installed. It does not
/// rewrite this file.
public func registerLinkedShellPlugins(on bridge: CAPBridgeProtocol) {
    if bridge.plugin(withName: "SplashScreen") == nil {
        bridge.registerPluginInstance(SplashScreenPlugin())
        print("[Shell] registered SplashScreenPlugin")
    }
    if bridge.plugin(withName: "StatusBar") == nil {
        bridge.registerPluginInstance(StatusBarPlugin())
        print("[Shell] registered StatusBarPlugin")
    }
}
