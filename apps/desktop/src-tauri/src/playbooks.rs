use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::sidecar::Sidecar;
use std::time::Duration;

use crate::state::{Sidecars, PING_TIMEOUT};

/// A run reads, thinks and writes, and one that researches reads the web; minutes, not seconds.
const RUN_TIMEOUT: Duration = Duration::from_secs(900);

fn core(app: &AppHandle) -> Result<Arc<Sidecar>, String> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.core))
        .ok_or_else(|| "cognition is not running".to_string())
}

#[tauri::command]
pub async fn playbooks_list(app: AppHandle) -> Result<Value, String> {
    core(&app)?
        .request("playbook.list", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn playbook_read(app: AppHandle, name: String) -> Result<Value, String> {
    core(&app)?
        .request("playbook.read", json!({ "name": name }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// Approval is the user's alone, so it is a command from the window and never a tool.
#[tauri::command]
pub async fn playbook_approve(app: AppHandle, name: String) -> Result<Value, String> {
    core(&app)?
        .request("playbook.approve", json!({ "name": name }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn playbook_reject(app: AppHandle, name: String) -> Result<Value, String> {
    core(&app)?
        .request("playbook.reject", json!({ "name": name }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn playbook_runs(app: AppHandle, name: String) -> Result<Value, String> {
    core(&app)?
        .request("playbook.runs", json!({ "name": name }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// A repair reads the failed run and proposes an edit that waits like any other; it may take a
/// while, since the cloud model reads the whole log.
#[tauri::command]
pub async fn playbook_repair(app: AppHandle, name: String) -> Result<Value, String> {
    core(&app)?
        .request("playbook.repair", json!({ "name": name }), crate::state::GATHER_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// A slash command: the playbook by name and the words typed after it.
#[tauri::command]
pub async fn playbook_invoke(app: AppHandle, name: String, text: String, pane: Option<String>) -> Result<Value, String> {
    core(&app)?
        .request("playbook.invoke", json!({ "name": name, "text": text, "pane": pane }), RUN_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn research_notes(app: AppHandle) -> Result<Value, String> {
    core(&app)?
        .request("research.notes", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn research_read(app: AppHandle, slug: String) -> Result<Value, String> {
    core(&app)?
        .request("research.read", json!({ "slug": slug }), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}
