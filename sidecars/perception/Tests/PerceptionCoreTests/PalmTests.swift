import Testing

@testable import PerceptionCore

@Suite("Palms")
struct PalmTests {
    private let placed = anchors()

    private func raw(sure indices: [Int: (score: Float, box: [Float])]) -> (boxes: [Float], scores: [Float]) {
        var boxes = [Float](repeating: 0, count: ANCHORS * PALM_VALUES)
        var scores = [Float](repeating: -20, count: ANCHORS)
        for (index, said) in indices {
            scores[index] = said.score
            for (at, value) in said.box.enumerated() { boxes[index * PALM_VALUES + at] = value }
        }
        return (boxes, scores)
    }

    @Test("nothing proposed is nothing found")
    func nothingProposedIsNothingFound() {
        let given = raw(sure: [:])
        #expect(palmIn(boxes: given.boxes, scores: given.scores, anchors: placed) == nil)
    }

    @Test("a box is an offset from its anchor, in the detector's own pixels")
    func aBoxIsAnOffsetFromItsAnchorInTheDetectorsOwnPixels() throws {
        let given = raw(sure: [100: (3, [9.6, -9.6, 48, 24, 0, 0, 1.92, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])])
        let palm = try #require(palmIn(boxes: given.boxes, scores: given.scores, anchors: placed))
        let anchor = placed[100]
        #expect(abs(palm.x - (anchor.x + 0.05)) < 1e-6)
        #expect(abs(palm.y - (anchor.y - 0.05)) < 1e-6)
        #expect(abs(palm.width - 0.25) < 1e-9)
        #expect(abs(palm.height - 0.125) < 1e-9)
        #expect(palm.keypoints.count == PALM_KEYPOINTS)
        #expect(abs(palm.keypoints[0].x - anchor.x) < 1e-9)
        #expect(abs(palm.keypoints[1].x - (anchor.x + 0.01)) < 1e-6)
        #expect(abs(palm.score - 0.9526) < 0.001)
    }

    @Test("an unsure proposal is not a palm")
    func anUnsureProposalIsNotAPalm() {
        let given = raw(sure: [100: (-0.5, [0, 0, 48, 48, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])])
        #expect(palmIn(boxes: given.boxes, scores: given.scores, anchors: placed) == nil)
    }

    // Neighbouring anchors propose the same hand, and picking one of them throws away what the
    // others knew. They are averaged by how sure each was.
    @Test("proposals of the same hand are averaged by how sure they were")
    func proposalsOfTheSameHandAreAveragedByHowSureTheyWere() throws {
        let box: [Float] = [0, 0, 96, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        let given = raw(sure: [0: (4, box), 1: (4, box), 2: (0.5, box)])
        let palm = try #require(palmIn(boxes: given.boxes, scores: given.scores, anchors: placed))
        let heavy = sigmoid(4)
        let light = sigmoid(0.5)
        let expected = (placed[0].x * heavy * 2 + placed[2].x * light) / (heavy * 2 + light)
        #expect(abs(palm.x - expected) < 1e-9)
        #expect(palm.x > placed[0].x)
        #expect(palm.x < placed[2].x)
    }

    @Test("a proposal far away is a different hand and is left alone")
    func aProposalFarAwayIsADifferentHandAndIsLeftAlone() throws {
        let box: [Float] = [0, 0, 24, 24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        let given = raw(sure: [0: (4, box), 2015: (2, box)])
        let palm = try #require(palmIn(boxes: given.boxes, scores: given.scores, anchors: placed))
        #expect(abs(palm.x - placed[0].x) < 1e-9)
    }

    @Test("a mismatched answer is refused rather than read")
    func aMismatchedAnswerIsRefusedRatherThanRead() {
        #expect(palmIn(boxes: [1, 2, 3], scores: [1], anchors: placed) == nil)
    }

    @Test("two hands apart are two palms, surest first, and a hand seen twice is not a third")
    func twoHandsApartAreTwoPalmsSurestFirst() throws {
        let box: [Float] = [0, 0, 48, 48, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        let here = 100
        let beside = try #require(placed.indices.first { $0 != here && abs(placed[$0].x - placed[here].x) < 0.02 && abs(placed[$0].y - placed[here].y) < 0.02 })
        let far = try #require(placed.indices.first { abs(placed[$0].x - placed[here].x) > 0.5 })
        let given = raw(sure: [here: (3, box), beside: (2, box), far: (4, box)])

        let palms = palmsIn(boxes: given.boxes, scores: given.scores, anchors: placed, most: 2)
        #expect(palms.count == 2)
        #expect(abs(palms[0].x - placed[far].x) < 0.05, "the surest hand comes first")
        #expect(abs(palms[1].x - placed[here].x) < 0.05)
        #expect(palmsIn(boxes: given.boxes, scores: given.scores, anchors: placed, most: 1).count == 1)
        #expect(palmsIn(boxes: given.boxes, scores: given.scores, anchors: placed, most: 3).count == 2, "there is no third hand")
    }
}
