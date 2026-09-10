import Capacitor
import FBSDKCoreKit
import AppTrackingTransparency

@objc(MetaEventsPlugin)
public class MetaEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MetaEventsPlugin"
    public let jsName = "MetaEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "logEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logPurchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestTracking", returnType: CAPPluginReturnPromise)
    ]

    @objc func logEvent(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("Missing 'name' parameter")
            return
        }

        let params = call.getObject("params")
        let appEventName = AppEvents.Name(name)

        if let params = params {
            var fbParams: [AppEvents.ParameterName: Any] = [:]
            for (key, value) in params {
                fbParams[AppEvents.ParameterName(key)] = value
            }
            AppEvents.shared.logEvent(appEventName, parameters: fbParams)
        } else {
            AppEvents.shared.logEvent(appEventName)
        }

        print("[MetaEvents] logEvent: \(name)")
        call.resolve()
    }

    @objc func logPurchase(_ call: CAPPluginCall) {
        guard let amount = call.getDouble("amount") else {
            call.reject("Missing 'amount' parameter")
            return
        }
        guard let currency = call.getString("currency") else {
            call.reject("Missing 'currency' parameter")
            return
        }

        AppEvents.shared.logPurchase(amount: amount, currency: currency)
        print("[MetaEvents] logPurchase: \(amount) \(currency)")
        call.resolve()
    }

    @objc func requestTracking(_ call: CAPPluginCall) {
        if #available(iOS 14, *) {
            ATTrackingManager.requestTrackingAuthorization { status in
                let statusName: String
                switch status {
                case .authorized: statusName = "authorized"
                case .denied: statusName = "denied"
                case .restricted: statusName = "restricted"
                case .notDetermined: statusName = "notDetermined"
                @unknown default: statusName = "unknown"
                }
                print("[MetaEvents] ATT status: \(statusName)")
                call.resolve(["status": statusName])
            }
        } else {
            call.resolve(["status": "authorized"])
        }
    }
}
