// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Perception",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "kyuren-perception", targets: ["kyuren-perception"])
    ],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.15.7"),
        .package(url: "https://github.com/microsoft/onnxruntime-swift-package-manager.git", exact: "1.24.2")
    ],
    targets: [
        .target(
            name: "PerceptionCore",
            dependencies: [
                .product(name: "FluidAudio", package: "FluidAudio"),
                .product(name: "onnxruntime", package: "onnxruntime-swift-package-manager"),
            ],
            resources: [.copy("Sight/Models"), .copy("Audio/Hearing")]
        ),
        .executableTarget(name: "kyuren-perception", dependencies: ["PerceptionCore"]),
        .testTarget(
            name: "PerceptionCoreTests",
            dependencies: ["PerceptionCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
