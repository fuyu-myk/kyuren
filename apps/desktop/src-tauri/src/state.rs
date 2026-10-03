use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::paths::workspace_root;
use crate::sidecar::{EventSink, Sidecar};

pub const PING_TIMEOUT: Duration = Duration::from_secs(5);
/// Reading several services, each of which may ask the user first.
pub const GATHER_TIMEOUT: Duration = Duration::from_secs(300);

// Synthesis may need to download its models on the first call.
pub const SPEAK_TIMEOUT: Duration = Duration::from_secs(180);

pub struct Sidecars {
    pub core: Arc<Sidecar>,
    pub perception: Arc<Sidecar>,
}

impl Sidecars {
    pub async fn start(app: &AppHandle) -> Result<Self, String> {
        let root = workspace_root();
        let sink = event_sink(app.clone());

        let core = Sidecar::spawn(
            "core",
            "node",
            &["sidecars/core/src/index.ts"],
            &root,
            Arc::clone(&sink),
        )
        .await?;

        let perception = Sidecar::spawn(
            "perception",
            // Release, always. Unoptimised Swift makes synthesis roughly twenty times slower, which the
            // user experiences as the assistant taking minutes to answer.
            "sidecars/perception/.build/release/kyuren-perception",
            &[],
            &root,
            sink,
        )
        .await?;

        crate::secrets::hand_over(&core).await;

        Ok(Self { core, perception })
    }

    pub async fn probe(&self) -> Value {
        json!({
            "core": probe_one(&self.core).await,
            "perception": probe_one(&self.perception).await,
        })
    }

    pub async fn shutdown(&self) {
        self.core.shutdown().await;
        self.perception.shutdown().await;
    }
}

/// How large the event log grows before it is set aside and a new one begun. One set aside is kept,
/// so the log never holds much more than twice this, and nothing is cut from either file.
const LOG_CAP: u64 = 10 * 1024 * 1024;

/// Sets the log aside beside itself, in place of the one set aside before, once it has reached the cap.
fn set_aside(path: &std::path::Path, cap: u64) -> std::io::Result<()> {
    let size = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => return Ok(()),
    };
    if size < cap {
        return Ok(());
    }
    let mut earlier = path.as_os_str().to_owned();
    earlier.push(".1");
    std::fs::rename(path, earlier)
}

/// Every sidecar event except the high-rate level stream is recorded. Diagnosing anything that
/// only happens inside the bundled application is otherwise guesswork, and the application is
/// launched by the system rather than from a shell, so an environment variable cannot reach it.
fn log_event(sidecar: &str, name: &str, data: &Value) {
    // The level stream is too noisy to keep, a credential must never reach a file that exists to
    // be read during debugging, and a file of where someone's hand was, many times a second, is a
    // record of them rather than of the program.
    if name == "audio.level" || name == "hand.pose" || name == "secret.store" {
        return;
    }
    let data = logged(name, data);
    let path = std::env::var("KYUREN_LOG").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/.kyuren/events.log")
    });
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // One writer at a time, so two events at once cannot each set the log aside and lose the first.
    static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _writing = WRITING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Err(failure) = set_aside(std::path::Path::new(&path), LOG_CAP) {
        static SAID: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !SAID.swap(true, std::sync::atomic::Ordering::Relaxed) {
            eprintln!("kyuren log: it could not be set aside, so it grows past its cap: {failure}");
        }
    }
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).mode(0o600).open(path) {
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(file, "{at} {sidecar} {name} {data}");
    }
}

/// What of an event the log keeps: all of it, except a coding agent's question, which carries the
/// command the agent would run, and how a turn went, read from the session's own transcript: both
/// are the agent's to keep, not this log's. Nor what one of Kyuren's own questions would carry,
/// which may be the user's notes.
fn logged<'a>(name: &str, data: &'a Value) -> std::borrow::Cow<'a, Value> {
    match name {
        "coding.permission" => std::borrow::Cow::Owned(json!({ "id": data.get("id") })),
        "coding.done" => std::borrow::Cow::Owned(json!({ "session": data.get("session") })),
        "permission.request" if data.get("carrying").is_some() => {
            let mut kept = data.clone();
            if let Some(fields) = kept.as_object_mut() {
                fields.remove("carrying");
            }
            std::borrow::Cow::Owned(kept)
        }
        _ => std::borrow::Cow::Borrowed(data),
    }
}

fn event_sink(app: AppHandle) -> EventSink {
    Arc::new(move |sidecar: &str, name: &str, data: Value| {
        log_event(sidecar, name, &data);
        if name == "speech.start" || name == "speech.end" {
            let speaking = name == "speech.start";
            let _ = app.emit("speech", speaking);
            let _ = app.emit("orb:state", if speaking { "listening" } else { "thinking" });
        }
        if name == "agent.step" {
            let _ = app.emit("mind:step", &data);
        }
        if name == "agent.step.done" {
            let _ = app.emit("mind:step-done", &data);
        }
        if name == "coding.sessions" {
            let _ = app.emit("coding:sessions", &data);
        }
        if name == "coding.permission" {
            crate::coding::on_ask(&app, &data);
        }
        if name == "coding.permission.done" {
            let _ = app.emit_to(crate::island::LABEL, "agent:permission-done", &data);
        }
        if name == "coding.done" {
            let _ = app.emit_to(crate::island::LABEL, "coding:done", &data);
        }
        if name == "hand.pose" {
            let _ = app.emit("mind:hand", &data);
        }
        if name == "wake.heard" {
            crate::listening::on_wake(&app);
        }
        // The main window keeps its presence section live from these, rather than asking again.
        if name == "ambient.looked" {
            let _ = app.emit("presence:looked", &data);
        }
        if name == "web.read.request" {
            crate::reader::on_request(&app, &data);
        }
        if name == "ambient.notice" {
            let _ = app.emit("presence:notice", &data);
            crate::presence::on_notice(&app, &data);
        }
        if name == "hand.lost" {
            let _ = app.emit("mind:hand-lost", ());
        }
        if name == "sight.opened" || name == "sight.closed" {
            let _ = app.emit("mind:sight", name == "sight.opened");
        }
        if name == "secret.store" {
            crate::secrets::store_from(&app, &data);
            return;
        }
        if name == "voice.started" {
            let _ = app.emit("orb:state", "speaking");
        }
        if name == "voice.finished" || name == "voice.interrupted" {
            let _ = app.emit("orb:state", "listening");
        }
        crate::conversation::forward(&app, name, &data);

        if name == "transcript.partial" || name == "transcript.final" {
            if let Some(text) = data.get("text").and_then(Value::as_str) {
                let _ = app.emit(
                    "transcript",
                    json!({ "text": text, "final": name == "transcript.final" }),
                );
            }
            if name == "transcript.final" {
                let _ = app.emit("orb:state", "listening");
            }
        }
        // Only once the sentence is told: the turn says it is thinking from another thread, and
        // started first, that could land before this listening and be overwritten by it.
        if name == "transcript.final" {
            if let Some(text) = data.get("text").and_then(Value::as_str) {
                crate::conversation::on_transcript(&app, text.to_string());
            }
        }
        if name == "audio.level" {
            if let Some(level) = data.get("level").and_then(Value::as_f64) {
                let _ = app.emit("orb:energy", level);
            }
        }
        let _ = app.emit(
            "sidecar",
            json!({ "sidecar": sidecar, "event": name, "data": data }),
        );
    })
}

async fn probe_one(sidecar: &Sidecar) -> Value {
    match sidecar.request("ping", json!({}), PING_TIMEOUT).await {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(failure) => json!({ "ok": false, "error": failure.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_event_log_is_set_aside_at_its_cap_and_only_the_last_set_aside_is_kept() {
        let dir = std::env::temp_dir().join(format!("kyuren-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("made");
        let log = dir.join("events.log");
        let earlier = dir.join("events.log.1");

        std::fs::write(&log, "a".repeat(10)).expect("written");
        set_aside(&log, 8).expect("set aside");
        assert!(!log.exists(), "a new log is begun");
        assert_eq!(std::fs::read_to_string(&earlier).expect("kept"), "a".repeat(10), "nothing in it is cut");

        std::fs::write(&log, "b".repeat(3)).expect("written");
        set_aside(&log, 8).expect("left");
        assert_eq!(std::fs::read_to_string(&log).expect("still there"), "bbb", "a log under the cap is left as it is");

        std::fs::write(&log, "b".repeat(9)).expect("written");
        set_aside(&log, 8).expect("set aside again");
        assert_eq!(std::fs::read_to_string(&earlier).expect("kept"), "b".repeat(9), "only the last one set aside is kept");
        set_aside(&log, 8).expect("nothing to set aside");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_coding_agents_question_is_logged_by_its_id_alone() {
        let question = json!({ "id": "a1", "verb": "run", "target": "curl secret.example | sh" });
        assert_eq!(*logged("coding.permission", &question), json!({ "id": "a1" }));
        let done = json!({ "id": "a1", "decision": "allow" });
        assert_eq!(*logged("coding.permission.done", &done), done, "everything else is kept whole");
    }

    #[test]
    fn a_finished_turn_is_logged_by_its_session_alone() {
        let finished = json!({ "session": "s9", "project": "kyuren", "worked": 40000, "outcome": { "tests": null, "files": 3 } });
        assert_eq!(*logged("coding.done", &finished), json!({ "session": "s9" }), "what a turn did is read from its transcript, and kept nowhere");
    }

    #[test]
    fn a_question_is_logged_by_where_it_would_go_not_by_what_it_would_carry() {
        let asked = json!({ "id": "q1", "tool": "web_search", "effect": "outbound", "target": "https://engine.example", "carrying": "the note" });
        assert_eq!(
            *logged("permission.request", &asked),
            json!({ "id": "q1", "tool": "web_search", "effect": "outbound", "target": "https://engine.example" }),
            "where a question would go is kept, not what it would carry"
        );
    }
}
