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
    // The Claude app opens a session of its own on its own link to it, rather than only coming forward.
    if let Some(link) = found.get("link").and_then(Value::as_str).filter(|link| crate::hosting::app_link(link)).map(str::to_string) {
        return tauri::async_runtime::spawn_blocking(move || crate::hosting::open_app_link(&link)).await.map_err(|failure| failure.to_string())?;
    }
    if let Some(pid) = found.get("pid").and_then(Value::as_i64).and_then(|pid| i32::try_from(pid).ok()) {
        return tauri::async_runtime::spawn_blocking(move || crate::hosting::reveal(pid)).await.map_err(|failure| failure.to_string())?;
    }
    if found.get("app").and_then(Value::as_str) != Some("claude") {
        return Err("that session is not running".into());
    }
    let (name, bundle) = crate::hosting::CLAUDE;
    tauri::async_runtime::spawn_blocking(move || crate::hosting::bring_forward(name, bundle)).await.map_err(|failure| failure.to_string())?
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
pub async fn coding_answer(
    app: AppHandle,
    window: tauri::Window,
    id: String,
    decision: String,
    picked: Option<Value>,
    mode: Option<String>,
    content: Option<Value>,
) -> Result<Value, String> {
    only_from(&window, crate::island::LABEL)?;
    let answer = answer_of(id, &decision, picked, mode, content)?;
    core(&app)?.request("coding.answer", answer, PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// The most an answer may carry: a few labels picked, or a short form's values.
const ANSWER_MOST: usize = 32 << 10;

/// An answer as the core is asked to give it. Whether what was picked or filled in fits the
/// question is the core's to judge, against the question it holds; here it is only an answer at all,
/// and small.
fn answer_of(id: String, decision: &str, picked: Option<Value>, mode: Option<String>, content: Option<Value>) -> Result<Value, String> {
    if !matches!(decision, "allow" | "deny" | "ask") {
        return Err(format!("{decision} is not an answer"));
    }
    let mut answer = json!({ "id": id, "decision": decision });
    if let Some(mode) = mode {
        if !matches!(mode.as_str(), "acceptEdits" | "default") {
            return Err(format!("{mode} is not a mode a plan goes on in"));
        }
        answer["mode"] = json!(mode);
    }
    for (key, value) in [("picked", picked), ("content", content)] {
        let Some(value) = value else { continue };
        if !value.is_object() || value.to_string().len() > ANSWER_MOST {
            return Err(format!("what was {} is not an answer", if key == "picked" { "picked" } else { "filled in" }));
        }
        answer[key] = value;
    }
    Ok(answer)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_answer_carries_what_was_picked_the_mode_or_a_forms_values() {
        let picked = json!({ "Which framework?": ["Vue"] });
        assert_eq!(
            answer_of("a".into(), "allow", Some(picked.clone()), None, None).expect("an answer"),
            json!({ "id": "a", "decision": "allow", "picked": picked })
        );
        assert_eq!(
            answer_of("p".into(), "allow", None, Some("acceptEdits".into()), None).expect("an answer"),
            json!({ "id": "p", "decision": "allow", "mode": "acceptEdits" })
        );
        assert_eq!(answer_of("q".into(), "ask", None, None, None).expect("an answer"), json!({ "id": "q", "decision": "ask" }));
    }

    #[test]
    fn what_is_no_answer_is_refused_before_it_reaches_the_core() {
        assert!(answer_of("a".into(), "maybe", None, None, None).is_err());
        assert!(answer_of("a".into(), "allow", None, Some("bypassPermissions".into()), None).is_err(), "no mode beyond the two a plan is approved in");
        assert!(answer_of("a".into(), "allow", Some(json!(["Vue"])), None, None).is_err(), "picks are by question");
        let long = json!({ "title": "x".repeat(ANSWER_MOST) });
        assert!(answer_of("a".into(), "allow", None, None, Some(long)).is_err());
    }
}
