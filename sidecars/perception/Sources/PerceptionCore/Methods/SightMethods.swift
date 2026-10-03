public func sightHandlers(_ sight: Sight, _ transport: any Transport) -> [String: Handler] {
    [
        "sight.permission": { _ in
            .object(["status": .string(CameraPermission.current().rawValue)])
        },
        "sight.request": { _ in
            requestCamera(transport)
            return .object(["status": .string(CameraPermission.current().rawValue)])
        },
        "sight.start": { _ in
            let open = try sight.startAllowingPrompt()
            return .object([
                "open": .bool(open),
                "status": .string(open ? "watching" : "awaiting permission"),
            ])
        },
        "sight.stop": { _ in
            sight.stop()
            return .object(["open": .bool(false)])
        },
        "screen.capture": { _ in
            let taken = try settled { try await captureScreen(into: capturesFolder()) }
            return .object([
                "path": .string(taken.path),
                "width": .number(Double(taken.width)),
                "height": .number(Double(taken.height)),
            ])
        },
        "sight.state": { _ in
            .object([
                "open": .bool(sight.isOpen),
                "status": .string(CameraPermission.current().rawValue),
                "tracker": .string(sight.trouble ?? "ready"),
            ])
        },
    ]
}
