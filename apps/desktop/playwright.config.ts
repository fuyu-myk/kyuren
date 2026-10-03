import { defineConfig } from "@playwright/test";

/// The island's page outside the app, driven through its own preview harness in WebKit, the engine
/// the app's webview is. A server of its own, on a port of its own, so a dev server left running
/// is never what is tested.
const PORT = 1430;

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 20_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "webkit",
    viewport: { width: 880, height: 440 },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT}`,
    url: `http://localhost:${PORT}/island.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
