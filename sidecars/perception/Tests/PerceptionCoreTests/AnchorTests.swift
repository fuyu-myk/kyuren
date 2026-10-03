import Testing

@testable import PerceptionCore

@Suite("Anchors")
struct AnchorTests {
    private let all = anchors()

    @Test("there are exactly as many anchors as the detector has boxes")
    func thereAreExactlyAsManyAnchorsAsTheDetectorHasBoxes() {
        #expect(all.count == ANCHORS)
    }

    // The order is the model's order. A list that is right in every other way but shuffled would
    // put every hand somewhere else.
    @Test("the fine grid comes first, row by row, with two boxes to a cell")
    func theFineGridComesFirstRowByRowWithTwoBoxesToACell() {
        #expect(all[0] == Anchor(x: 0.5 / 24, y: 0.5 / 24))
        #expect(all[1] == all[0])
        #expect(all[2] == Anchor(x: 1.5 / 24, y: 0.5 / 24))
        #expect(all[48] == Anchor(x: 0.5 / 24, y: 1.5 / 24))
    }

    @Test("the coarse grid follows, with six boxes to a cell")
    func theCoarseGridFollowsWithSixBoxesToACell() {
        #expect(all[1152] == Anchor(x: 0.5 / 12, y: 0.5 / 12))
        #expect(all[1157] == all[1152])
        #expect(all[1158] == Anchor(x: 1.5 / 12, y: 0.5 / 12))
        #expect(all[2015] == Anchor(x: 11.5 / 12, y: 11.5 / 12))
    }
}
