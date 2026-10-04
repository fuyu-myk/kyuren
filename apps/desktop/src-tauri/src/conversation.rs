use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::Sidecars;

/// Long enough for a local model to think, and for its first run to load.
const SPEAKING: Duration = Duration::from_secs(180);

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
    let perception = Arc::clone(&state.perception);
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        let _ = app.emit("orb:state", "thinking");

        let reply = match core
            .request_untimed("agent.run", json!({ "prompt": text, "system": VOICE }))
            .await
        {
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
        if let Err(failure) = perception
            .request("voice.say", json!({ "text": reply }), SPEAKING)
            .await
        {
            eprintln!("kyuren voice.say: {failure}");
            let _ = app.emit("orb:state", "listening");
        }
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
        "voice.failed" | "asr.failed" | "vad.failed" | "refine.failed" | "oauth.failed" => {
            let reason = data.get("reason").and_then(Value::as_str).unwrap_or("unknown");
            let _ = app.emit("kyuren:trouble", format!("{event}: {reason}"));
            if event != "oauth.failed" {
                let _ = app.emit("orb:state", "listening");
            }
        }
        "agent.text" => {
            if let Some(chunk) = data.get("chunk").and_then(Value::as_str) {
                let _ = app.emit("agent:text", chunk);
            }
        }
        _ => {}
    }
}
