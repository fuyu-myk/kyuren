import Foundation

public struct Joint: Sendable, Equatable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// One hand as the tracker saw it, on the frame's own scale where x and y run zero to one, with x
/// already mirrored. Seven named joints are what a gesture is read from. The whole skeleton rides
/// along as well, because the hand is drawn for the person it belongs to and a drawn hand with
/// fingers missing is not one they can aim with.
public struct Hand: Sendable, Equatable {
    public let wrist: Joint
    public let knuckle: Joint
    public let thumb: Joint
    public let index: Joint
    public let middle: Joint
    public let ring: Joint
    public let little: Joint
    public let skeleton: [Joint]

    public init(
        wrist: Joint,
        knuckle: Joint,
        thumb: Joint,
        index: Joint,
        middle: Joint,
        ring: Joint,
        little: Joint,
        skeleton: [Joint] = []
    ) {
        self.wrist = wrist
        self.knuckle = knuckle
        self.thumb = thumb
        self.index = index
        self.middle = middle
        self.ring = ring
        self.little = little
        self.skeleton = skeleton
    }
}

func apart(_ one: Joint, _ other: Joint) -> Double {
    Double(hypot(one.x - other.x, one.y - other.y))
}

/// The palm, wrist to middle knuckle. Every other measurement is taken as a multiple of it, so a
/// hand held close to the camera reads the same as the same hand held far from it.
public func spanOf(_ hand: Hand) -> Double {
    max(apart(hand.wrist, hand.knuckle), 1e-6)
}
