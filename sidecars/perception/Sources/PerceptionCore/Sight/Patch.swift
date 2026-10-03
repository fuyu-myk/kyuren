import Foundation

/// A square of the frame, in pixels: where its middle is, how wide it is and how far it is turned.
/// Everything a model looks at is one of these, and everything a model says is in one's own
/// coordinates until it is projected back out into the frame.
public struct Patch: Sendable, Equatable {
    public let x: Double
    public let y: Double
    public let side: Double
    public let turn: Double

    public init(x: Double, y: Double, side: Double, turn: Double) {
        self.x = x
        self.y = y
        self.side = side
        self.turn = turn
    }
}

/// The whole frame, squared off so that none of it is cut away. What the detector looks at.
public func wholeOf(width: Int, height: Int) -> Patch {
    Patch(x: Double(width) / 2, y: Double(height) / 2, side: Double(max(width, height)), turn: 0)
}

/// Where a point in a patch's own coordinates, zero to one across it, falls in the frame.
public func project(_ point: Joint, from patch: Patch) -> Joint {
    let dx = (point.x - 0.5) * patch.side
    let dy = (point.y - 0.5) * patch.side
    let c = cos(patch.turn)
    let s = sin(patch.turn)
    return Joint(x: patch.x + dx * c - dy * s, y: patch.y + dx * s + dy * c)
}

func wrapped(_ angle: Double) -> Double {
    angle - 2 * .pi * floor((angle + .pi) / (2 * .pi))
}

/// How far a hand is turned from upright, given its wrist and the place its fingers grow from.
/// Upright is fingers pointing up the frame, which is the only way the landmark model has seen
/// a hand, so every patch is turned to show it one that way.
func turnOf(wrist: Joint, toward knuckles: Joint) -> Double {
    wrapped(.pi / 2 - atan2(-(knuckles.y - wrist.y), knuckles.x - wrist.x))
}

/// A square around a box: turned with the hand, moved along the hand by a fraction of the box's
/// height, then grown. Moving happens before growing, so the fraction is of the box and not of
/// the square that ends up around it.
private func around(
    x: Double,
    y: Double,
    width: Double,
    height: Double,
    turn: Double,
    shift: Double,
    grown: Double
) -> Patch {
    Patch(
        x: x - height * shift * sin(turn),
        y: y + height * shift * cos(turn),
        side: max(width, height) * grown,
        turn: turn
    )
}

/// Where the landmark model should look, given a palm. The detector finds only the palm, so the
/// square that holds the whole hand sits well up from it and is much larger than it.
public func patchAround(_ palm: Palm, in whole: Patch) -> Patch {
    let middle = project(Joint(x: palm.x, y: palm.y), from: whole)
    let wrist = project(palm.keypoints[0], from: whole)
    let knuckle = project(palm.keypoints[2], from: whole)
    return around(
        x: middle.x,
        y: middle.y,
        width: palm.width * whole.side,
        height: palm.height * whole.side,
        turn: turnOf(wrist: wrist, toward: knuckle),
        shift: -0.5,
        grown: 2.6
    )
}

/// The joints that stay put while the fingers move: the wrist, the base of the thumb, and the two
/// joints at the base of each finger. A box around these hardly changes as a hand opens and
/// closes, so the next patch does not lurch when the fingers do.
private let STEADY = [0, 1, 2, 3, 5, 6, 9, 10, 13, 14, 17, 18]

/// Where the landmark model should look next, given the hand it just found, in pixels. The box
/// is measured with the hand turned upright, so a tilted hand gets a snug box rather than the
/// loose one its tilted corners would give.
public func patchAround(landmarks: [Joint]) -> Patch {
    let wrist = landmarks[0]
    let across = Joint(
        x: ((landmarks[5].x + landmarks[13].x) / 2 + landmarks[9].x) / 2,
        y: ((landmarks[5].y + landmarks[13].y) / 2 + landmarks[9].y) / 2
    )
    let turn = turnOf(wrist: wrist, toward: across)

    let steady = STEADY.map { landmarks[$0] }
    let xs = steady.map(\.x)
    let ys = steady.map(\.y)
    let middleX = (xs.min()! + xs.max()!) / 2
    let middleY = (ys.min()! + ys.max()!) / 2

    let c = cos(turn)
    let s = sin(turn)
    let upright = steady.map { point -> (x: Double, y: Double) in
        let dx = point.x - middleX
        let dy = point.y - middleY
        return (dx * c + dy * s, -dx * s + dy * c)
    }
    let ux = upright.map(\.x)
    let uy = upright.map(\.y)
    let px = (ux.min()! + ux.max()!) / 2
    let py = (uy.min()! + uy.max()!) / 2

    return around(
        x: px * c - py * s + middleX,
        y: px * s + py * c + middleY,
        width: ux.max()! - ux.min()!,
        height: uy.max()! - uy.min()!,
        turn: turn,
        shift: -0.1,
        grown: 2.0
    )
}
