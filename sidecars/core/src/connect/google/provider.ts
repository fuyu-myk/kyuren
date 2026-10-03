import type { Provider } from "#connect/oauth/provider.ts";

export const GOOGLE: Provider = {
  name: "google",
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: () => process.env.KYUREN_GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  host: "127.0.0.1",
  secret: true,
  // Without both of these Google returns an access token only, and the connection would have to be
  // made again by hand every hour.
  extra: { access_type: "offline", prompt: "consent" },
};
