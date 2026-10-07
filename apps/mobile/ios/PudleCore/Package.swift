// swift-tools-version:5.9
// PudleCore holds the platform-neutral driving-alert rules: event contracts,
// validation, road relevance, deterministic phrases and delivery policy.
// It has no UIKit/CoreLocation dependency so `swift test` runs on macOS or Linux.
import PackageDescription

let package = Package(
    name: "PudleCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "PudleCore", targets: ["PudleCore"]),
    ],
    targets: [
        .target(name: "PudleCore"),
        .testTarget(name: "PudleCoreTests", dependencies: ["PudleCore"]),
    ]
)
