import CoreLocation
import PudleCore

/// Driving-session location. Runs only between Start drive and Stop drive.
///
/// Why background location is justified: Pudle uses each fix on-device to decide
/// whether a located hazard report is on the driver's heading (RoadRelevance). Started
/// in the foreground with When-In-Use permission plus the `location` background mode
/// and a CLBackgroundActivitySession, iOS keeps delivering updates while Google Maps
/// is in front and shows the blue location indicator. Fixes are never uploaded or
/// stored; only the latest one is kept in memory.
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var backgroundSession: CLBackgroundActivitySession?
    private(set) var isUpdating = false

    var onAccessChange: ((LocationAccess) -> Void)?
    var onFix: ((ReceiverFix) -> Void)?
    var onError: ((String) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        // An explicit drive should not silently pause: a paused manager lets iOS suspend
        // Pudle mid-drive, which would silently stop alerts. Stop drive ends updates.
        manager.pausesLocationUpdatesAutomatically = false
    }

    var access: LocationAccess { Self.map(manager.authorizationStatus) }

    var canRunInBackground: Bool {
        isUpdating && (access == .whenInUse || access == .always)
    }

    func requestAccessIfNeeded() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
    }

    func start() {
        requestAccessIfNeeded()
        guard access == .whenInUse || access == .always else {
            isUpdating = false
            return
        }
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        if backgroundSession == nil {
            backgroundSession = CLBackgroundActivitySession()
        }
        manager.startUpdatingLocation()
        isUpdating = true
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        backgroundSession?.invalidate()
        backgroundSession = nil
        isUpdating = false
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            let mapped = Self.map(status)
            if (mapped == .denied || mapped == .restricted) && self.isUpdating { self.stop() }
            self.onAccessChange?(mapped)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        let fix = ReceiverFix(latitude: last.coordinate.latitude, longitude: last.coordinate.longitude,
                              accuracyMeters: last.horizontalAccuracy,
                              courseDegrees: last.course >= 0 ? last.course : nil,
                              speedMetersPerSecond: last.speed >= 0 ? last.speed : nil,
                              timestamp: last.timestamp)
        Task { @MainActor in self.onFix?(fix) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = (error as? CLError)?.code == .denied ? "Location denied" : "Location unavailable"
        Task { @MainActor in self.onError?(message) }
    }

    static func map(_ status: CLAuthorizationStatus) -> LocationAccess {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .restricted: return .restricted
        case .authorizedWhenInUse: return .whenInUse
        case .authorizedAlways: return .always
        @unknown default: return .denied
        }
    }
}
