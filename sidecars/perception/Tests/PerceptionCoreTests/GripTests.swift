import Testing

@testable import PerceptionCore

@Suite("Grip")
struct GripTests {
    private let wrist = Joint(x: 0.5, y: 0.25)
    private let knuckle = Joint(x: 0.5, y: 0.45)

    private func hand(
        thumb: Joint,
        index: Joint,
        middle: Joint,
        ring: Joint,
        little: Joint
    ) -> Hand {
        Hand(
            wrist: wrist,
            knuckle: knuckle,
            thumb: thumb,
            index: index,
            middle: middle,
            ring: ring,
            little: little
        )
    }

    private var open: Hand {
        hand(
            thumb: Joint(x: 0.35, y: 0.47),
            index: Joint(x: 0.44, y: 0.59),
            middle: Joint(x: 0.50, y: 0.61),
            ring: Joint(x: 0.56, y: 0.58),
            little: Joint(x: 0.61, y: 0.53)
        )
    }

    private var pinching: Hand {
        hand(
            thumb: Joint(x: 0.46, y: 0.55),
            index: Joint(x: 0.47, y: 0.56),
            middle: Joint(x: 0.52, y: 0.60),
            ring: Joint(x: 0.57, y: 0.57),
            little: Joint(x: 0.61, y: 0.52)
        )
    }

    private var fist: Hand {
        hand(
            thumb: Joint(x: 0.45, y: 0.40),
            index: Joint(x: 0.47, y: 0.42),
            middle: Joint(x: 0.50, y: 0.43),
            ring: Joint(x: 0.54, y: 0.42),
            little: Joint(x: 0.57, y: 0.40)
        )
    }

    @Test("an open hand reads as open")
    func anOpenHandReadsAsOpen() {
        #expect(read(open, was: .unsure).grip == .open)
    }

    @Test("thumb and finger together read as a pinch")
    func thumbAndFingerTogetherReadAsAPinch() {
        #expect(read(pinching, was: .open).grip == .pinch)
    }

    @Test("a closed hand reads as a fist")
    func aClosedHandReadsAsAFist() {
        #expect(read(fist, was: .open).grip == .fist)
    }

    // A fist brings thumb and finger together too, so a reading that only measured the two of them
    // would call every fist a pinch and switch layers instead of grabbing.
    @Test("a fist is not mistaken for a pinch")
    func aFistIsNotMistakenForAPinch() {
        #expect(read(fist, was: .open).grip == .fist)
        #expect(read(fist, was: .unsure).grip == .fist)
    }

    // Dragging relaxes the hand into something fist shaped. The fingers holding the node have not
    // parted, so the node is still held: only opening them lets go.
    @Test("a held pinch is kept while the fingers stay together, whatever the rest of the hand does")
    func aHeldPinchIsKeptWhileTheFingersStayTogether() {
        #expect(read(fist, was: .pinch).grip == .pinch)
    }

    @Test("a pinch begins even with the finger bent well towards the thumb")
    func aPinchBeginsEvenWithTheFingerBentWellTowardsTheThumb() {
        let angled = hand(
            thumb: Joint(x: 0.44, y: 0.44),
            index: Joint(x: 0.46, y: 0.45),
            middle: Joint(x: 0.52, y: 0.60),
            ring: Joint(x: 0.57, y: 0.57),
            little: Joint(x: 0.61, y: 0.52)
        )
        #expect(read(angled, was: .open).grip == .pinch)
    }

    // A pinch aims with the point between thumb and index: the two converge on it as they close,
    // so it holds still while the hand commits. A point aims with the index tip, because that is
    // the finger being pointed with. One rule for both would break one of them.
    @Test("a pinch aims between the fingers and a point aims with the finger")
    func aPinchAimsBetweenTheFingersAndAPointAimsWithTheFinger() {
        let closed = read(pinching, was: .open).at
        #expect(abs(closed.x - 0.465) < 1e-9)
        #expect(abs(closed.y - 0.555) < 1e-9)

        let apart = read(open, was: .open).at
        #expect(abs(apart.x - 0.395) < 1e-9)
        #expect(abs(apart.y - 0.53) < 1e-9)

        #expect(read(pointing, was: .open).at == Joint(x: 0.47, y: 0.62))
    }

    private var pointing: Hand {
        hand(
            thumb: Joint(x: 0.525, y: 0.465),
            index: Joint(x: 0.47, y: 0.62),
            middle: Joint(x: 0.52, y: 0.47),
            ring: Joint(x: 0.55, y: 0.44),
            little: Joint(x: 0.575, y: 0.42)
        )
    }

    @Test("a finger held out with the thumb on the middle one is pointing")
    func aFingerHeldOutWithTheThumbOnTheMiddleOneIsPointing() {
        #expect(read(pointing, was: .open).grip == .point)
    }

    // Pointing curls the middle, ring and little fingers, which is most of what makes a fist. The
    // finger held out is the whole difference, and it has to be enough of one.
    @Test("pointing is not a fist")
    func pointingIsNotAFist() {
        #expect(read(pointing, was: .fist).grip == .point)
        #expect(read(fist, was: .point).grip == .fist)
    }

    @Test("pointing is not a pinch, and a pinch is not pointing")
    func pointingIsNotAPinchAndAPinchIsNotPointing() {
        #expect(read(pointing, was: .pinch).grip == .point)
        #expect(read(pinching, was: .point).grip == .pinch)
    }

    // A hand resting open, fingers together rather than splayed, was being read as holding on.
    @Test("a hand that is merely relaxed is not gripping anything")
    func aHandThatIsMerelyRelaxedIsNotGrippingAnything() {
        let resting = hand(
            thumb: Joint(x: 0.40, y: 0.52),
            index: Joint(x: 0.46, y: 0.60),
            middle: Joint(x: 0.51, y: 0.61),
            ring: Joint(x: 0.56, y: 0.58),
            little: Joint(x: 0.60, y: 0.54)
        )
        #expect(read(resting, was: .pinch).grip != .pinch)
    }

    @Test("the same hand held closer reads the same")
    func theSameHandHeldCloserReadsTheSame() {
        let near = Hand(
            wrist: Joint(x: 0.5, y: 0.05),
            knuckle: Joint(x: 0.5, y: 0.45),
            thumb: Joint(x: 0.20, y: 0.49),
            index: Joint(x: 0.38, y: 0.73),
            middle: Joint(x: 0.50, y: 0.77),
            ring: Joint(x: 0.62, y: 0.71),
            little: Joint(x: 0.72, y: 0.61)
        )
        #expect(read(near, was: .unsure).grip == .open)
    }

    // Held between the two thresholds a hand would flicker from grabbed to let go many times a
    // second, which is the difference between holding a node and dropping it.
    @Test("a grip is kept until it is clearly given up")
    func aGripIsKeptUntilItIsClearlyGivenUp() {
        let half = hand(
            thumb: Joint(x: 0.429, y: 0.519),
            index: Joint(x: 0.48, y: 0.57),
            middle: Joint(x: 0.52, y: 0.60),
            ring: Joint(x: 0.57, y: 0.57),
            little: Joint(x: 0.61, y: 0.52)
        )
        #expect(read(half, was: .pinch).grip == .pinch)
        #expect(read(half, was: .open).grip == .open)
    }

    // A curled finger is behind the hand, so the tracker cannot see its tip. Throwing the whole
    // hand away when a tip goes missing would make a fist the one gesture that never registers.
    // While dragging, the hand relaxes: the index bends a little and the other fingers half curl.
    // That hand matches no gesture outright, and the old reading carried the pinch forward on the
    // strength of nothing, so a pinch whose fingers had plainly parted stayed a pinch. Stuck.
    @Test("a pinch whose fingers have parted is over, whatever the rest of the hand is doing")
    func aPinchWhoseFingersHavePartedIsOverWhateverTheRestOfTheHandIsDoing() {
        let relaxed = hand(
            thumb: Joint(x: 0.34, y: 0.40),
            index: Joint(x: 0.46, y: 0.44),
            middle: Joint(x: 0.50, y: 0.50),
            ring: Joint(x: 0.54, y: 0.49),
            little: Joint(x: 0.58, y: 0.47)
        )
        #expect(read(relaxed, was: .pinch).grip != .pinch)
        #expect(read(relaxed, was: .point).grip != .point)
        #expect(read(relaxed, was: .open).grip == .open, "a hand that was open and matches nothing stays open")
    }

    @Test("a pinch whose fingers are still together is kept through an unclear moment")
    func aPinchWhoseFingersAreStillTogetherIsKeptThroughAnUnclearMoment() {
        let bent = hand(
            thumb: Joint(x: 0.45, y: 0.43),
            index: Joint(x: 0.46, y: 0.44),
            middle: Joint(x: 0.50, y: 0.50),
            ring: Joint(x: 0.54, y: 0.49),
            little: Joint(x: 0.58, y: 0.47)
        )
        #expect(read(bent, was: .pinch).grip == .pinch)
    }

    @Test("a closed pinch reads stronger than a parting one")
    func aClosedPinchReadsStrongerThanAPartingOne() {
        let parting = hand(
            thumb: Joint(x: 0.42, y: 0.51),
            index: Joint(x: 0.48, y: 0.57),
            middle: Joint(x: 0.52, y: 0.60),
            ring: Joint(x: 0.57, y: 0.57),
            little: Joint(x: 0.61, y: 0.52)
        )
        #expect(read(pinching, was: .open).pinch > read(parting, was: .pinch).pinch)
        #expect(read(pinching, was: .open).pinch <= 1)
        #expect(read(open, was: .open).pinch == 0)
    }

    @Test("an index raised alone, the thumb out of the way, is a one")
    func anIndexRaisedAloneIsAOne() {
        let one = hand(
            thumb: Joint(x: 0.32, y: 0.40),
            index: Joint(x: 0.50, y: 0.57),
            middle: Joint(x: 0.50, y: 0.42),
            ring: Joint(x: 0.54, y: 0.41),
            little: Joint(x: 0.58, y: 0.39)
        )
        let seen = read(one, was: .unsure)
        #expect(seen.grip == .one)
        #expect(seen.at == one.index, "a one aims with the finger that is up")
        #expect(read(one, was: .one).grip == .one)
    }
}
