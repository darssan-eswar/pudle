import Foundation

/// Build-time configuration injected from Config/Local.xcconfig through Info.plist.
/// Only the publishable (anon) key is ever present in the app; access is enforced by RLS.
struct AppConfig {
    let supabaseURL: URL?
    let supabaseKey: String?
    let buildCommit: String

    static let current: AppConfig = {
        let info = Bundle.main.infoDictionary ?? [:]
        let rawURL = (info["PudleSupabaseURL"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        let rawKey = (info["PudleSupabaseKey"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        let url = rawURL.hasPrefix("https://") ? URL(string: rawURL) : nil
        // A service-role key must never ship in a client. Refuse to run with one.
        let looksPrivileged = rawKey.hasPrefix("sb_secret_") || rawKey.contains("service_role")
        return AppConfig(supabaseURL: url,
                         supabaseKey: rawKey.isEmpty || looksPrivileged ? nil : rawKey,
                         buildCommit: (info["PudleBuildCommit"] as? String) ?? "unknown")
    }()

    var backendConfigured: Bool { supabaseURL != nil && supabaseKey != nil }

    var versionDescription: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build)) · \(buildCommit)"
    }
}
