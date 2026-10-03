import Testing

@testable import PerceptionCore

@Suite("Tracker")
struct TrackerTests {
    private func hand(at x: Double, _ y: Double, pinching: Bool = false) -> Hand {
        let lift = Joint(x: x, y: y + 0.30)
        let nip = pinching ? Joint(x: x - 0.005, y: y + 0.30) : Joint(x: x - 0.15, y: y + 0.22)
        return Hand(
            wrist: Joint(x: x, y: y),
            knuckle: Joint(x: x, y: y + 0.20),
            thumb: nip,
            index: lift,
            middle: Joint(x: x, y: y + 0.36),
            ring: Joint(x: x + 0.06, y: y + 0.33),
            little: Joint(x: x + 0.11, y: y + 0.28)
        )
    }

    @Test("the first hand seen is reported where it is")
    func theFirstHandSeenIsReportedWhereItIs() {
        let tracker = Tracker()
        guard case .hand(let seen) = tracker.saw(hand(at: 0.5, 0.25)) else {
            Issue.record("no hand reported")
            return
        }
        #expect(abs(seen.at.x - 0.425) < 0.01)
    }

    @Test("a jittering hand is steadied")
    func aJitteringHandIsSteadied() {
        let tracker = Tracker()
        _ = tracker.saw(hand(at: 0.5, 0.25))
        guard case .hand(let seen) = tracker.saw(hand(at: 0.7, 0.25)) else {
            Issue.record("no hand reported")
            return
        }
        #expect(seen.at.x > 0.425)
        #expect(seen.at.x < 0.625)
    }

    @Test("a hand gone for a moment is not lost")
    func aHandGoneForAMomentIsNotLost() {
        let tracker = Tracker()
        _ = tracker.saw(hand(at: 0.5, 0.25))
        for _ in 0..<8 { #expect(tracker.saw(nil) == .nothing) }
    }

    // A hand is found in a minority of frames, so a sighting commonly follows several misses. The
    // cursor has to arrive where the hand is rather than set off towards where it was.
    @Test("a hand found again after a gap catches up rather than crawling")
    func aHandFoundAgainAfterAGapCatchesUpRatherThanCrawling() {
        let straight = Tracker()
        _ = straight.saw(hand(at: 0.2, 0.25))
        guard case .hand(let soon) = straight.saw(hand(at: 0.8, 0.25)) else {
            Issue.record("no hand reported")
            return
        }

        let gapped = Tracker()
        _ = gapped.saw(hand(at: 0.2, 0.25))
        for _ in 0..<4 { _ = gapped.saw(nil) }
        guard case .hand(let late) = gapped.saw(hand(at: 0.8, 0.25)) else {
            Issue.record("no hand reported")
            return
        }

        let of = { (at: Double) in (at - 0.125) / (0.725 - 0.125) }
        #expect(of(late.at.x) > 0.85, "four frames owed is nearly arriving")
        #expect(of(soon.at.x) < 0.4, "no frames owed is the ordinary steadying")

        // Steadying is the point of this, so one missed frame must not switch it off.
        let barely = Tracker()
        _ = barely.saw(hand(at: 0.2, 0.25))
        _ = barely.saw(nil)
        guard case .hand(let next) = barely.saw(hand(at: 0.8, 0.25)) else {
            Issue.record("no hand reported")
            return
        }
        #expect(of(next.at.x) < 0.7, "one frame owed is not a jump to the hand")
    }

    @Test("a hand gone for good is reported lost, once")
    func aHandGoneForGoodIsReportedLostOnce() {
        let tracker = Tracker()
        _ = tracker.saw(hand(at: 0.5, 0.25))
        var sightings: [Sighting] = []
        for _ in 0..<20 { sightings.append(tracker.saw(nil)) }
        #expect(sightings.filter { $0 == .lost }.count == 1)
        #expect(sightings.last == .nothing)
    }

    @Test("nothing is reported lost before anything was seen")
    func nothingIsReportedLostBeforeAnythingWasSeen() {
        let tracker = Tracker()
        for _ in 0..<20 { #expect(tracker.saw(nil) == .nothing) }
    }

    // Steadying across a gap would drag the returning hand back towards where it used to be, which
    // reads on screen as the cursor sliding in from somewhere the hand never was.
    @Test("a hand seen again after it was lost starts where it is")
    func aHandSeenAgainAfterItWasLostStartsWhereItIs() {
        let tracker = Tracker()
        _ = tracker.saw(hand(at: 0.2, 0.25, pinching: true))
        for _ in 0..<20 { _ = tracker.saw(nil) }
        guard case .hand(let seen) = tracker.saw(hand(at: 0.8, 0.25)) else {
            Issue.record("no hand reported")
            return
        }
        #expect(abs(seen.at.x - 0.725) < 0.01)
        #expect(seen.grip == .open)
    }

    @Test("a grip carries from one frame to the next")
    func aGripCarriesFromOneFrameToTheNext() {
        let tracker = Tracker()
        _ = tracker.saw(hand(at: 0.5, 0.25, pinching: true))
        guard case .hand(let seen) = tracker.saw(hand(at: 0.5, 0.25, pinching: true)) else {
            Issue.record("no hand reported")
            return
        }
        #expect(seen.grip == .pinch)
    }
}

@Suite("Pose")
struct PoseTests {
    private func tracked(at: Joint, grip: Grip = .pinch, pinch: Double = 1) -> Tracked {
        Tracked(at: at, skeleton: [Joint(x: 0.2, y: 0.7), Joint(x: 0.3, y: 0.8)], grip: grip, pinch: pinch)
    }

    // The camera's picture is the thing this must not leak. It is looked at in this process and
    // nowhere else, so what a frame is allowed to become is worth pinning down rather than
    // trusting to review.
    @Test("a frame becomes the joints of a hand, a fraction and a word, and nothing else")
    func aFrameBecomesTheJointsOfAHandAFractionAndAWord() {
        let pose = poseOf(tracked(at: Joint(x: 0.25, y: 0.75)))
        guard case .object(let fields) = pose else {
            Issue.record("a pose is not an object")
            return
        }
        #expect(Set(fields.keys) == ["x", "y", "hand", "grip", "pinch"])
        #expect(fields["x"] == .number(0.25))
        #expect(fields["y"] == .number(0.75))
        #expect(fields["hand"] == .array([.number(0.2), .number(0.7), .number(0.3), .number(0.8)]))
        #expect(fields["grip"] == .string("pinch"))
        #expect(fields["pinch"] == .number(1))
    }

    @Test("a position is not carried to more precision than a screen can show")
    func aPositionIsNotCarriedToMorePrecisionThanAScreenCanShow() {
        let pose = poseOf(tracked(at: Joint(x: 0.123456789, y: 0.5), grip: .open, pinch: 0))
        guard case .object(let fields) = pose else {
            Issue.record("a pose is not an object")
            return
        }
        #expect(fields["x"] == .number(0.1235))
    }
}
