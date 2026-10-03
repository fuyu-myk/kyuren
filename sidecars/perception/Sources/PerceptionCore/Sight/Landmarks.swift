import Foundation

public let LANDMARKS = 21
public let LANDMARK_SIDE = 224

/// What the landmark model said: where each of the twenty one points is across the patch it was
/// shown, zero to one, and how sure it is that it was shown a hand at all.
public struct Landmarked: Sendable, Equatable {
    public let points: [Joint]
    public let presence: Double
}

public func landmarksFrom(_ raw: [Float], presence: Float) -> Landmarked? {
    guard raw.count >= LANDMARKS * 3 else { return nil }
    let side = Double(LANDMARK_SIDE)
    let points = (0..<LANDMARKS).map { which in
        Joint(x: Double(raw[which * 3]) / side, y: Double(raw[which * 3 + 1]) / side)
    }
    return Landmarked(points: points, presence: Double(presence))
}
