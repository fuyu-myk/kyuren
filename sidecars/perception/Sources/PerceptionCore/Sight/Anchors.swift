import Foundation

/// One place the palm detector expects a hand to be. Its boxes are offsets from these, so the
/// list has to match the one the model was trained against exactly, including its order.
public struct Anchor: Sendable, Equatable {
    public let x: Double
    public let y: Double
}

public let DETECTOR_SIDE = 192
public let ANCHORS = 2016

/// Two grids over the detector's square: twenty four cells across with two boxes each, then
/// twelve across with six. The counts come from the model's four layers of box scales, the last
/// three of which share a stride and so share a grid. The scales themselves do not matter: every
/// anchor is the same unit size and only its middle is used.
private let GRIDS: [(cells: Int, boxes: Int)] = [(24, 2), (12, 6)]

public func anchors() -> [Anchor] {
    var made: [Anchor] = []
    made.reserveCapacity(ANCHORS)
    for grid in GRIDS {
        for row in 0..<grid.cells {
            for column in 0..<grid.cells {
                for _ in 0..<grid.boxes {
                    made.append(Anchor(
                        x: (Double(column) + 0.5) / Double(grid.cells),
                        y: (Double(row) + 0.5) / Double(grid.cells)
                    ))
                }
            }
        }
    }
    return made
}
