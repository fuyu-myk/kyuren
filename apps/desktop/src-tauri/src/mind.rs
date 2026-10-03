use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

pub const LABEL: &str = "mind";

/// Counts how many times the mind has been asked to appear or to go, so that a later request
/// cancels an earlier one that is still waiting.
static ASKED: AtomicU64 = AtomicU64::new(0);

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(LABEL)
}

/// Shows the mind over whatever is on screen, sized to the display it opens on. It is not a panel
/// like the orb: this one is meant to be reached into, so it takes the keyboard and the pointer.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    ASKED.fetch_add(1, Ordering::SeqCst);
    let Some(window) = window(app) else { return };

    if let Ok(Some(monitor)) = window.current_monitor() {
        let area = monitor.work_area();
        let _ = window.set_position(area.position);
        let _ = window.set_size(area.size);
    }

    let _ = window.show();
    let _ = window.set_focus();

    // The whirlpool is summoned rather than left turning behind a hidden window, so it is told to
    // arrive again each time it is asked for.
    let _ = app.emit("mind:shown", ());
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    crate::sight::close(app);
    if let Some(window) = window(app) {
        let _ = window.hide();
    }
}

/// How long the mind is given to put itself away before it is put away for it.
const PATIENCE: Duration = Duration::from_millis(1200);

/// Asks the mind to close, so that it is watched going rather than found gone. It hides itself
/// once the last of it has gone; if it never answers, it is hidden anyway.
pub fn dismiss<R: Runtime>(app: &AppHandle<R>) {
    let asked = ASKED.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(window) = window(app) else { return };
    if app.emit("mind:dismiss", ()).is_err() {
        let _ = window.hide();
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(PATIENCE).await;
        // Asking for it again in the meantime withdraws the question, so summoning it back before
        // it has finished going does not put it away a moment later.
        if ASKED.load(Ordering::SeqCst) == asked {
            hide(&app);
        }
    });
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let showing = window(app).and_then(|one| one.is_visible().ok()).unwrap_or(false);
    if showing {
        dismiss(app);
    } else {
        show(app);
    }
}
