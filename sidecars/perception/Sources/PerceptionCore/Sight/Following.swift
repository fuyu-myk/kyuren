import Foundation

/// What the camera keeps seeing, as hands: the one that aims and, when there is one, the other.
public struct Seen: Sendable, Equatable {
    public let primary: Sighting
    public let other: Tracked?
}

/// Two hands followed as two, each steadied by a tracker of its own. Hands arrive in whatever
/// order they were found, so each is matched to the tracker whose hand was nearest last time,
/// closest pairs first. The first hand seen aims; if it goes while the other stays, the other
/// takes its place, so the cursor does not die with a hand still in view.
public final class Following {
    private var trackers = [Tracker(), Tracker()]
    private var wrists: [Joint?] = [nil, nil]

    public init() {}

    public func saw(_ hands: [Hand]) -> Seen {
        let assigned = assign(hands)
        var sightings = (0..<2).map { trackers[$0].saw(assigned[$0]) }
        for slot in 0..<2 {
            if let hand = assigned[slot] {
                wrists[slot] = hand.wrist
            } else if sightings[slot] == .lost {
                wrists[slot] = nil
            }
        }

        if wrists[0] == nil, wrists[1] != nil {
            trackers.swapAt(0, 1)
            wrists.swapAt(0, 1)
            sightings.swapAt(0, 1)
            // The hand that went is not a loss to report: a hand is still in view.
            if sightings[1] == .lost { sightings[1] = .nothing }
        }

        let other: Tracked?
        if case .hand(let seen) = sightings[1] { other = seen } else { other = nil }
        return Seen(primary: sightings[0], other: other)
    }

    public func forget() {
        for tracker in trackers { tracker.forget() }
        wrists = [nil, nil]
    }

    private func assign(_ hands: [Hand]) -> [Hand?] {
        var assigned: [Hand?] = [nil, nil]
        var pairs: [(slot: Int, at: Int, apart: Double)] = []
        for slot in 0..<2 {
            guard let was = wrists[slot] else { continue }
            for (at, hand) in hands.enumerated() {
                pairs.append((slot, at, apart(was, hand.wrist)))
            }
        }

        var handsTaken = Set<Int>()
        var slotsTaken = Set<Int>()
        for pair in pairs.sorted(by: { $0.apart < $1.apart })
        where !handsTaken.contains(pair.at) && !slotsTaken.contains(pair.slot) {
            assigned[pair.slot] = hands[pair.at]
            handsTaken.insert(pair.at)
            slotsTaken.insert(pair.slot)
        }
        for (at, hand) in hands.enumerated() where !handsTaken.contains(at) {
            guard let slot = (0..<2).first(where: { !slotsTaken.contains($0) }) else { break }
            assigned[slot] = hand
            slotsTaken.insert(slot)
        }
        return assigned
    }
}
