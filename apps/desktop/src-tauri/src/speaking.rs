use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::state::{Sidecars, PING_TIMEOUT, SPEAK_TIMEOUT};

/// What the voice is told for a spoken turn, in the order the core said it.
#[derive(Debug, Clone, PartialEq)]
pub enum Line {
    /// Whatever is being said gives way to a new turn.
    Hush,
    Add(String),
    End,
}

/// Which spoken turn is being said. A turn talked over, dismissed or replaced goes on saying things
/// for a moment after it is stopped, and none of that is spoken.
#[derive(Debug, Default)]
pub struct Current {
    turn: Option<String>,
    count: u64,
}

impl Current {
    /// A new spoken turn takes over; the one it replaces, if any, is to be stopped.
    pub fn begin(&mut self) -> (String, Option<String>) {
        self.count += 1;
        let id = format!("voice:{}", self.count);
        let previous = self.turn.replace(id.clone());
        (id, previous)
    }

    pub fn is(&self, id: &str) -> bool {
        self.turn.as_deref() == Some(id)
    }

    /// Talked over or dismissed: nothing more of it is said, and it is to be stopped.
    pub fn interrupt(&mut self) -> Option<String> {
        self.turn.take()
    }
}

struct Saying {
    current: Mutex<Current>,
    lines: UnboundedSender<(String, Line)>,
}

fn is_current(app: &AppHandle, turn: &str) -> bool {
    app.try_state::<Saying>()
        .and_then(|saying| saying.current.lock().ok().map(|current| current.is(turn)))
        .unwrap_or(false)
}

/// Starts the line to the voice: one request at a time, so what is said keeps its order.
pub fn install(app: &AppHandle) {
    let (lines, mut waiting) = unbounded_channel::<(String, Line)>();
    app.manage(Saying { current: Mutex::new(Current::default()), lines });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some((turn, line)) = waiting.recv().await {
            // Judged as it is sent rather than as it was queued: a turn stopped since says no more.
            if !is_current(&app, &turn) {
                continue;
            }
            let Some(perception) = app.try_state::<Sidecars>().map(|state| Arc::clone(&state.perception)) else {
                continue;
            };
            let (method, params) = match line {
                Line::Hush => ("voice.stop", json!({})),
                Line::Add(text) => ("voice.add", json!({ "text": text })),
                Line::End => ("voice.end", json!({})),
            };
            if let Err(failure) = perception.request(method, params, SPEAK_TIMEOUT).await {
                eprintln!("kyuren {method}: {failure}");
            }
        }
    });
}

fn send(app: &AppHandle, turn: String, line: Line) {
    if let Some(saying) = app.try_state::<Saying>() {
        if saying.lines.send((turn, line)).is_err() {
            eprintln!("kyuren speaking: the line to the voice has closed");
        }
    }
}

/// A spoken turn begins under a name of its own: what was being said gives way, and the turn it
/// replaces is stopped.
pub fn begin(app: &AppHandle) -> String {
    let begun = app
        .try_state::<Saying>()
        .and_then(|saying| saying.current.lock().ok().map(|mut current| current.begin()));
    // Without the line to the voice installed nothing is said, though the turn still runs.
    let Some((turn, previous)) = begun else {
        return "voice".to_string();
    };
    send(app, turn.clone(), Line::Hush);
    if let Some(previous) = previous {
        stop(app, previous);
    }
    turn
}

/// A sentence the core says for a spoken turn.
pub fn said(app: &AppHandle, data: &Value) {
    let (Some(turn), Some(text)) = (data.get("id").and_then(Value::as_str), data.get("text").and_then(Value::as_str)) else {
        return;
    };
    if is_current(app, turn) {
        send(app, turn.to_string(), Line::Add(text.to_string()));
    }
}

/// The core has said all it will for a spoken turn.
pub fn ended(app: &AppHandle, data: &Value) {
    let Some(turn) = data.get("id").and_then(Value::as_str) else {
        return;
    };
    if is_current(app, turn) {
        send(app, turn.to_string(), Line::End);
    }
}

/// Talked over or dismissed: the spoken turn is stopped and says nothing more.
pub fn interrupt(app: &AppHandle) {
    let stopped = app
        .try_state::<Saying>()
        .and_then(|saying| saying.current.lock().ok().and_then(|mut current| current.interrupt()));
    if let Some(turn) = stopped {
        stop(app, turn);
    }
}

fn stop(app: &AppHandle, turn: String) {
    let Some(core) = app.try_state::<Sidecars>().map(|state| Arc::clone(&state.core)) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        if let Err(failure) = core.request("agent.stop", json!({ "id": turn }), PING_TIMEOUT).await {
            eprintln!("kyuren agent.stop: {failure}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_spoken_turn_takes_over_and_names_the_one_it_replaces() {
        let mut current = Current::default();
        let (first, replaced) = current.begin();
        assert_eq!(replaced, None);
        assert!(current.is(&first));
        let (second, replaced) = current.begin();
        assert_ne!(first, second);
        assert_eq!(replaced.as_deref(), Some(first.as_str()));
        assert!(current.is(&second));
        assert!(!current.is(&first), "what the replaced turn still says is not spoken");
    }

    #[test]
    fn a_turn_talked_over_says_nothing_more_and_is_stopped_once() {
        let mut current = Current::default();
        let (turn, _) = current.begin();
        assert_eq!(current.interrupt().as_deref(), Some(turn.as_str()));
        assert!(!current.is(&turn));
        assert_eq!(current.interrupt(), None, "nothing is left to stop");
    }
}
