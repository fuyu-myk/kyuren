import Foundation

/// A palm the detector found, in the detector square's own coordinates from zero to one: where
/// its box is and seven points on it, of which the first is the wrist and the third the middle
/// finger's knuckle. Those two say which way the hand is turned.
public struct Palm: Sendable, Equatable {
    public let score: Double
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public let keypoints: [Joint]
}

public let PALM_KEYPOINTS = 7
public let PALM_VALUES = 18

/// How sure the detector must be to be believed, and how much two of its boxes must overlap to
/// be the same hand. A score is clipped before it is squashed, because the model can say minus
/// several hundred and the exponent of that is not a number worth having.
private let LEAST = 0.5
private let SAME = 0.3
private let CLIP = 100.0

func sigmoid(_ x: Double) -> Double {
    1 / (1 + exp(-x))
}

private func decoded(_ boxes: [Float], at index: Int, from anchor: Anchor, score: Double) -> Palm {
    let base = index * PALM_VALUES
    let side = Double(DETECTOR_SIDE)
    let keypoints = (0..<PALM_KEYPOINTS).map { which in
        Joint(
            x: Double(boxes[base + 4 + which * 2]) / side + anchor.x,
            y: Double(boxes[base + 5 + which * 2]) / side + anchor.y
        )
    }
    return Palm(
        score: score,
        x: Double(boxes[base]) / side + anchor.x,
        y: Double(boxes[base + 1]) / side + anchor.y,
        width: Double(boxes[base + 2]) / side,
        height: Double(boxes[base + 3]) / side,
        keypoints: keypoints
    )
}

private func overlap(_ one: Palm, _ other: Palm) -> Double {
    let left = max(one.x - one.width / 2, other.x - other.width / 2)
    let right = min(one.x + one.width / 2, other.x + other.width / 2)
    let top = max(one.y - one.height / 2, other.y - other.height / 2)
    let bottom = min(one.y + one.height / 2, other.y + other.height / 2)
    let shared = max(0, right - left) * max(0, bottom - top)
    let joined = one.width * one.height + other.width * other.height - shared
    return joined > 0 ? shared / joined : 0
}

/// The palms worth keeping out of everything the detector proposed, surest first and at most
/// this many. Proposals that overlap a kept palm are the same hand seen from neighbouring
/// anchors, so they are averaged into it by how sure each was rather than thrown away; what is
/// left once a hand's proposals are gone is another hand, if it is sure enough.
public func palmsIn(boxes: [Float], scores: [Float], anchors: [Anchor], most: Int) -> [Palm] {
    guard boxes.count == anchors.count * PALM_VALUES, scores.count == anchors.count else {
        return []
    }

    var proposed: [Palm] = []
    for (index, anchor) in anchors.enumerated() {
        let score = sigmoid(min(CLIP, max(-CLIP, Double(scores[index]))))
        if score >= LEAST {
            proposed.append(decoded(boxes, at: index, from: anchor, score: score))
        }
    }

    var kept: [Palm] = []
    while kept.count < most, let surest = proposed.max(by: { $0.score < $1.score }) {
        let same = proposed.filter { overlap($0, surest) > SAME }
        proposed.removeAll { overlap($0, surest) > SAME }
        let weight = same.reduce(0) { $0 + $1.score }
        func mean(_ of: (Palm) -> Double) -> Double {
            same.reduce(0) { $0 + of($1) * $1.score } / weight
        }
        kept.append(Palm(
            score: surest.score,
            x: mean { $0.x },
            y: mean { $0.y },
            width: mean { $0.width },
            height: mean { $0.height },
            keypoints: (0..<PALM_KEYPOINTS).map { which in
                Joint(x: mean { $0.keypoints[which].x }, y: mean { $0.keypoints[which].y })
            }
        ))
    }
    return kept
}

/// The one palm worth keeping, if any.
public func palmIn(boxes: [Float], scores: [Float], anchors: [Anchor]) -> Palm? {
    palmsIn(boxes: boxes, scores: scores, anchors: anchors, most: 1).first
}
