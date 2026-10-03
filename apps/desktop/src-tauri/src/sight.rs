use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

fn perception<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Sidecar>> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.perception))
}

#[tauri::command]
pub async fn start_vision(app: AppHandle) -> Result<Value, String> {
    let perception = perception(&app).ok_or("perception is not running")?;
    perception
        .request("sight.start", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn stop_vision(app: AppHandle) -> Result<Value, String> {
    let perception = perception(&app).ok_or("perception is not running")?;
    perception
        .request("sight.stop", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// Closes the camera without being asked to, for every way out of the mind that is not the button.
/// The light beside the camera is the only honest account of whether it is on, so nothing that
/// puts the mind away may leave it running.
pub fn close<R: Runtime>(app: &AppHandle<R>) {
    let Some(perception) = perception(app) else { return };
    tauri::async_runtime::spawn(async move {
        let _ = perception.request("sight.stop", json!({}), PING_TIMEOUT).await;
    });
}

/// Answering the screen recording prompt is part of the first capture, so this waits on a person
/// rather than on a machine.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(60);

/// One frame of the screen, on request and never otherwise. It is written to this machine and
/// handed back as a path: no capture is sent to a model, here or anywhere else.
#[tauri::command]
pub async fn capture_screen(app: AppHandle) -> Result<Value, String> {
    let perception = perception(&app).ok_or("perception is not running")?;
    perception
        .request("screen.capture", json!({}), CAPTURE_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}
