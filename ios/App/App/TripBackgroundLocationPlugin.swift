import Capacitor
import CoreLocation
import UIKit

/// Background location for an active On My Way trip.
///
/// The community background-geolocation plugin hardcodes
/// pausesLocationUpdatesAutomatically = false and does not set
/// activityType to automotiveNavigation, and it requests Always inside
/// addWatcher. This class is the trip watcher instead: it does not start
/// in load or at launch. JavaScript calls requestAlways only after the
/// in-app explainer, and start only when Always is already granted.
///
/// Compiled into the App target, same as NotificationAuth, so
/// `npx cap sync ios` does not regenerate it. IPHONEOS_DEPLOYMENT_TARGET
/// is 16.0. There is no Podfile.
@objc(TripBackgroundLocationPlugin)
public class TripBackgroundLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "TripBackgroundLocationPlugin"
    public let jsName = "TripBackgroundLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAlways", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private var locationManager: CLLocationManager?
    private var updating = false
    private var pendingAuth: CAPPluginCall?
    private var authEpoch = 0
    private var authStatusAtRequest: CLAuthorizationStatus?
    private var resignedDuringAuth = false
    private var activeObserver: NSObjectProtocol?
    private var resignObserver: NSObjectProtocol?
    private var deliveryTask: UIBackgroundTaskIdentifier = .invalid
    private var deliveryEpoch = 0
    private var tripTimeout: DispatchWorkItem?

    @objc func checkAuthorization(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = self.manager().authorizationStatus
            call.resolve(["status": self.statusName(status)])
        }
    }

    /// Presents the Always upgrade. Does not start location updates.
    /// Resolves with always, whenInUse, denied, restricted, or prompt.
    @objc func requestAlways(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let pending = self.pendingAuth {
                self.finishAuth(pending)
            }
            let manager = self.manager()
            let status = manager.authorizationStatus
            if status == .authorizedAlways || status == .denied || status == .restricted {
                call.resolve(["status": self.statusName(status)])
                return
            }
            self.pendingAuth = call
            self.authEpoch += 1
            self.resignedDuringAuth = false
            self.authStatusAtRequest = status
            let epoch = self.authEpoch
            self.watchForActive(call, epoch: epoch)
            manager.requestAlwaysAuthorization()
            // If iOS does not present a prompt, the app never resigns and the
            // authorization callback never arrives. Resolve the current
            // status so On My Way can fall back to While Using.
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self, epoch == self.authEpoch, self.pendingAuth === call else { return }
                if !self.resignedDuringAuth && UIApplication.shared.applicationState == .active {
                    self.finishAuth(call)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
                guard let self, epoch == self.authEpoch else { return }
                self.finishAuth(call)
            }
        }
    }

    /// Starts updates only for an Always grant. Battery settings: 25 m
    /// filter unless the caller passes one, automotive navigation, and
    /// pause while stationary. The blue pill is on.
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let manager = self.manager()
            guard manager.authorizationStatus == .authorizedAlways else {
                call.reject("Always location is required.", "NOT_ALWAYS")
                return
            }
            if self.updating {
                call.resolve()
                return
            }
            let filter = call.getDouble("distanceFilter") ?? 25
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = filter > 0 ? filter : 25
            manager.activityType = .automotiveNavigation
            manager.pausesLocationUpdatesAutomatically = true
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            self.updating = true
            let seconds = call.getDouble("maxDurationSeconds") ?? Double(3 * 60 * 60)
            if seconds < 0 { seconds = 0 }
            self.scheduleTripTimeout(seconds)
            manager.startUpdatingLocation()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopUpdating()
            call.resolve()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        if pendingAuth != nil {
            if status == .notDetermined { return }
            // requestAlwaysAuthorization echoes the current status before the
            // person answers. Wait for a real change, or for the app to
            // become active after the prompt closes.
            if status == authStatusAtRequest { return }
            if let call = pendingAuth {
                finishAuth(call)
            }
            return
        }
        if updating && status != .authorizedAlways {
            stopUpdating()
            notifyListeners("authorization", data: ["status": statusName(status)], retainUntilConsumed: true)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard updating, let location = locations.last else { return }
        beginDeliveryTask()
        notifyListeners("location", data: [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
        ], retainUntilConsumed: true)
    }

    public func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        // Stationary. The trip stays open; iOS resumes when the device moves.
    }

    private func manager() -> CLLocationManager {
        if let locationManager { return locationManager }
        let created = CLLocationManager()
        created.delegate = self
        locationManager = created
        return created
    }

    /// Hard stop. A trip already running keeps its original deadline.
    /// The default is 3 hours. A resumed trip can pass the time it has left.
    private func scheduleTripTimeout(_ seconds: Double) {
        tripTimeout?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.updating else { return }
            self.stopUpdating()
            self.notifyListeners("timeout", data: ["reason": "timeout"], retainUntilConsumed: true)
        }
        tripTimeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func cancelTripTimeout() {
        tripTimeout?.cancel()
        tripTimeout = nil
    }

    private func stopUpdating() {
        updating = false
        cancelTripTimeout()
        locationManager?.stopUpdatingLocation()
        locationManager?.allowsBackgroundLocationUpdates = false
        endDeliveryTask()
    }

    private func finishAuth(_ call: CAPPluginCall) {
        guard pendingAuth === call else { return }
        pendingAuth = nil
        authEpoch += 1
        resignedDuringAuth = false
        authStatusAtRequest = nil
        removeAuthObservers()
        let status = manager().authorizationStatus
        call.resolve(["status": statusName(status)])
    }

    private func watchForActive(_ call: CAPPluginCall, epoch: Int) {
        removeAuthObservers()
        resignObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, epoch == self.authEpoch else { return }
            self.resignedDuringAuth = true
        }
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // Authorization can land just after the app becomes active. Wait
            // so a status change wins over a stale While Using read.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                guard let self, epoch == self.authEpoch, self.resignedDuringAuth else { return }
                self.finishAuth(call)
            }
        }
    }

    private func removeAuthObservers() {
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
            self.activeObserver = nil
        }
        if let resignObserver {
            NotificationCenter.default.removeObserver(resignObserver)
            self.resignObserver = nil
        }
    }

    private func beginDeliveryTask() {
        if deliveryTask != .invalid { return }
        deliveryTask = UIApplication.shared.beginBackgroundTask(withName: "tidywise-on-my-way") { [weak self] in
            self?.endDeliveryTask()
        }
        scheduleDeliveryEnd()
    }

    private func scheduleDeliveryEnd() {
        deliveryEpoch += 1
        let epoch = deliveryEpoch
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard let self, epoch == self.deliveryEpoch else { return }
            self.endDeliveryTask()
        }
    }

    private func endDeliveryTask() {
        deliveryEpoch += 1
        if deliveryTask == .invalid { return }
        UIApplication.shared.endBackgroundTask(deliveryTask)
        deliveryTask = .invalid
    }

    private func statusName(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways:
            return "always"
        case .authorizedWhenInUse:
            return "whenInUse"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "prompt"
        @unknown default:
            return "unavailable"
        }
    }

    deinit {
        tripTimeout?.cancel()
        removeAuthObservers()
        endDeliveryTask()
    }
}
