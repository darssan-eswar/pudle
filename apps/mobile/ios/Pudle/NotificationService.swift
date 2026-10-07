import UserNotifications

/// Local notifications provide the system-UI controls (Mute / Stop drive) while another
/// app is in front, and a visible fallback when speech could not play. They are local
/// only: no push credentials are involved, and they don't keep Pudle running.
@MainActor
final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let category = "PUDLE_DRIVE"
    static let muteAction = "PUDLE_MUTE"
    static let stopAction = "PUDLE_STOP"
    static let blockageCategory = "PUDLE_BLOCKAGE"
    static let rerouteAction = "PUDLE_REROUTE"
    private static let sessionID = "pudle.drive.session"

    private let center = UNUserNotificationCenter.current()
    var onMute: (() -> Void)?
    var onStop: (() -> Void)?
    var onReroute: (() -> Void)?
    private(set) var allowed = false

    override init() {
        super.init()
        center.delegate = self
        let mute = UNNotificationAction(identifier: Self.muteAction, title: "Mute Pudle", options: [])
        let stop = UNNotificationAction(identifier: Self.stopAction, title: "Stop drive", options: [.destructive])
        // Opening another app from the background is not allowed on iOS, so rerouting takes one tap:
        // the action brings Pudle forward, which then hands the detour to Google Maps.
        let reroute = UNNotificationAction(identifier: Self.rerouteAction, title: "Reroute in Google Maps", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.category, actions: [mute, stop], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Self.blockageCategory, actions: [reroute, mute], intentIdentifiers: [], options: []),
        ])
    }

    func requestPermission() async -> Bool {
        do {
            allowed = try await center.requestAuthorization(options: [.alert, .sound])
        } catch {
            allowed = false
        }
        return allowed
    }

    func refreshPermission() async {
        let settings = await center.notificationSettings()
        allowed = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    /// Shown when the user leaves Pudle during a drive: gives Mute/Stop from the
    /// notification without opening the app. Replaced, not stacked.
    func postSessionNotice(muted: Bool) {
        guard allowed else { return }
        let content = UNMutableNotificationContent()
        content.title = muted ? "Pudle drive active · muted" : "Pudle drive active"
        content.body = "Long-press for Mute or Stop drive. Reports are spoken while the blue location indicator is on."
        content.categoryIdentifier = Self.category
        content.interruptionLevel = .passive
        content.sound = nil
        center.add(UNNotificationRequest(identifier: Self.sessionID, content: content, trigger: nil))
    }

    /// Visible record of an alert. `withSound` is used only as the fallback when
    /// speech failed; normally the spoken phrase is the alert and this stays silent.
    func postAlert(title: String, body: String, withSound: Bool, blockage: Bool = false) {
        guard allowed else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.categoryIdentifier = blockage ? Self.blockageCategory : Self.category
        content.interruptionLevel = blockage ? .timeSensitive : .active
        content.sound = withSound ? .default : nil
        content.threadIdentifier = "pudle.alerts"
        center.add(UNNotificationRequest(identifier: "pudle.alert.\(UUID().uuidString)", content: content, trigger: nil))
    }

    func clearAll() {
        center.removeAllDeliveredNotifications()
        center.removeAllPendingNotificationRequests()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let action = response.actionIdentifier
        let category = response.notification.request.content.categoryIdentifier
        await MainActor.run {
            if action == Self.muteAction { self.onMute?() }
            if action == Self.stopAction { self.onStop?() }
            if action == Self.rerouteAction || (action == UNNotificationDefaultActionIdentifier
                && category == Self.blockageCategory) {
                self.onReroute?()
            }
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // Pudle is on screen: the status card already shows it, so don't add a banner.
        []
    }
}
