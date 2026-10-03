use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::settings::{read_settings, write_settings};
use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

/// Whether Kyuren listens for its name. Off by default, and written down so that a machine that
/// was listening when it was shut goes back to listening when it starts. How sure it must be is
/// not a setting: it belongs to the model, was chosen from the model's measured curves, and lives
/// beside it in the sidecar.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct Wake {
    pub on: bool,
}


pub fn wanted() -> Wake {
    read_settings().wake
}

fn perception<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Sidecar>> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.perception))
}

/// Starts or stops listening in the sidecar, according to a setting. Used at launch and by the
/// command below, so that what the setting says and what the microphone is doing agree.
pub async fn apply<R: Runtime>(app: &AppHandle<R>, wake: Wake) -> Result<Value, String> {
    let perception = perception(app).ok_or("perception is not running")?;
    let method = if wake.on { "wake.start" } else { "wake.stop" };
    perception
        .request(method, json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn wake_listen(app: AppHandle, on: bool) -> Result<Value, String> {
    let mut settings = read_settings();
    settings.wake = Wake { on };
    let answer = apply(&app, settings.wake).await?;
    write_settings(&settings)?;
    Ok(answer)
}

#[tauri::command]
pub async fn wake_state(app: AppHandle) -> Result<Value, String> {
    let perception = perception(&app).ok_or("perception is not running")?;
    let live = perception
        .request("wake.state", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())?;
    Ok(json!({ "wanted": wanted(), "live": live }))
}
