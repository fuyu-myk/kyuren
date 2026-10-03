import Foundation
import OnnxRuntimeBindings
import Testing

@testable import PerceptionCore

@Suite("Hands")
struct HandsTests {
    // A model that resolves as a dependency and a model that loads are different things.
    @Test("both hand models ship with the sidecar and load")
    func bothHandModelsShipWithTheSidecarAndLoad() throws {
        _ = try Hands()
    }

    @Test("an empty room is no hand, and is not an error")
    func anEmptyRoomIsNoHandAndIsNotAnError() throws {
        let hands = try Hands()
        let bytes = [UInt8](repeating: 40, count: 320 * 240 * 4)
        let seen = try bytes.withUnsafeBufferPointer { held in
            try hands.see(Picture(width: 320, height: 240, bytesPerRow: 320 * 4, bytes: held.baseAddress!))
        }
        #expect(seen.isEmpty)
    }

    // A camera frame arrives thirty times a second. Whatever the models cost, the arithmetic
    // around them must leave that budget mostly unspent, and the only way to know is to time it.
    @Test("a full frame is looked at well inside a frame's time")
    func aFullFrameIsLookedAtWellInsideAFramesTime() throws {
        let hands = try Hands()
        let bytes = [UInt8](repeating: 40, count: 1280 * 720 * 4)
        // On a plain queue, which is what the camera hands frames to in the sidecar. A model that
        // is fast on the test's thread and slow on that queue would be fast nowhere it matters.
        let queue = DispatchQueue(label: "kyuren.sight")
        let took = try bytes.withUnsafeBufferPointer { held -> Double in
            let picture = Picture(width: 1280, height: 720, bytesPerRow: 1280 * 4, bytes: held.baseAddress!)
            _ = try hands.see(picture)
            var total = 0.0
            for _ in 0..<10 {
                try queue.sync {
                    let began = Date()
                    _ = try hands.see(picture)
                    total += Date().timeIntervalSince(began)
                }
            }
            return total / 10 * 1000
        }
        print("one empty frame, detector included, on the camera's queue: \(String(format: "%.1f", took)) ms")
        #if !DEBUG
        #expect(took < 33)
        #endif
    }

    // Once a hand is found, this is the path every frame takes. It is the one the empty room
    // cannot reach, so it is timed on its own.
    @Test("following a hand costs less than finding one")
    func followingAHandCostsLessThanFindingOne() throws {
        let hands = try Hands()
        let bytes = [UInt8](repeating: 40, count: 1280 * 720 * 4)
        let patch = Patch(x: 640, y: 360, side: 300, turn: 0.4)
        let took = try bytes.withUnsafeBufferPointer { held -> Double in
            let picture = Picture(width: 1280, height: 720, bytesPerRow: 1280 * 4, bytes: held.baseAddress!)
            _ = try hands.landmarks(in: patch, of: picture)
            let began = Date()
            for _ in 0..<10 { _ = try hands.landmarks(in: patch, of: picture) }
            return Date().timeIntervalSince(began) / 10 * 1000
        }
        print("one followed frame: \(String(format: "%.1f", took)) ms")
        #if !DEBUG
        #expect(took < 33)
        #endif
    }

    @Test("the seven joints a gesture needs are picked out and mirrored")
    func theSevenJointsAGestureNeedsArePickedOutAndMirrored() {
        var points = Array(repeating: Joint(x: 0, y: 0), count: LANDMARKS)
        points[0] = Joint(x: 100, y: 180)
        points[9] = Joint(x: 100, y: 120)
        points[4] = Joint(x: 60, y: 130)
        points[8] = Joint(x: 90, y: 60)
        points[12] = Joint(x: 100, y: 50)
        points[16] = Joint(x: 110, y: 60)
        points[20] = Joint(x: 125, y: 80)
        let hand = handOf(points, width: 200, height: 200)
        #expect(hand.wrist == Joint(x: 0.5, y: 0.9))
        #expect(hand.knuckle == Joint(x: 0.5, y: 0.6))
        #expect(hand.thumb == Joint(x: 0.7, y: 0.65), "a hand on the left of the frame is on the right of the screen")
        #expect(hand.index == Joint(x: 0.55, y: 0.3))
        #expect(hand.little == Joint(x: 0.375, y: 0.4))
        #expect(hand.skeleton.count == LANDMARKS)
        #expect(hand.skeleton[4] == hand.thumb, "the named joints are the skeleton's own")
    }
}
