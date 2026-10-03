import AVFoundation

public enum CameraPermission: String, Sendable {
    case authorized
    case denied
    case restricted
    case undetermined

    public static func current() -> CameraPermission {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .undetermined
        @unknown default: return .undetermined
        }
    }
}

public func requestCamera(_ transport: any Transport) {
    AVCaptureDevice.requestAccess(for: .video) { _ in
        transport.send(.event(
            name: "camera.permission",
            data: .object(["status": .string(CameraPermission.current().rawValue)])
        ))
    }
}
