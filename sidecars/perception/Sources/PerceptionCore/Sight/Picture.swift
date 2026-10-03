import Foundation

/// A frame of the camera as bytes: blue, green, red and alpha for each pixel, row after row.
/// Nothing here knows where the bytes came from, which is what lets everything that follows run
/// the same on any machine. The bytes are borrowed, and only for as long as the frame is held.
public struct Picture {
    public let width: Int
    public let height: Int
    public let bytesPerRow: Int
    public let bytes: UnsafePointer<UInt8>

    public init(width: Int, height: Int, bytesPerRow: Int, bytes: UnsafePointer<UInt8>) {
        self.width = width
        self.height = height
        self.bytesPerRow = bytesPerRow
        self.bytes = bytes
    }
}

@inline(__always)
private func channel(_ picture: Picture, _ x: Int, _ y: Int, _ which: Int) -> Float {
    guard x >= 0, y >= 0, x < picture.width, y < picture.height else { return 0 }
    // The bytes run blue, green, red; the models want red first.
    return Float(picture.bytes[y * picture.bytesPerRow + x * 4 + (2 - which)])
}

/// A patch of the picture as a model wants it: rows of red, green and blue from zero to one,
/// read between pixels where the patch falls between them and black where it falls off the edge
/// of the frame. Plain arithmetic over bytes on purpose.
public func tensorOf(_ picture: Picture, _ patch: Patch, side: Int) -> [Float] {
    var out = [Float](repeating: 0, count: side * side * 3)
    let c = cos(patch.turn)
    let s = sin(patch.turn)
    let step = patch.side / Double(side)

    for v in 0..<side {
        let dy = (Double(v) + 0.5) * step - patch.side / 2
        for u in 0..<side {
            let dx = (Double(u) + 0.5) * step - patch.side / 2
            // Pixels are read at their middles, so the frame's pixel i sits at i plus a half.
            let px = patch.x + dx * c - dy * s - 0.5
            let py = patch.y + dx * s + dy * c - 0.5
            let x0 = Int(floor(px))
            let y0 = Int(floor(py))
            let tx = Float(px - Double(x0))
            let ty = Float(py - Double(y0))
            let at = (v * side + u) * 3
            for which in 0..<3 {
                let top = channel(picture, x0, y0, which) * (1 - tx)
                    + channel(picture, x0 + 1, y0, which) * tx
                let bottom = channel(picture, x0, y0 + 1, which) * (1 - tx)
                    + channel(picture, x0 + 1, y0 + 1, which) * tx
                out[at + which] = (top * (1 - ty) + bottom * ty) / 255
            }
        }
    }
    return out
}
