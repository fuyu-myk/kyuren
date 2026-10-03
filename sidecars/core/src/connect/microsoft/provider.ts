import type { Provider } from "#connect/oauth/provider.ts";

const TENANT = "common";

/// Microsoft issues no secret to installed applications, so the client id is the whole of the
/// registration and proof key for code exchange carries the rest.
export const MICROSOFT: Provider = {
  name: "microsoft",
  authorize: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
  token: () =>
    process.env.KYUREN_MICROSOFT_TOKEN_URL
    ?? `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
  scopes: ["Calendars.Read", "Mail.Read", "offline_access"],
  // Registered as http://localhost, and Microsoft refuses a redirect that does not match it.
  host: "localhost",
  secret: false,
};
