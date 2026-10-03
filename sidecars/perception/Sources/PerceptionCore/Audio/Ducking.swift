import CoreAudio
import Foundation

/// Lowering everything else while Kyuren speaks.
///
/// Voice processing used to do this as a side effect, and it is gone. macOS has no public way to
/// quieten other applications: `AVAudioSession`'s ducking options are iOS only, and the device
/// volume property moves Kyuren's own voice with everything else. `AudioDeviceDuck` is what the
/// system's own assistant uses. It is exported by CoreAudio but absent from the headers, so it is
/// resolved at run time and simply does nothing if a future release stops exporting it.
public enum Ducking {
    private typealias Duck = @convention(c) (
        AudioDeviceID, Float32, UnsafePointer<AudioTimeStamp>?, Float32
    ) -> OSStatus

    private static let level: Float32 = 0.25
    private static let fadeDown: Float32 = 0.25
    private static let fadeUp: Float32 = 0.4

    private static let duck: Duck? = {
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "AudioDeviceDuck") else {
            return nil
        }
        return unsafeBitCast(symbol, to: Duck.self)
    }()

    public static var available: Bool { duck != nil }

    /// Returns whether the level was changed, so a failure can be reported rather than assumed.
    @discardableResult
    public static func others(quietened: Bool) -> Bool {
        guard let duck, let device = defaultOutput() else { return false }
        let status = duck(device, quietened ? level : 1, nil, quietened ? fadeDown : fadeUp)
        return status == noErr
    }

    private static func defaultOutput() -> AudioDeviceID? {
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
        return status == noErr && id != 0 ? id : nil
    }
}
