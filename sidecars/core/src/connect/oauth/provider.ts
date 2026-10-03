/// What differs between one authorisation service and the next. Everything else about the flow is
/// the same, so it is written once.
export type Provider = {
  name: string;
  authorize: string;
  /// A function rather than a value, so a test can point the exchange somewhere that is not the
  /// real service and never reaches the network.
  token: () => string;
  scopes: string[];
  /// Whether the service issues a secret to installed applications. Microsoft does not; Google
  /// does, and requires it back even though an installed application cannot keep it.
  secret: boolean;
  /// The host in the redirect address. Microsoft matches what was registered, and registers
  /// `http://localhost`; Google accepts any loopback form.
  host: "localhost" | "127.0.0.1";
  /// Anything the service needs beyond the standard parameters to return a refresh token.
  extra?: Record<string, string>;
};
