import Foundation
import Testing

@testable import PerceptionCore

@Suite("Picture")
struct PictureTests {
    /// A dark frame with one white pixel, so that where it turns up in a tensor says where the
    /// patch was read from.
    private func frame(width: Int, height: Int, lit: (Int, Int), in body: (Picture) -> Void) {
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let at = (lit.1 * width + lit.0) * 4
        bytes[at] = 255
        bytes[at + 1] = 255
        bytes[at + 2] = 255
        bytes[at + 3] = 255
        bytes.withUnsafeBufferPointer { held in
            body(Picture(width: width, height: height, bytesPerRow: width * 4, bytes: held.baseAddress!))
        }
    }

    private func brightest(_ tensor: [Float], side: Int) -> (x: Int, y: Int, value: Float) {
        var best = (x: 0, y: 0, value: Float(-1))
        for v in 0..<side {
            for u in 0..<side {
                let value = tensor[(v * side + u) * 3]
                if value > best.value { best = (u, v, value) }
            }
        }
        return best
    }

    @Test("the whole frame is read with its short side padded out in black")
    func theWholeFrameIsReadWithItsShortSidePaddedOutInBlack() {
        frame(width: 8, height: 6, lit: (5, 2)) { picture in
            let tensor = tensorOf(picture, wholeOf(width: 8, height: 6), side: 8)
            #expect(tensor.count == 8 * 8 * 3)
            let found = brightest(tensor, side: 8)
            #expect(found.x == 5)
            #expect(found.y == 3, "the frame sits one row down inside the square")
            #expect(abs(found.value - 1) < 1e-6)
            #expect(tensor[0] == 0, "the padding is black")
        }
    }

    @Test("a turned patch reads the frame turned")
    func aTurnedPatchReadsTheFrameTurned() {
        frame(width: 9, height: 9, lit: (4, 6)) { picture in
            let patch = Patch(x: 4.5, y: 4.5, side: 4, turn: .pi / 2)
            let tensor = tensorOf(picture, patch, side: 4)
            // Two pixels below the middle of the frame is the right hand edge of a patch turned
            // a quarter clockwise.
            let found = brightest(tensor, side: 4)
            #expect(found.x == 3)
            #expect(found.y == 1 || found.y == 2)
        }
    }

    @Test("a patch between pixels reads a blend of them")
    func aPatchBetweenPixelsReadsABlendOfThem() {
        frame(width: 4, height: 4, lit: (2, 2)) { picture in
            let patch = Patch(x: 2.5, y: 2.5, side: 1, turn: 0)
            let exact = tensorOf(picture, patch, side: 1)
            #expect(abs(exact[0] - 1) < 1e-6)
            let between = tensorOf(picture, Patch(x: 3, y: 2.5, side: 1, turn: 0), side: 1)
            #expect(abs(between[0] - 0.5) < 1e-6)
        }
    }

    @Test("colour arrives as red, green, blue")
    func colourArrivesAsRedGreenBlue() {
        var bytes: [UInt8] = [10, 20, 30, 255]
        bytes.withUnsafeBufferPointer { held in
            let picture = Picture(width: 1, height: 1, bytesPerRow: 4, bytes: held.baseAddress!)
            let tensor = tensorOf(picture, Patch(x: 0.5, y: 0.5, side: 1, turn: 0), side: 1)
            #expect(abs(tensor[0] - 30 / 255) < 1e-6)
            #expect(abs(tensor[1] - 20 / 255) < 1e-6)
            #expect(abs(tensor[2] - 10 / 255) < 1e-6)
        }
    }
}
