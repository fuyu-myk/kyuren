import AVFoundation

public enum MicrophonePermission: String, Sendable {
    case authorized
    case denied
    case restricted
    case undetermined

    public static func current() -> MicrophonePermission {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .undetermined
        @unknown default: return .undetermined
        }
    }
}

public func requestMicrophone(_ transport: any Transport) {
    AVCaptureDevice.requestAccess(for: .audio) { _ in
        transport.send(.event(
            name: "microphone.permission",
            data: .object(["status": .string(MicrophonePermission.current().rawValue)])
        ))
    }
}
