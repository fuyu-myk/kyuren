use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT, SPEAK_TIMEOUT};

fn core(app: &AppHandle) -> Option<Arc<Sidecar>> {
    app.try_state::<Sidecars>().map(|state| Arc::clone(&state.core))
}

/// Something a rule the user wrote says may reach them. It is shown on the orb for a moment, and
/// spoken only if the rule said it may speak.
pub fn on_notice(app: &AppHandle, data: &Value) {
    let voice = data.get("voice").and_then(Value::as_bool).unwrap_or(false);
    let title = data.get("title").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let why = data.get("why").and_then(Value::as_str).unwrap_or("").trim().to_string();

    if !voice || title.is_empty() {
        return;
    }
    let Some(perception) = app
        .try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.perception))
    else {
        return;
    };
    let said = if why.is_empty() { format!("{title}.") } else { format!("{title}, {why}.") };
    tauri::async_runtime::spawn(async move {
        if let Err(failure) = perception
            .request("voice.say", json!({ "text": said }), SPEAK_TIMEOUT)
            .await
        {
            eprintln!("kyuren ambient voice.say: {failure}");
        }
    });
}

#[tauri::command]
pub async fn ambient_state(app: AppHandle) -> Result<Value, String> {
    let core = core(&app).ok_or("cognition is not running")?;
    core.request("ambient.state", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn ambient_recent(app: AppHandle, limit: Option<u32>) -> Result<Value, String> {
    let core = core(&app).ok_or("cognition is not running")?;
    core.request("ambient.recent", json!({ "limit": limit.unwrap_or(20) }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// One look now, for trying a rule out without waiting for the next look.
#[tauri::command]
pub async fn ambient_look(app: AppHandle) -> Result<Value, String> {
    let core = core(&app).ok_or("cognition is not running")?;
    core.request("ambient.look", json!({}), crate::state::GATHER_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}
