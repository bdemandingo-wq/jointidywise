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
    /// Wall-clock end of the 3 hour trip. Checked on each fix because a
    /// suspended timer does not fire until the app is running again.
    private var tripDeadline: Date?
    private var trackingRowId: String?
    private var supabaseUrl: String?
    private var supabaseAnonKey: String?
    private var writeInterval: TimeInterval = 8
    private var latestBackgroundFix: CLLocation?
    private var lastSentFix: CLLocation?
    private var lastNativeWriteAt = Date.distantPast
    private var nativeWriteTimer: DispatchWorkItem?
    private var nativeWriteInFlight = false
    private var writeEpoch = 0
    /// Bumped on each new start. Events carry it so a retained event from
    /// the previous trip is ignored after the buffer is cleared.
    private var watchEpoch = 0
    private var destination: CLLocation?
    private var bookingId: String?
    private var staffId: String?
    private var lastKnownFix: CLLocation?
    private var heartbeatTimer: DispatchWorkItem?
    /// Inside the 3–5 minute window, and under the 15 minute stale reaper.
    private let heartbeatInterval: TimeInterval = 4 * 60
    /// Set when the next locked-phone flush is a heartbeat retry. The flush
    /// then stamps recorded_at with the current time, not the GPS fix time.
    private var flushUsesHeartbeatClock = false
    private let arrivalRadius: CLLocationDistance = 100
    private var arrivalInFlight = false
    /// After a failed arrival text, wait before the next native try.
    private var arrivalRetryNotBefore: Date?
    private let arrivalRetryDelay: TimeInterval = 45

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
    /// updates that keep running while the device is stationary. The blue
    /// pill is on. A second start while one is running is rejected.
    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let manager = self.manager()
            guard manager.authorizationStatus == .authorizedAlways else {
                call.reject("Always location is required.", "NOT_ALWAYS")
                return
            }
            if self.updating {
                call.reject("A trip watcher is already running.", "ALREADY_RUNNING")
                return
            }
            // Drop timeout/arrival events retained from the previous trip
            // before the new listener is attached.
            self.retainedEventArguments = [:]
            self.watchEpoch += 1
            let filter = call.getDouble("distanceFilter") ?? 25
            // Arrival is a 100 m geofence, so hundred-meter accuracy is enough.
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = filter > 0 ? filter : 25
            manager.activityType = .automotiveNavigation
            manager.pausesLocationUpdatesAutomatically = false
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            self.updating = true
            self.rememberWriteTarget(call)
            var seconds = call.getDouble("maxDurationSeconds") ?? Double(3 * 60 * 60)
            if seconds < 0 { seconds = 0 }
            self.scheduleTripTimeout(seconds)
            self.scheduleHeartbeat()
            manager.startUpdatingLocation()
            call.resolve(["epoch": self.watchEpoch])
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
            notifyListeners("authorization", data: eventFields(["status": statusName(status)]), retainUntilConsumed: true)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard updating, let location = locations.last else { return }
        if let tripDeadline, Date() >= tripDeadline {
            stopForDeadline()
            return
        }
        lastKnownFix = location
        if withinArrivalRadius(location) {
            handleArrival(location)
            return
        }
        // The WebView is suspended while the phone is locked, so JavaScript
        // cannot write. Post the latest fix from here. While the app is
        // active, the existing JS path keeps the 8 second throttle.
        if UIApplication.shared.applicationState == .active {
            beginDeliveryTask()
            notifyListeners("location", data: eventFields([
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
            ]), retainUntilConsumed: true)
            return
        }
        noteBackgroundFix(location)
    }

    private func manager() -> CLLocationManager {
        if let locationManager { return locationManager }
        let created = CLLocationManager()
        created.delegate = self
        locationManager = created
        return created
    }

    /// Hard stop on the wall clock. `.now()` pauses while the phone sleeps,
    /// so a locked 3 hour trip would run long. A trip already running keeps
    /// its original deadline. The default is 3 hours. A resumed trip can
    /// pass the time it has left.
    private func scheduleTripTimeout(_ seconds: Double) {
        tripTimeout?.cancel()
        tripDeadline = Date().addingTimeInterval(seconds)
        let work = DispatchWorkItem { [weak self] in
            self?.stopForDeadline()
        }
        tripTimeout = work
        DispatchQueue.main.asyncAfter(wallDeadline: DispatchWallTime.now() + seconds, execute: work)
    }

    private func stopForDeadline() {
        guard updating else { return }
        let fields = eventFields(["reason": "timeout"])
        stopUpdating()
        notifyListeners("timeout", data: fields, retainUntilConsumed: true)
    }

    private func cancelTripTimeout() {
        tripTimeout?.cancel()
        tripTimeout = nil
        tripDeadline = nil
    }

    private func stopUpdating() {
        updating = false
        writeEpoch += 1
        nativeWriteInFlight = false
        nativeWriteTimer?.cancel()
        nativeWriteTimer = nil
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        flushUsesHeartbeatClock = false
        arrivalInFlight = false
        arrivalRetryNotBefore = nil
        latestBackgroundFix = nil
        lastKnownFix = nil
        destination = nil
        bookingId = nil
        staffId = nil
        cancelTripTimeout()
        locationManager?.showsBackgroundLocationIndicator = false
        locationManager?.allowsBackgroundLocationUpdates = false
        locationManager?.stopUpdatingLocation()
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

    /// Locked-phone writes.
    ///
    /// Capacitor delivers location to JavaScript, and JavaScript cannot run
    /// while the WebView is suspended. This posts one row update with the
    /// signed-in cleaner's access token, read from the same Capacitor
    /// Preferences entry supabase-js uses (`CapacitorStorage.sb-<ref>-auth-token`).
    /// The request is a PATCH to `cleaner_location_tracking` with `apikey`
    /// set to the public anon key, so the staff RLS policy and the consent
    /// trigger still apply. Fixes closer together than the write interval
    /// collapse to the latest coordinate. The table stores one current point,
    /// not a trail. A refresh that rotates the refresh token is written back
    /// so the WebView does not log the cleaner out when it wakes.
    private func rememberWriteTarget(_ call: CAPPluginCall) {
        if let id = call.getString("trackingId"), !id.isEmpty {
            trackingRowId = id
        }
        if let url = call.getString("supabaseUrl"), !url.isEmpty {
            supabaseUrl = url
        }
        if let key = call.getString("supabaseAnonKey"), !key.isEmpty {
            supabaseAnonKey = key
        }
        if let seconds = call.getDouble("writeIntervalSeconds"), seconds > 0 {
            writeInterval = seconds
        }
        if let lat = call.getDouble("destinationLat"), let lng = call.getDouble("destinationLng"),
           lat >= -90, lat <= 90, lng >= -180, lng <= 180 {
            destination = CLLocation(latitude: lat, longitude: lng)
        } else {
            destination = nil
        }
        bookingId = call.getString("bookingId")
        staffId = call.getString("staffId")
    }

    private func withinArrivalRadius(_ location: CLLocation) -> Bool {
        guard let destination else { return false }
        return location.distance(from: destination) <= arrivalRadius
    }

    private func noteBackgroundFix(_ location: CLLocation, heartbeatClock: Bool = false) {
        latestBackgroundFix = location
        flushUsesHeartbeatClock = heartbeatClock
        if nativeWriteInFlight { return }
        let elapsed = Date().timeIntervalSince(lastNativeWriteAt)
        if elapsed >= writeInterval {
            flushBackgroundFix()
            return
        }
        if nativeWriteTimer != nil { return }
        let work = DispatchWorkItem { [weak self] in
            self?.nativeWriteTimer = nil
            self?.flushBackgroundFix()
        }
        nativeWriteTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (writeInterval - elapsed), execute: work)
    }

    private func flushBackgroundFix() {
        guard updating, !nativeWriteInFlight, let location = latestBackgroundFix else { return }
        guard let rowId = trackingRowId, isTrackingRowId(rowId),
              let url = supabaseUrl, let anon = supabaseAnonKey else { return }
        latestBackgroundFix = nil
        lastSentFix = location
        lastNativeWriteAt = Date()
        nativeWriteInFlight = true
        let epoch = writeEpoch
        let heartbeat = flushUsesHeartbeatClock
        // A heartbeat retry must stamp now. The GPS fix time is minutes old
        // by the time the token or the PATCH is retried, and the reaper
        // would close a trip that is still parked and active.
        let recordedAt = heartbeat ? iso8601(Date()) : iso8601(location.timestamp)
        flushUsesHeartbeatClock = false
        accessToken(url: url, anonKey: anon) { [weak self] token in
            guard let self else { return }
            guard let token else {
                DispatchQueue.main.async {
                    guard epoch == self.writeEpoch else { return }
                    self.nativeWriteInFlight = false
                    if self.latestBackgroundFix == nil { self.latestBackgroundFix = location }
                    if let pending = self.latestBackgroundFix {
                        self.noteBackgroundFix(pending, heartbeatClock: heartbeat && pending === location)
                    }
                }
                return
            }
            self.patchLocation(
                url: url,
                anonKey: anon,
                token: token,
                rowId: rowId,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                recordedAt: recordedAt,
                allowRefresh: true,
                epoch: epoch,
                heartbeat: heartbeat
            )
        }
    }

    private func patchLocation(
        url: String,
        anonKey: String,
        token: String,
        rowId: String,
        latitude: Double,
        longitude: Double,
        recordedAt: String,
        allowRefresh: Bool,
        epoch: Int,
        heartbeat: Bool = false
    ) {
        let stampedAt = heartbeat ? iso8601(Date()) : recordedAt
        guard let endpoint = URL(string: "\(url)/rest/v1/cleaner_location_tracking?id=eq.\(rowId)&is_active=eq.true") else {
            DispatchQueue.main.async { [weak self] in self?.finishNativeWrite(epoch: epoch, heartbeat: heartbeat) }
            return
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "PATCH"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "latitude": latitude,
            "longitude": longitude,
            "recorded_at": stampedAt,
        ])
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 && allowRefresh {
                self.accessToken(url: url, anonKey: anonKey, forceRefresh: true) { refreshed in
                    guard let refreshed else {
                        DispatchQueue.main.async { self.finishNativeWrite(epoch: epoch, retry: true, heartbeat: heartbeat) }
                        return
                    }
                    self.patchLocation(
                        url: url,
                        anonKey: anonKey,
                        token: refreshed,
                        rowId: rowId,
                        latitude: latitude,
                        longitude: longitude,
                        recordedAt: heartbeat ? self.iso8601(Date()) : recordedAt,
                        allowRefresh: false,
                        epoch: epoch,
                        heartbeat: heartbeat
                    )
                }
                return
            }
            var rows: [Any] = []
            if let data,
               let parsed = try? JSONSerialization.jsonObject(with: data),
               let list = parsed as? [Any] {
                rows = list
            }
            let closed = status == 403 || (status == 200 && rows.isEmpty)
            let failed = !closed && !(200..<300).contains(status)
            DispatchQueue.main.async {
                if closed && epoch == self.writeEpoch && self.updating {
                    let fields = self.eventFields(["reason": "closed"])
                    self.stopUpdating()
                    self.notifyListeners("timeout", data: fields, retainUntilConsumed: true)
                    return
                }
                self.finishNativeWrite(epoch: epoch, retry: failed, heartbeat: heartbeat)
            }
        }.resume()
    }

    private func finishNativeWrite(epoch: Int, retry: Bool = false, heartbeat: Bool = false) {
        guard epoch == writeEpoch else { return }
        nativeWriteInFlight = false
        if !updating { return }
        if let pending = latestBackgroundFix {
            noteBackgroundFix(pending, heartbeatClock: false)
            return
        }
        if retry, let lastSentFix {
            noteBackgroundFix(lastSentFix, heartbeatClock: heartbeat)
        }
    }

    /// Reads the supabase-js session. Refreshes only when the access token
    /// is already expired (or after a 401). Before writing the rotated
    /// session back, re-reads UserDefaults so a JS refresh that landed
    /// during the request is left in place.
    private func accessToken(url: String, anonKey: String, forceRefresh: Bool = false, completion: @escaping (String?) -> Void) {
        guard let key = authStorageKey(url) else {
            completion(nil)
            return
        }
        let defaultsKey = "CapacitorStorage." + key
        guard let raw = UserDefaults.standard.string(forKey: defaultsKey),
              let data = raw.data(using: .utf8),
              let session = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let current = session["access_token"] as? String,
              !current.isEmpty else {
            completion(nil)
            return
        }
        let expires = numeric(session["expires_at"])
        if !forceRefresh && expires > Date().timeIntervalSince1970 {
            completion(current)
            return
        }
        guard let refresh = session["refresh_token"] as? String, !refresh.isEmpty,
              let endpoint = URL(string: "\(url)/auth/v1/token?grant_type=refresh_token") else {
            completion(forceRefresh ? nil : current)
            return
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let data, (200..<300).contains(status),
                  let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let next = body["access_token"] as? String else {
                completion(forceRefresh ? nil : current)
                return
            }
            self.storeRefreshedSession(defaultsKey: defaultsKey, startedRefresh: refresh, body: body, next: next, completion: completion)
        }.resume()
    }

    /// Writes the rotated session only when storage still holds the refresh
    /// token this request used. A different token means JavaScript already
    /// wrote a newer session.
    private func storeRefreshedSession(
        defaultsKey: String,
        startedRefresh: String,
        body: [String: Any],
        next: String,
        completion: @escaping (String?) -> Void
    ) {
        let apply = {
            guard let latestRaw = UserDefaults.standard.string(forKey: defaultsKey),
                  let latestData = latestRaw.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: latestData) as? [String: Any] else {
                completion(next)
                return
            }
            if (parsed["refresh_token"] as? String) != startedRefresh {
                let latestAccess = parsed["access_token"] as? String
                completion((latestAccess?.isEmpty == false) ? latestAccess : next)
                return
            }
            var latest = parsed
            latest["access_token"] = next
            if let rotated = body["refresh_token"] { latest["refresh_token"] = rotated }
            if let expiresAt = body["expires_at"] { latest["expires_at"] = expiresAt }
            if let expiresIn = body["expires_in"] { latest["expires_in"] = expiresIn }
            if let tokenType = body["token_type"] { latest["token_type"] = tokenType }
            if let user = body["user"] { latest["user"] = user }
            if let saved = try? JSONSerialization.data(withJSONObject: latest),
               let text = String(data: saved, encoding: .utf8) {
                UserDefaults.standard.set(text, forKey: defaultsKey)
            }
            completion(next)
        }
        if Thread.isMainThread {
            apply()
        } else {
            DispatchQueue.main.sync(execute: apply)
        }
    }

    private func authStorageKey(_ url: String) -> String? {
        guard let host = URL(string: url)?.host else { return nil }
        let ref = host.split(separator: ".").first.map(String.init) ?? ""
        guard !ref.isEmpty else { return nil }
        return "sb-\(ref)-auth-token"
    }

    private func isTrackingRowId(_ id: String) -> Bool {
        id.range(of: #"^[0-9a-fA-F-]{36}$"#, options: .regularExpression) != nil
    }

    private func numeric(_ value: Any?) -> TimeInterval {
        if let number = value as? NSNumber { return number.doubleValue }
        return 0
    }

    private func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// Parked trips stop producing movement fixes. Rewrite `recorded_at`
    /// from the last known point so the 15 minute reaper does not close
    /// a trip that is still active. The location background mode keeps
    /// this process runnable while the watcher is started.
    private func scheduleHeartbeat() {
        heartbeatTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.sendHeartbeat()
        }
        heartbeatTimer = work
        DispatchQueue.main.asyncAfter(wallDeadline: DispatchWallTime.now() + heartbeatInterval, execute: work)
    }

    private func sendHeartbeat() {
        guard updating else { return }
        if let tripDeadline, Date() >= tripDeadline {
            stopForDeadline()
            return
        }
        if !nativeWriteInFlight, let location = lastKnownFix {
            writeCoordinate(location, recordedAt: iso8601(Date()), heartbeat: true)
        }
        // A stop during the write cancels the timer. Don't schedule a new one.
        guard updating else { return }
        scheduleHeartbeat()
    }

    private func writeCoordinate(_ location: CLLocation, recordedAt: String, heartbeat: Bool) {
        guard updating, !nativeWriteInFlight else { return }
        guard let rowId = trackingRowId, isTrackingRowId(rowId),
              let url = supabaseUrl, let anon = supabaseAnonKey else { return }
        lastSentFix = location
        lastNativeWriteAt = Date()
        nativeWriteInFlight = true
        let epoch = writeEpoch
        let stampedAt = heartbeat ? iso8601(Date()) : recordedAt
        accessToken(url: url, anonKey: anon) { [weak self] token in
            guard let self else { return }
            guard let token else {
                DispatchQueue.main.async {
                    guard epoch == self.writeEpoch else { return }
                    self.nativeWriteInFlight = false
                    if let newer = self.latestBackgroundFix {
                        self.noteBackgroundFix(newer, heartbeatClock: false)
                    } else {
                        self.noteBackgroundFix(location, heartbeatClock: heartbeat)
                    }
                }
                return
            }
            self.patchLocation(
                url: url,
                anonKey: anon,
                token: token,
                rowId: rowId,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                recordedAt: stampedAt,
                allowRefresh: true,
                epoch: epoch,
                heartbeat: heartbeat
            )
        }
    }

    /// The WebView cannot send the arrival text while the phone is locked.
    /// The watcher and the tracking row stay up until `send-arrival-sms`
    /// succeeds. A failed send does not write arrived_at or set is_active
    /// false, and it does not clear the JS `started` flag, so the trip can
    /// keep sharing. The function claims the reminder row first, so a JS
    /// retry cannot text the customer twice.
    private func handleArrival(_ location: CLLocation) {
        guard updating, !arrivalInFlight else { return }
        if let arrivalRetryNotBefore, Date() < arrivalRetryNotBefore { return }
        let rowId = trackingRowId
        let url = supabaseUrl
        let anon = supabaseAnonKey
        let booking = bookingId
        let staff = staffId
        let epoch = watchEpoch
        let latitude = location.coordinate.latitude
        let longitude = location.coordinate.longitude
        arrivalInFlight = true
        guard let rowId, isTrackingRowId(rowId), let url, let anon else {
            failArrival(epoch: epoch, trackingId: rowId ?? "")
            return
        }
        accessToken(url: url, anonKey: anon) { [weak self] token in
            guard let self else { return }
            guard let token else {
                DispatchQueue.main.async {
                    guard epoch == self.watchEpoch else { return }
                    self.failArrival(epoch: epoch, trackingId: rowId)
                }
                return
            }
            guard let booking, let staff, self.isTrackingRowId(booking), self.isTrackingRowId(staff) else {
                DispatchQueue.main.async {
                    guard epoch == self.watchEpoch else { return }
                    self.failArrival(epoch: epoch, trackingId: rowId)
                }
                return
            }
            self.sendArrivalSms(url: url, anonKey: anon, token: token, bookingId: booking, staffId: staff) { sent in
                DispatchQueue.main.async {
                    guard epoch == self.watchEpoch else { return }
                    if sent && self.updating {
                        let recordedAt = self.iso8601(Date())
                        self.stopUpdating()
                        self.patchArrival(
                            url: url,
                            anonKey: anon,
                            token: token,
                            rowId: rowId,
                            latitude: latitude,
                            longitude: longitude,
                            recordedAt: recordedAt,
                            allowRefresh: true
                        )
                        self.emitArrival(epoch: epoch, trackingId: rowId, sms: "sent", watcher: "stopped")
                        return
                    }
                    guard self.updating else {
                        self.arrivalInFlight = false
                        return
                    }
                    self.failArrival(epoch: epoch, trackingId: rowId)
                }
            }
        }
    }

    /// Sharing stays on. The watcher is still running, so JS must not clear `started`.
    private func failArrival(epoch: Int, trackingId: String) {
        arrivalInFlight = false
        arrivalRetryNotBefore = Date().addingTimeInterval(arrivalRetryDelay)
        emitArrival(epoch: epoch, trackingId: trackingId, sms: "failed", watcher: "running")
    }

    private func patchArrival(
        url: String,
        anonKey: String,
        token: String,
        rowId: String,
        latitude: Double,
        longitude: Double,
        recordedAt: String,
        allowRefresh: Bool
    ) {
        guard let endpoint = URL(string: "\(url)/rest/v1/cleaner_location_tracking?id=eq.\(rowId)&is_active=eq.true") else {
            return
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "PATCH"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "recorded_at": recordedAt,
            "arrived_at": recordedAt,
            "is_active": false,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 401, allowRefresh, let self else { return }
            self.accessToken(url: url, anonKey: anonKey, forceRefresh: true) { refreshed in
                guard let refreshed else { return }
                self.patchArrival(
                    url: url,
                    anonKey: anonKey,
                    token: refreshed,
                    rowId: rowId,
                    latitude: latitude,
                    longitude: longitude,
                    recordedAt: recordedAt,
                    allowRefresh: false
                )
            }
        }.resume()
    }

    private func sendArrivalSms(
        url: String,
        anonKey: String,
        token: String,
        bookingId: String,
        staffId: String,
        allowRefresh: Bool = true,
        completion: @escaping (Bool) -> Void
    ) {
        guard let endpoint = URL(string: "\(url)/functions/v1/send-arrival-sms") else {
            completion(false)
            return
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "bookingId": bookingId,
            "staffId": staffId,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401 && allowRefresh {
                guard let self else {
                    completion(false)
                    return
                }
                self.accessToken(url: url, anonKey: anonKey, forceRefresh: true) { refreshed in
                    guard let refreshed else {
                        completion(false)
                        return
                    }
                    self.sendArrivalSms(
                        url: url,
                        anonKey: anonKey,
                        token: refreshed,
                        bookingId: bookingId,
                        staffId: staffId,
                        allowRefresh: false,
                        completion: completion
                    )
                }
                return
            }
            var success = false
            if let data,
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let flag = parsed["success"] as? Bool {
                success = flag
            }
            // A 2xx body with success false (or no body) did not send.
            // Stopping the trip on that response would end sharing early.
            completion((200..<300).contains(status) && success)
        }.resume()
    }

    private func emitArrival(epoch: Int, trackingId: String, sms: String, watcher: String) {
        let data: [String: Any] = [
            "reason": "arrived",
            "sms": sms,
            "watcher": watcher,
            "epoch": epoch,
            "trackingId": trackingId,
        ]
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("arrival", data: data, retainUntilConsumed: true)
        }
    }

    private func eventFields(_ fields: [String: Any]) -> [String: Any] {
        var data = fields
        data["epoch"] = watchEpoch
        if let trackingRowId {
            data["trackingId"] = trackingRowId
        }
        return data
    }

    deinit {
        tripTimeout?.cancel()
        nativeWriteTimer?.cancel()
        heartbeatTimer?.cancel()
        removeAuthObservers()
        endDeliveryTask()
    }
}
