import Foundation
import MapKit
import UIKit

/// A saved place (destination or reviewed detour waypoint). Stored on this phone only.
struct SavedPlace: Codable, Equatable {
    var name: String
    var latitude: Double
    var longitude: Double

    var coordinateString: String { String(format: "%.6f,%.6f", locale: Locale(identifier: "en_US_POSIX"), latitude, longitude) }
}

/// Hands directions to Google Maps. iOS does not let one app change another app's active route,
/// so Pudle opens Google Maps with the destination and the reviewed detour waypoint, and Google
/// Maps computes its own route through that waypoint.
@MainActor
enum DetourService {
    static func search(_ query: String, near: CLLocationCoordinate2D?) async -> [SavedPlace] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        if let near {
            request.region = MKCoordinateRegion(center: near, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
        }
        guard let response = try? await MKLocalSearch(request: request).start() else { return [] }
        return response.mapItems.prefix(6).map { item in
            let coordinate = item.placemark.coordinate
            return SavedPlace(name: item.name ?? "Place", latitude: coordinate.latitude, longitude: coordinate.longitude)
        }
    }

    /// Directions URL. Prefers the Google Maps app scheme; falls back to the universal link.
    static func directionsURL(destination: SavedPlace, via waypoint: SavedPlace?) -> URL? {
        var components = URLComponents(string: "https://www.google.com/maps/dir/")!
        components.queryItems = [
            URLQueryItem(name: "api", value: "1"),
            URLQueryItem(name: "destination", value: destination.coordinateString),
            URLQueryItem(name: "travelmode", value: "driving"),
            URLQueryItem(name: "dir_action", value: "navigate"),
        ] + (waypoint.map { [URLQueryItem(name: "waypoints", value: $0.coordinateString)] } ?? [])
        return components.url
    }

    static func open(destination: SavedPlace, via waypoint: SavedPlace?) -> Bool {
        guard let url = directionsURL(destination: destination, via: waypoint) else { return false }
        UIApplication.shared.open(url)
        return true
    }
}
