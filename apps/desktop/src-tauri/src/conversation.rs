use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::Sidecars;

/// Replies are read aloud, so they are asked for as speech rather than as a document. The stripping
/// on the perception side is the backstop; this is the request.
///
/// How much thought a turn is given is judged from what was asked rather than fixed here. The
/// larger local model is not used: it holds ten gigabytes resident, which leaves too little memory
/// for the audio device to start at all. See MEASUREMENTS.
const VOICE: &str = "You are Kyuren, a personal assistant. You are being spoken to out loud, and \
your reply will be read back aloud. Answer in plain conversational prose. Never use markdown, \
headings, bullet points, numbered lists, code blocks, tables or decorative symbols. Keep it to two \
or three sentences unless more detail is clearly wanted. Be calm and precise, and say plainly when \
you do not know something.";

/// One turn: what was heard becomes what is said back.
pub fn on_transcript(app: &AppHandle, text: String) {
    let Some(state) = app.try_state::<Sidecars>() else {
        return;
    };
    let core = Arc::clone(&state.core);
    let app = app.clone();
    let turn = crate::speaking::begin(&app);

    tauri::async_runtime::spawn(async move {
        let _ = app.emit("orb:state", "thinking");

        // Said as it arrives, a sentence at a time, rather than read out once it is whole.
        let asked = json!({ "prompt": text, "system": VOICE, "speak": true, "id": &turn });
        let answered = core.request_untimed("agent.run", asked).await;
        if crate::speaking::settled(&app, &turn) {
            // Its words were heard out before it ended, which left the orb thinking.
            let _ = app.emit("orb:state", "listening");
        }
        let reply = match answered {
            Ok(result) => {
                // Which model answered, and why, is part of the answer. Degrading to a local model
                // because the network is gone is only honest if it is visible.
                if let Some(chosen) = chosen(&result) {
                    let _ = app.emit("agent:route", chosen);
                }
                answer_of(&result)
            }
            Err(failure) => {
                eprintln!("kyuren agent.run: {failure}");
                let _ = app.emit("orb:state", "listening");
                return;
            }
        };

        let Some(reply) = reply else {
            let _ = app.emit("orb:state", "listening");
            return;
        };

        let _ = app.emit("agent:reply", &reply);
    });
}

fn chosen(result: &Value) -> Option<Value> {
    let model = result.get("model")?.as_str()?;
    let reason = result.get("reason")?.as_str()?;
    Some(json!({ "model": model, "reason": reason }))
}

/// What a tool said should be spoken wins over what the model made of it. A brief is a report of
/// facts, and the smaller local model retells those facts wrongly.
fn answer_of(result: &Value) -> Option<String> {
    for key in ["spoken", "text"] {
        if let Some(said) = result.get(key).and_then(Value::as_str) {
            let said = said.trim();
            if !said.is_empty() {
                return Some(said.to_string());
            }
        }
    }
    None
}

/// Answering a permission question the user has resolved in the interface.
pub async fn answer_permission(app: &AppHandle, id: String, allow: bool) -> Result<Value, String> {
    let core = {
        let state = app.try_state::<Sidecars>().ok_or("sidecars not started")?;
        Arc::clone(&state.core)
    };

    let answered = core
        .request(
            "permission.answer",
            json!({ "id": id, "verdict": if allow { "allow" } else { "deny" } }),
            Duration::from_secs(10),
        )
        .await
        .map_err(|failure| failure.to_string())?;
    // Asked in the main window and on the island at once; answered in one, it is gone from both.
    let _ = app.emit("permission:answered", &id);
    Ok(answered)
}

pub fn forward(app: &AppHandle, event: &str, data: &Value) {
    match event {
        "permission.request" => {
            let _ = app.emit("permission", data);
        }
        "agent.say" => crate::speaking::said(app, data),
        "agent.say.end" => crate::speaking::ended(app, data),
        // A question whose turn was stopped no longer waits, in either window.
        "permission.withdrawn" => {
            if let Some(id) = data.get("id").and_then(Value::as_str) {
                let _ = app.emit("permission:answered", id);
            }
        }
        "voice.failed" | "asr.failed" | "vad.failed" | "refine.failed" | "oauth.failed" => {
            let reason = data.get("reason").and_then(Value::as_str).unwrap_or("unknown");
            let _ = app.emit("kyuren:trouble", format!("{event}: {reason}"));
            if event != "oauth.failed" {
                let _ = app.emit("orb:state", "listening");
            }
        }
        "agent.text" => {
            if let Some(chunk) = data.get("chunk").and_then(Value::as_str) {
                let id = data.get("id").and_then(Value::as_str).unwrap_or("default");
                let _ = app.emit("agent:text", json!({ "id": id, "chunk": chunk }));
            }
        }
        _ => {}
    }
}
