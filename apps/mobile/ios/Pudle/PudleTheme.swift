import SwiftUI

// Shared with the original web app's ivory, lilac, mint and peach palette.
enum PudleTheme {
    static let ivory = Color(red: 251/255, green: 247/255, blue: 239/255)
    static let paper = Color(red: 255/255, green: 253/255, blue: 248/255)
    static let ink = Color(red: 33/255, green: 29/255, blue: 43/255)
    static let lilac = Color(red: 220/255, green: 208/255, blue: 247/255)
    static let purple = Color(red: 108/255, green: 85/255, blue: 161/255)
    static let mint = Color(red: 217/255, green: 241/255, blue: 232/255)
    static let green = Color(red: 36/255, green: 94/255, blue: 75/255)
    static let peach = Color(red: 246/255, green: 221/255, blue: 210/255)
    static let danger = Color(red: 155/255, green: 48/255, blue: 69/255)
}

struct PudleCardStyle: GroupBoxStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            configuration.label.font(.headline).foregroundStyle(PudleTheme.ink)
            configuration.content
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PudleTheme.paper, in: RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(PudleTheme.lilac.opacity(0.5)))
    }
}
