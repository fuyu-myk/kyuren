import Testing

@testable import PerceptionCore

@Suite("Landmarks")
struct LandmarkTests {
    @Test("landmarks arrive in the patch's pixels and leave as fractions of it")
    func landmarksArriveInThePatchsPixelsAndLeaveAsFractionsOfIt() throws {
        var raw = [Float](repeating: 0, count: LANDMARKS * 3)
        raw[0] = 112
        raw[1] = 56
        raw[2] = 3
        raw[27] = 224
        raw[28] = 0
        let read = try #require(landmarksFrom(raw, presence: 0.8))
        #expect(read.points.count == LANDMARKS)
        #expect(read.points[0] == Joint(x: 0.5, y: 0.25))
        #expect(read.points[9] == Joint(x: 1, y: 0))
        #expect(abs(read.presence - 0.8) < 1e-6)
    }

    @Test("a short answer is not read")
    func aShortAnswerIsNotRead() {
        #expect(landmarksFrom([1, 2, 3], presence: 1) == nil)
    }
}
