use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

/// Installing reads, copies and writes a few small files.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15);

fn core(app: &AppHandle) -> Result<Arc<Sidecar>, String> {
    app.try_state::<Sidecars>().map(|state| Arc::clone(&state.core)).ok_or_else(|| "cognition is not running".to_string())
}

/// Each window may do only what it is for: the island answers questions, and only settings, in the
/// main window, change another program's configuration.
fn only_from(window: &tauri::Window, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err(format!("only the {label} window can do that"))
    }
}

/// The coding agents' sessions running on this Mac, as the core last saw them, for an island that
/// has just loaded. Changes arrive after that as `coding:sessions`.
#[tauri::command]
pub async fn coding_sessions(app: AppHandle) -> Result<Value, String> {
    core(&app)?.request("coding.sessions", json!({}), PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// What a coding session is doing, read from its transcript when the island shows it: everything
/// the first time, then what changed since the reading the island already has. Only the island
/// asks, since a transcript holds the commands and changes of the user's own work.
#[tauri::command]
pub async fn coding_detail(
    app: AppHandle,
    window: tauri::Window,
    session: String,
    harness: Option<String>,
    since: Option<u64>,
    epoch: Option<String>,
) -> Result<Value, String> {
    only_from(&window, crate::island::LABEL)?;
    let params = json!({ "session": session, "harness": harness, "since": since, "epoch": epoch });
    core(&app)?.request("coding.detail", params, PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// One step of a coding session opened on the island, or of an agent it handed work to: a command
/// whole, and what it printed whole when `whole` asks for it.
#[tauri::command]
pub async fn coding_step(
    app: AppHandle,
    window: tauri::Window,
    session: String,
    step: String,
    agent: Option<String>,
    whole: Option<bool>,
) -> Result<Value, String> {
    only_from(&window, crate::island::LABEL)?;
    let params = json!({ "session": session, "step": step, "agent": agent, "whole": whole.unwrap_or(false) });
    core(&app)?.request("coding.step", params, PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// Brings forward the app a coding session runs in, Claude's desktop app or an editor, found from
/// the session's own process, which the core gives only for a session it knows to be running.
#[tauri::command]
pub async fn coding_reveal(app: AppHandle, window: tauri::Window, session: String) -> Result<String, String> {
    only_from(&window, crate::island::LABEL)?;
    let found = core(&app)?.request("coding.where", json!({ "session": session }), PING_TIMEOUT).await.map_err(|failure| failure.to_string())?;
    let pid = found.get("pid").and_then(Value::as_i64).and_then(|pid| i32::try_from(pid).ok()).ok_or("that session is not running")?;
    tauri::async_runtime::spawn_blocking(move || crate::hosting::reveal(pid)).await.map_err(|failure| failure.to_string())?
}

/// The questions coding agents are waiting on the island for, for an island that has just loaded.
#[tauri::command]
pub async fn coding_asks(app: AppHandle) -> Result<Value, String> {
    core(&app)?.request("coding.asks", json!({}), PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// The island has a coding agent's question in front of the user, so it is held for its whole wait.
#[tauri::command]
pub async fn coding_seen(app: AppHandle, window: tauri::Window, id: String) -> Result<Value, String> {
    only_from(&window, crate::island::LABEL)?;
    core(&app)?.request("coding.seen", json!({ "id": id }), PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// The user's answer to a coding agent's question: allow, deny, or ask, which hands it back to the
/// agent's own prompt.
#[tauri::command]
pub async fn coding_answer(app: AppHandle, window: tauri::Window, id: String, decision: String) -> Result<Value, String> {
    only_from(&window, crate::island::LABEL)?;
    if !matches!(decision.as_str(), "allow" | "deny" | "ask") {
        return Err(format!("{decision} is not an answer"));
    }
    core(&app)?.request("coding.answer", json!({ "id": id, "decision": decision }), PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// Whether Claude Code's permission prompts come to the island.
#[tauri::command]
pub async fn coding_hooks(app: AppHandle) -> Result<Value, String> {
    core(&app)?.request("coding.hooks", json!({}), PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// Puts the permission hook into Claude Code's settings, or takes it out. Only ever asked for by
/// the user, in settings: it edits another program's configuration.
#[tauri::command]
pub async fn coding_hooks_set(app: AppHandle, window: tauri::Window, on: bool) -> Result<Value, String> {
    only_from(&window, "main")?;
    core(&app)?.request("coding.hooks.set", json!({ "on": on }), INSTALL_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// A coding agent's question, from the core to the island. With the island's questions page
/// switched off nobody would see it, so it is handed straight back to the agent's own prompt
/// rather than keeping the agent waiting.
pub fn on_ask(app: &AppHandle, data: &Value) {
    if crate::island::island_tabs().iter().any(|tab| tab == "permissions") {
        let _ = app.emit_to(crate::island::LABEL, "agent:permission", data);
        return;
    }
    let Some(id) = data.get("id").and_then(Value::as_str).map(str::to_string) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(core) = core(&app) {
            let _ = core.request("coding.answer", json!({ "id": id, "decision": "ask" }), PING_TIMEOUT).await;
        }
    });
}
