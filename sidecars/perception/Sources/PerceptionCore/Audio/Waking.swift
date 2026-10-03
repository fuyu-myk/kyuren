/// How sure the wake word must be, how many chunks in a row must agree, and how many chunks of
/// rest follow, so that one word said once is heard once. Two chunks is 160 ms of agreement;
/// the rest is two seconds. At 0.7 the measured curve misses 4% of the user's takes, the same as
/// at 0.6, and false accepts on continuous speech fall from about 9 an hour to 7. These live beside the model because they were chosen from its
/// measured curves, in Audio/Hearing/SOURCE.md, and a new model brings its own. Measurement uses
/// the same numbers.
public let THRESHOLD = 0.7
public let NEEDED = 2
public let REST = 25

/// How recently a voice must have been heard for a wake to count, in seconds. The head judges
/// a window of sound; a slammed door or a dropped cup can score like the word, and the one thing
/// they are not is speech. The window is the length of the phrase and a little more.
public let SPOKEN_WITHIN = 1.5

/// When a voice was last heard, so a wake can be refused when nobody was speaking.
public struct Voiced: Sendable, Equatable {
    private var lastAt: Double?

    public init() {}

    public mutating func heard(speech: Bool, at now: Double) {
        if speech { lastAt = now }
    }

    public func spoken(at now: Double) -> Bool {
        guard let lastAt else { return false }
        return now - lastAt <= SPOKEN_WITHIN
    }
}

/// A run of scores, one per 80 ms chunk, turned into the moments the word was heard. Pure, so the
/// rule can be tested without a model, and so the measurement tool can apply the very same rule.
public struct Waking: Sendable, Equatable {
    private var agreeing = 0
    private var resting = 0

    public init() {}

    /// Whether this chunk's score is the one that completes a hearing.
    public mutating func heard(_ score: Double, over threshold: Double) -> Bool {
        if resting > 0 {
            resting -= 1
            return false
        }
        agreeing = score >= threshold ? agreeing + 1 : 0
        guard agreeing >= NEEDED else { return false }
        agreeing = 0
        resting = REST
        return true
    }
}
