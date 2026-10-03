import Foundation

public struct Tracked: Sendable, Equatable {
    public let at: Joint
    public let skeleton: [Joint]
    public let grip: Grip
    public let pinch: Double
}

public enum Sighting: Sendable, Equatable {
    case hand(Tracked)
    case lost
    case nothing
}

/// How much of a new position is believed at once. The tracker finds the joints again from
/// scratch every frame, so an unsteadied point shakes by a few pixels even when the hand is still.
private let BELIEVE = 0.35
/// Frames a hand may go unfound before it counts as gone, which is about half a second of camera.
///
/// A hand in a real room is found in well under half the frames it is in: it turns edge on, it
/// blurs as it moves, and the light is whatever the light is. Measured at thirty frames a second,
/// the gap between one sighting and the next is commonly a fifth of a second, so being impatient
/// here means letting go of a node between almost every pair of sightings.
private let PATIENCE = 18

/// What the camera keeps seeing, turned into what is happening: one steadied point, one grip that
/// survives a frame of doubt, and one report when the hand has actually gone.
public final class Tracker: @unchecked Sendable {
    private var was: Grip = .unsure
    private var steadied: Tracked?
    private var missing = 0
    private var here = false

    public init() {}

    public func saw(_ hand: Hand?) -> Sighting {
        guard let hand else {
            guard here else { return .nothing }
            missing += 1
            if missing < PATIENCE { return .nothing }
            forget()
            return .lost
        }

        let gap = missing
        missing = 0
        here = true
        let reading = read(hand, was: was)
        was = reading.grip

        // Believing a fixed fraction of each sighting steadies a hand that is found every frame and
        // strands one that is not: after a gap the cursor would crawl towards a hand that is
        // already somewhere else. Owed frames are repaid the way they were lost, compounded, so a
        // long gap nearly catches up and a single missed frame barely changes anything.
        let trust = 1 - pow(1 - BELIEVE, Double(gap + 1))
        func eased(_ from: Joint?, _ to: Joint) -> Joint {
            guard let from else { return to }
            return Joint(x: from.x + (to.x - from.x) * trust, y: from.y + (to.y - from.y) * trust)
        }
        let before = steadied?.skeleton ?? []
        let seen = Tracked(
            at: eased(steadied?.at, reading.at),
            skeleton: reading.skeleton.enumerated().map { which, joint in
                eased(which < before.count ? before[which] : nil, joint)
            },
            grip: reading.grip,
            pinch: reading.pinch
        )
        steadied = seen
        return .hand(seen)
    }

    public func forget() {
        was = .unsure
        steadied = nil
        missing = 0
        here = false
    }
}
