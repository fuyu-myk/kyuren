/// Whether this window is running inside the application or on its own in a browser, which is how
/// every surface knows whether there is anything behind it to ask.
export function insideTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
