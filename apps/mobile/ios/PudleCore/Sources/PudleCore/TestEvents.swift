import Foundation

/// Synthetic, labeled events for demonstrating the alert lifecycle. They are spoken
/// with "test alert ... not a real report" and never sent to the backend as real reports.
public enum TestEvents {
    public static func make(kind: HazardKind = .debris, now: Date, lifetime: TimeInterval = 120,
                            location: HazardLocation? = nil, id: String = UUID().uuidString) -> HazardEvent {
        HazardEvent(id: id, kind: kind, source: .labeledTest, createdAt: now,
                    expiresAt: now.addingTimeInterval(lifetime), location: location)
    }

    /// A point `meters` along `course` from a fix, for test fixtures and demo replay.
    public static func offset(latitude: Double, longitude: Double, meters: Double, bearingDegrees: Double) -> (Double, Double) {
        let r = Geo.earthRadius
        let d = meters / r
        let b = bearingDegrees * .pi / 180
        let p1 = latitude * .pi / 180, l1 = longitude * .pi / 180
        let p2 = asin(sin(p1) * cos(d) + cos(p1) * sin(d) * cos(b))
        let l2 = l1 + atan2(sin(b) * sin(d) * cos(p1), cos(d) - sin(p1) * sin(p2))
        return (p2 * 180 / .pi, l2 * 180 / .pi)
    }
}
