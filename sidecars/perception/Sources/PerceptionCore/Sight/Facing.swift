import Foundation

/// The camera looks back at the user, so a hand moved to the right appears on the left of the
/// frame. Mirroring it is what makes reaching feel like reaching rather than like steering.
public func facing(x: Double, y: Double) -> Joint {
    Joint(x: 1 - x, y: y)
}
