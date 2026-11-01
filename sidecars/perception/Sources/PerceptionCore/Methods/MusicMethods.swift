public func musicHandlers(_ tap: MusicTap) -> [String: Handler] {
    [
        "music.listen": { params in
            guard case .string(let bundle)? = params["bundle"], !bundle.isEmpty else {
                throw MusicTapError.unreadable("no player was named")
            }
            tap.listen(bundle: bundle)
            return .object(["listening": .bool(true)])
        },
        "music.quiet": { _ in
            tap.quiet()
            return .object(["listening": .bool(false)])
        },
    ]
}
