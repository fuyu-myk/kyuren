use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

/// Connecting a folder reads and embeds every note in it, which for notes kept over years is
/// minutes rather than seconds.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1800);

fn core(app: &AppHandle) -> Result<Arc<Sidecar>, String> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.core))
        .ok_or_else(|| "cognition is not running".to_string())
}

#[tauri::command]
pub async fn vaults_list(app: AppHandle) -> Result<Value, String> {
    core(&app)?
        .request("memory.vaults", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// Read only unless asked for otherwise, and the asking is the core's to judge.
#[tauri::command]
pub async fn vault_connect(app: AppHandle, path: String, mode: Option<String>) -> Result<Value, String> {
    let params = match mode {
        Some(mode) => json!({ "path": path, "mode": mode }),
        None => json!({ "path": path }),
    };
    core(&app)?
        .request("memory.connect", params, CONNECT_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn vault_disconnect(app: AppHandle, path: String) -> Result<Value, String> {
    core(&app)?
        .request("memory.disconnect", json!({ "path": path }), CONNECT_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn vault_mode(app: AppHandle, path: String, mode: String) -> Result<Value, String> {
    core(&app)?
        .request("memory.mode", json!({ "path": path, "mode": mode }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}
