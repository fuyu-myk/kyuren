import Foundation

public enum Grip: String, Sendable, Equatable {
    case pinch
    case point
    /// The index alone out of a closed hand, the thumb wherever it happens to be: the shape of a
    /// one. Told from a point by the thumb, which a point rests on the middle finger.
    case one
    case open
    case fist
    case unsure
}

public struct Reading: Sendable, Equatable {
    public let grip: Grip
    /// Where the hand is aiming. A pinch aims with the point between thumb and index, which the
    /// two converge on as they close, so it holds still while the hand commits. A point aims with
    /// the index tip, because that is the finger being pointed with. Two gestures, two fingers.
    public let at: Joint
    /// The whole hand, so it can be drawn for the person aiming it.
    public let skeleton: [Joint]
    /// How shut the pinch is, one when the fingers meet and zero once they have parted.
    public let pinch: Double
}

/// Both thresholds for each gesture: the one that starts it and the looser one that ends it. A
/// single threshold would let a hand held at the boundary give up and retake a node many times a
/// second.
private let CLOSES = 0.34
private let PARTS = 0.45
private let CURLS = 1.15
private let UNCURLS = 1.35

/// How far the index finger reaches from the wrist, in palms: enough to be pointing with, and
/// enough merely to be out of the fist. A pinch bends the finger without curling it, which is what
/// tells a pinch from a closed hand where the thumb and finger are also touching.
private let STRAIGHT = 1.45
private let BENT = 0.95

/// How far the fingers reach from the wrist, in palms. The index is left out of it: it is the
/// finger the other gestures are made with, so where it is says nothing about whether the hand is
/// closed.
private func curlOf(_ hand: Hand, over span: Double) -> Double {
    let tips = [hand.middle, hand.ring, hand.little]
    return tips.reduce(0.0) { $0 + apart(hand.wrist, $1) / span } / Double(tips.count)
}

public func read(_ hand: Hand, was: Grip) -> Reading {
    let span = spanOf(hand)
    let stretch = apart(hand.wrist, hand.index) / span
    let curl = curlOf(hand, over: span)
    // Two fingers may meet the thumb, and they mean different things: the index to take hold of
    // something, the middle to ask what it is.
    let nip = apart(hand.thumb, hand.index) / span
    let tap = apart(hand.thumb, hand.middle) / span

    let between = Joint(x: (hand.thumb.x + hand.index.x) / 2, y: (hand.thumb.y + hand.index.y) / 2)
    let shut = max(0, min(1, 1 - nip / PARTS))
    let meeting = { (which: Double, held: Bool) in which < (held ? PARTS : CLOSES) }
    let made = { (grip: Grip) in
        Reading(
            grip: grip,
            at: grip == .point || grip == .one ? hand.index : between,
            skeleton: hand.skeleton,
            pinch: shut
        )
    }

    // A pinch already held is governed by the two fingers alone. A hand dragging something relaxes
    // into a shape much like a fist, and the gate below, which only exists to stop a fist from
    // starting a pinch, must not be allowed to end one.
    if was == .pinch, meeting(nip, true) {
        return made(.pinch)
    }
    // A closed hand brings thumb and finger together too, so a pinch only begins while the finger
    // is still reaching out of the fist rather than curled into it.
    if stretch > BENT, meeting(nip, false) {
        return made(.pinch)
    }
    if stretch > STRAIGHT, meeting(tap, was == .point) {
        return made(.point)
    }
    if stretch > STRAIGHT, curl < (was == .one ? UNCURLS : CURLS) {
        return made(.one)
    }
    if stretch < BENT, curl < (was == .fist ? UNCURLS : CURLS) {
        return made(.fist)
    }
    if curl > UNCURLS {
        return made(.open)
    }

    // Nothing matched outright, so the last reading is kept while what defined it still holds.
    // A pinch whose fingers have plainly parted is over, whatever the rest of the hand is doing:
    // keeping it for any other reason is a hand that will not let go.
    let kept: Grip
    switch was {
    case .pinch: kept = meeting(nip, true) ? .pinch : .unsure
    case .point: kept = meeting(tap, true) ? .point : .unsure
    case .one: kept = stretch > BENT && curl < UNCURLS ? .one : .unsure
    case .fist: kept = .unsure
    case .open, .unsure: kept = was
    }
    return made(kept)
}
