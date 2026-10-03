import Foundation
import Testing

@testable import PerceptionCore

@Suite("Patch")
struct PatchTests {
    @Test("the whole frame is squared off around its middle")
    func theWholeFrameIsSquaredOffAroundItsMiddle() {
        #expect(wholeOf(width: 1280, height: 720) == Patch(x: 640, y: 360, side: 1280, turn: 0))
    }

    @Test("a point across an unturned patch lands where the patch is")
    func aPointAcrossAnUnturnedPatchLandsWhereThePatchIs() {
        let patch = Patch(x: 100, y: 50, side: 40, turn: 0)
        #expect(project(Joint(x: 0.5, y: 0.5), from: patch) == Joint(x: 100, y: 50))
        #expect(project(Joint(x: 0, y: 0), from: patch) == Joint(x: 80, y: 30))
        #expect(project(Joint(x: 1, y: 1), from: patch) == Joint(x: 120, y: 70))
    }

    @Test("a turned patch turns what is in it")
    func aTurnedPatchTurnsWhatIsInIt() {
        let patch = Patch(x: 100, y: 50, side: 40, turn: .pi / 2)
        let right = project(Joint(x: 1, y: 0.5), from: patch)
        #expect(abs(right.x - 100) < 1e-9)
        #expect(abs(right.y - 70) < 1e-9)
    }

    @Test("a hand pointing up the frame is not turned, and one pointing right is turned a quarter")
    func aHandPointingUpIsNotTurnedAndOnePointingRightIsTurnedAQuarter() {
        #expect(abs(turnOf(wrist: Joint(x: 100, y: 200), toward: Joint(x: 100, y: 100))) < 1e-9)
        #expect(abs(turnOf(wrist: Joint(x: 100, y: 100), toward: Joint(x: 200, y: 100)) - .pi / 2) < 1e-9)
        #expect(abs(turnOf(wrist: Joint(x: 100, y: 100), toward: Joint(x: 0, y: 100)) + .pi / 2) < 1e-9)
    }

    @Test("angles are kept within a half turn either way")
    func anglesAreKeptWithinAHalfTurnEitherWay() {
        #expect(abs(wrapped(3 * .pi) - .pi) < 1e-9 || abs(wrapped(3 * .pi) + .pi) < 1e-9)
        #expect(abs(wrapped(-0.5) + 0.5) < 1e-9)
        #expect(abs(wrapped(2 * .pi + 0.25) - 0.25) < 1e-9)
    }

    // The detector finds only the palm. The hand is above it, so the square that should hold the
    // whole hand sits up from the palm and is far larger than it.
    @Test("the patch around a palm sits up from it and is much larger")
    func thePatchAroundAPalmSitsUpFromItAndIsMuchLarger() {
        let whole = wholeOf(width: 1000, height: 1000)
        let palm = Palm(
            score: 0.9,
            x: 0.5,
            y: 0.6,
            width: 0.1,
            height: 0.1,
            keypoints: [Joint(x: 0.5, y: 0.65), Joint(x: 0.45, y: 0.6), Joint(x: 0.5, y: 0.55)]
                + Array(repeating: Joint(x: 0.5, y: 0.6), count: 4)
        )
        let patch = patchAround(palm, in: whole)
        #expect(abs(patch.turn) < 1e-9)
        #expect(abs(patch.x - 500) < 1e-9)
        #expect(abs(patch.y - 550) < 1e-9, "moved up by half the palm's height")
        #expect(abs(patch.side - 260) < 1e-9, "two point six times the palm")
    }

    @Test("a palm pointing sideways gets a patch turned to stand it up")
    func aPalmPointingSidewaysGetsAPatchTurnedToStandItUp() {
        let whole = wholeOf(width: 1000, height: 1000)
        let palm = Palm(
            score: 0.9,
            x: 0.5,
            y: 0.5,
            width: 0.1,
            height: 0.1,
            keypoints: [Joint(x: 0.45, y: 0.5), Joint(x: 0.5, y: 0.45), Joint(x: 0.55, y: 0.5)]
                + Array(repeating: Joint(x: 0.5, y: 0.5), count: 4)
        )
        let patch = patchAround(palm, in: whole)
        #expect(abs(patch.turn - .pi / 2) < 1e-9)
        #expect(abs(patch.x - 550) < 1e-9, "moved along the hand, which now runs to the right")
        #expect(abs(patch.y - 500) < 1e-9)
    }

    private func upright() -> [Joint] {
        var points = Array(repeating: Joint(x: 500, y: 500), count: LANDMARKS)
        points[0] = Joint(x: 500, y: 600)
        points[1] = Joint(x: 470, y: 580)
        points[2] = Joint(x: 450, y: 560)
        points[3] = Joint(x: 440, y: 540)
        points[5] = Joint(x: 470, y: 500)
        points[6] = Joint(x: 470, y: 480)
        points[9] = Joint(x: 500, y: 500)
        points[10] = Joint(x: 500, y: 470)
        points[13] = Joint(x: 530, y: 500)
        points[14] = Joint(x: 530, y: 480)
        points[17] = Joint(x: 560, y: 510)
        points[18] = Joint(x: 560, y: 490)
        return points
    }

    @Test("the patch around a hand is snug on the joints that stay put")
    func thePatchAroundAHandIsSnugOnTheJointsThatStayPut() {
        let patch = patchAround(landmarks: upright())
        #expect(abs(patch.turn) < 1e-9)
        #expect(abs(patch.x - 500) < 1e-9)
        #expect(abs(patch.side - 260) < 1e-9, "twice the taller of the box's sides, 130")
        #expect(abs(patch.y - (535 - 13)) < 1e-9, "the box's middle, moved up a tenth of its height")
    }

    // A box drawn around a tilted hand's corners is loose. The box is measured with the hand
    // stood up, so it is the same snug box however the hand is held.
    @Test("a tilted hand gets the same snug box, turned")
    func aTiltedHandGetsTheSameSnugBoxTurned() {
        let angle = 0.7
        let about = Joint(x: 500, y: 540)
        let tilted = upright().map { point -> Joint in
            let dx = point.x - about.x
            let dy = point.y - about.y
            return Joint(
                x: about.x + dx * cos(angle) - dy * sin(angle),
                y: about.y + dx * sin(angle) + dy * cos(angle)
            )
        }
        let straight = patchAround(landmarks: upright())
        let patch = patchAround(landmarks: tilted)
        #expect(abs(patch.turn - angle) < 1e-9)
        #expect(abs(patch.side - straight.side) < 1e-6)
    }
}
