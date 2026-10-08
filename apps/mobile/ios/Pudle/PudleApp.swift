import SwiftUI

@main
struct PudleApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            DriveView()
                .environmentObject(model)
                .tint(PudleTheme.purple)
                .fontDesign(.rounded)
                .preferredColorScheme(.light)
                .groupBoxStyle(PudleCardStyle())
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: model.appMovedToBackground()
            case .active: model.appBecameActive()
            default: break
            }
        }
    }
}
