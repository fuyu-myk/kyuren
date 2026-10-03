// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Apple",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "kyuren-apple", targets: ["kyuren-apple"])
    ],
    targets: [
        .target(name: "AppleCore"),
        .executableTarget(name: "kyuren-apple", dependencies: ["AppleCore"]),
        .testTarget(name: "AppleTests", dependencies: ["AppleCore"]),
    ]
)
