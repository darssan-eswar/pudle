import CoreLocation
import PudleCore

/// Driving-session location. Runs only between Start drive and Stop drive.
///
/// Why background location is justified: Pudle uses each fix on-device to decide whether a
/// located hazard report is ahead on the driver's road (RoadRelevance). Started in the
/// foreground with When-In-Use permission plus the `location` background mode and a
/// CLBackgroundActivitySession, iOS keeps delivering updates while Google Maps is in front and
/// shows the blue location indicator. Fixes are kept in memory only (last ~30 s), never uploaded,
/// except the single position attached to a report the driver confirms, and a demo road the
/// user explicitly records.
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var backgroundSession: CLBackgroundActivitySession?
    private(set) var isUpdating = false
    private var recent: [ReceiverFix] = []

    /// Demo-road recording (explicit, user-started).
    private(set) var isRecordingRoad = false
    private(set) var recordedRoad: [RoadCorridor.Point] = []

    var onAccessChange: ((LocationAccess) -> Void)?
    var onFix: ((ReceiverFix) -> Void)?
    var onError: ((String) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        // An explicit drive should not silently pause: a paused manager lets iOS suspend Pudle
        // mid-drive, which would silently stop alerts. Stop drive ends updates.
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
        recent.removeAll()
        stopRecordingRoad()
    }

    func startRecordingRoad() {
        recordedRoad.removeAll()
        isRecordingRoad = true
    }

    @discardableResult
    func stopRecordingRoad() -> [RoadCorridor.Point] {
        isRecordingRoad = false
        return recordedRoad
    }

    func clearRecordedRoad() { recordedRoad.removeAll() }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            let mapped = Self.map(status)
            if (mapped == .denied || mapped == .restricted) && self.isUpdating { self.stop() }
            self.onAccessChange?(mapped)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let raw = locations.map {
            ReceiverFix(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude,
                        accuracyMeters: $0.horizontalAccuracy,
                        courseDegrees: $0.course >= 0 && $0.courseAccuracy >= 0 && $0.courseAccuracy < 45 ? $0.course : nil,
                        speedMetersPerSecond: $0.speed >= 0 ? $0.speed : nil,
                        timestamp: $0.timestamp)
        }
        Task { @MainActor in self.ingest(raw) }
    }

    private func ingest(_ fixes: [ReceiverFix]) {
        for var fix in fixes where fix.accuracyMeters > 0 {
            recent.append(fix)
            recent.removeAll { fix.timestamp.timeIntervalSince($0.timestamp) > 30 }
            // Slow driving: GPS course is often invalid; derive it from recent movement.
            if fix.courseDegrees == nil { fix.courseDegrees = CourseEstimator.course(from: recent) }
            if isRecordingRoad, fix.accuracyMeters <= 30 {
                let point = RoadCorridor.Point(fix.latitude, fix.longitude)
                if let last = recordedRoad.last {
                    if Geo.distance(lat1: last.latitude, lon1: last.longitude, lat2: point.latitude, lon2: point.longitude) >= 15 {
                        recordedRoad.append(point)
                    }
                } else {
                    recordedRoad.append(point)
                }
                if recordedRoad.count >= 2_000 { isRecordingRoad = false }
            }
            onFix?(fix)
        }
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
