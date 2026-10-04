use serde_json::{json, Value};
use tauri::State;

use crate::state::{Sidecars, GATHER_TIMEOUT, PING_TIMEOUT};

async fn asked(
    sidecars: &Sidecars,
    method: &str,
    params: Value,
    patience: std::time::Duration,
) -> Result<Value, String> {
    sidecars
        .core
        .request(method, params, patience)
        .await
        .map_err(|failure| failure.to_string())
}

/// Every session, or one pane's, most recently touched first.
#[tauri::command]
pub async fn session_list(
    pane: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    asked(&sidecars, "session.list", json!({ "pane": pane }), PING_TIMEOUT).await
}

#[tauri::command]
pub async fn session_read(id: String, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "session.read", json!({ "id": id }), PING_TIMEOUT).await
}

#[tauri::command]
pub async fn session_start(
    pane: String,
    title: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    let params = json!({ "pane": pane, "title": title });
    asked(&sidecars, "session.start", params, PING_TIMEOUT).await
}

/// The route the user chose for a session, or none, meaning the router decides.
#[tauri::command]
pub async fn session_prefer(
    id: String,
    route: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    let params = json!({ "id": id, "route": route });
    asked(&sidecars, "session.prefer", params, PING_TIMEOUT).await
}

#[tauri::command]
pub async fn session_rename(
    id: String,
    title: String,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    let params = json!({ "id": id, "title": title });
    asked(&sidecars, "session.rename", params, PING_TIMEOUT).await
}

#[tauri::command]
pub async fn session_forget(id: String, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "session.forget", json!({ "id": id }), PING_TIMEOUT).await
}

/// Asking Kyuren something in writing. A session carries the conversation; a pane without one
/// starts a session to hold it.
#[tauri::command]
pub async fn ask(
    prompt: String,
    session: Option<String>,
    pane: Option<String>,
    route: Option<String>,
    id: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    if prompt.trim().is_empty() {
        return Err("there is nothing there to ask".into());
    }
    let params = json!({ "prompt": prompt, "session": session, "pane": pane, "route": route, "id": id });
    sidecars
        .core
        .request_untimed("agent.run", params)
        .await
        .map_err(|failure| failure.to_string())
}

/// Stops a turn in progress by the name the window that started it gave it, so no window stops
/// another's. The turn itself then answers, as stopped.
#[tauri::command]
pub async fn stop_turn(id: String, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "agent.stop", json!({ "id": id }), PING_TIMEOUT).await
}

/// The routes a turn may take and the model behind each.
#[tauri::command]
pub async fn model_options(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "model.options", json!({}), GATHER_TIMEOUT).await
}

/// Where every project stands. Read from disk a handful at a time and held for a moment, so the
/// pane can ask as often as it likes.
#[tauri::command]
pub async fn project_board(
    fresh: Option<bool>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    let params = json!({ "fresh": fresh.unwrap_or(false) });
    asked(&sidecars, "projects.board", params, GATHER_TIMEOUT).await
}

/// What Kyuren has taught itself, and what standing each of those things has.
#[tauri::command]
pub async fn skills_list(
    state: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    asked(&sidecars, "skills.list", json!({ "state": state }), PING_TIMEOUT).await
}

/// Approving a skill. Reachable only from the window: the model has tools, and none of them is
/// this one.
#[tauri::command]
pub async fn skill_approve(id: String, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "skills.approve", json!({ "id": id }), PING_TIMEOUT).await
}

#[tauri::command]
pub async fn skill_forget(id: String, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "skills.forget", json!({ "id": id }), PING_TIMEOUT).await
}

/// What Kyuren can do, and which pane each thing belongs to.
#[tauri::command]
pub async fn known_capabilities(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "capabilities.known", json!({}), PING_TIMEOUT).await
}
