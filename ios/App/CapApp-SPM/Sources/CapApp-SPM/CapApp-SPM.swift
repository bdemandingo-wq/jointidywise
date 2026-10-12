import Capacitor
import class PushNotificationsPlugin.PushNotificationsPlugin

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
