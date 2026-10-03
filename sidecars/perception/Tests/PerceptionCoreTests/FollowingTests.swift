import Testing

@testable import PerceptionCore

@Suite("Following")
struct FollowingTests {
    private func hand(at x: Double, _ y: Double) -> Hand {
        Hand(
            wrist: Joint(x: x, y: y),
            knuckle: Joint(x: x, y: y + 0.20),
            thumb: Joint(x: x - 0.15, y: y + 0.22),
            index: Joint(x: x, y: y + 0.30),
            middle: Joint(x: x, y: y + 0.36),
            ring: Joint(x: x + 0.06, y: y + 0.33),
            little: Joint(x: x + 0.11, y: y + 0.28)
        )
    }

    @Test("the first hand seen aims, and a second is the other, whatever order they were found in")
    func theFirstHandSeenAimsAndASecondIsTheOther() {
        let following = Following()
        let alone = following.saw([hand(at: 0.3, 0.2)])
        guard case .hand(let first) = alone.primary else {
            Issue.record("no hand aims")
            return
        }
        #expect(alone.other == nil)

        let both = following.saw([hand(at: 0.7, 0.2), hand(at: 0.3, 0.2)])
        guard case .hand(let still) = both.primary else {
            Issue.record("no hand aims")
            return
        }
        #expect(abs(still.at.x - first.at.x) < 0.05, "the aiming hand stays the aiming hand")
        #expect((both.other?.at.x ?? 0) > 0.5, "the newcomer is the other")
    }

    @Test("when the aiming hand goes and the other stays, the other aims and nothing is lost")
    func whenTheAimingHandGoesTheOtherAims() {
        let following = Following()
        _ = following.saw([hand(at: 0.3, 0.2), hand(at: 0.7, 0.2)])
        var losses = 0
        var last: Seen?
        for _ in 0..<40 {
            let seen = following.saw([hand(at: 0.7, 0.2)])
            if case .lost = seen.primary { losses += 1 }
            last = seen
        }
        guard case .hand(let aiming) = last?.primary else {
            Issue.record("no hand aims")
            return
        }
        #expect(aiming.at.x > 0.5)
        #expect(last?.other == nil)
        #expect(losses == 0)
    }

    @Test("both hands gone is one loss, reported once")
    func bothHandsGoneIsOneLossReportedOnce() {
        let following = Following()
        _ = following.saw([hand(at: 0.3, 0.2), hand(at: 0.7, 0.2)])
        var losses = 0
        for _ in 0..<40 {
            if case .lost = following.saw([]).primary { losses += 1 }
        }
        #expect(losses == 1)
    }
}
