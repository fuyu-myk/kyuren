use std::error::Error;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn summon() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space)
}

/// Showing the mind, next to the key that summons the orb so the two are remembered together.
pub fn mind() -> Shortcut {
    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyM)
}

pub fn register<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn Error>> {
    app.global_shortcut().on_shortcut(summon(), |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            let _ = app.emit("summon", ());
        }
    })?;

    app.global_shortcut().on_shortcut(mind(), |app, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            crate::mind::toggle(app);
        }
    })?;

    Ok(())
}

/// How many times registering is tried, and how long between tries. An instance being quit still
/// holds the shortcuts for a moment; an instance opened in that moment used to die of it.
const ATTEMPTS: u32 = 8;
const BETWEEN: std::time::Duration = std::time::Duration::from_millis(400);

/// Registers the shortcuts, trying again for a few seconds if they are still held by an instance
/// on its way out. Failing for good is logged and lived with: the tray and the windows still work,
/// and an application that will not start over a hotkey is worse than one without it.
pub fn register_eventually(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for attempt in 1..=ATTEMPTS {
            let (tell, told) = tokio::sync::oneshot::channel();
            let trying = app.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = tell.send(register(&trying).map_err(|failure| failure.to_string()));
            });
            match told.await {
                Ok(Ok(())) => return,
                Ok(Err(failure)) if attempt == ATTEMPTS => eprintln!("kyuren hotkeys: {failure}"),
                Ok(Err(_)) => tokio::time::sleep(BETWEEN).await,
                Err(_) => return,
            }
        }
    });
}

pub fn unregister<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.global_shortcut().unregister(summon());
    let _ = app.global_shortcut().unregister(mind());
}

pub fn reveal_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
