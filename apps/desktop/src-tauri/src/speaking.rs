use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::state::{Sidecars, PING_TIMEOUT, SPEAK_TIMEOUT};

/// What the voice is told, in the order it was told.
#[derive(Debug, Clone, PartialEq)]
pub enum Line {
    /// Whatever is being said, and whatever waits to be said, gives way.
    Hush,
    Add(String),
    End,
    /// Something said in its own right, after whatever is being said.
    Say(String),
}

impl Line {
    fn request(self) -> (&'static str, Value) {
        match self {
            Line::Hush => ("voice.stop", json!({})),
            Line::Add(text) => ("voice.add", json!({ "text": text })),
            Line::End => ("voice.end", json!({})),
            Line::Say(text) => ("voice.say", json!({ "text": text })),
        }
    }
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

    /// Whether a line is still to be sent: a turn's only while that turn is the one being said, one
    /// of no turn always.
    pub fn wants(&self, turn: Option<&str>) -> bool {
        turn.is_none_or(|turn| self.is(turn))
    }
}

struct Saying {
    current: Mutex<Current>,
    lines: UnboundedSender<(Option<String>, Line)>,
}

fn wanted(app: &AppHandle, turn: Option<&str>) -> bool {
    app.try_state::<Saying>()
        .and_then(|saying| saying.current.lock().ok().map(|current| current.wants(turn)))
        .unwrap_or(false)
}

/// Starts the line to the voice: one request at a time, so what is said keeps its order.
pub fn install(app: &AppHandle) {
    let (lines, mut waiting) = unbounded_channel::<(Option<String>, Line)>();
    app.manage(Saying { current: Mutex::new(Current::default()), lines });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some((turn, line)) = waiting.recv().await {
            // Judged as it is sent rather than as it was queued: a turn stopped since says no more.
            if !wanted(&app, turn.as_deref()) {
                continue;
            }
            let Some(perception) = app.try_state::<Sidecars>().map(|state| Arc::clone(&state.perception)) else {
                continue;
            };
            let (method, params) = line.request();
            if let Err(failure) = perception.request(method, params, SPEAK_TIMEOUT).await {
                eprintln!("kyuren {method}: {failure}");
            }
        }
    });
}

fn send(app: &AppHandle, turn: Option<String>, line: Line) {
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
    send(app, Some(turn.clone()), Line::Hush);
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
    if wanted(app, Some(turn)) {
        send(app, Some(turn.to_string()), Line::Add(text.to_string()));
    }
}

/// The core has said all it will for a spoken turn.
pub fn ended(app: &AppHandle, data: &Value) {
    let Some(turn) = data.get("id").and_then(Value::as_str) else {
        return;
    };
    settled(app, turn);
}

/// A spoken turn is over however it went, so the voice is not left waiting on it: a core that dies
/// part way through a reply never says it has finished.
pub fn settled(app: &AppHandle, turn: &str) {
    if wanted(app, Some(turn)) {
        send(app, Some(turn.to_string()), Line::End);
    }
}

/// Something to be said in its own right, such as a notice, after whatever is being said.
pub fn notice(app: &AppHandle, text: String) {
    send(app, None, Line::Say(text));
}

/// Talked over or dismissed: the spoken turn is stopped and says nothing more.
pub fn interrupt(app: &AppHandle) {
    let stopped = app
        .try_state::<Saying>()
        .and_then(|saying| saying.current.lock().ok().and_then(|mut current| current.interrupt()));
    // A sentence already on its way when the voice stopped would begin again, so it is stopped too.
    send(app, None, Line::Hush);
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

    #[test]
    fn only_the_turn_being_said_is_sent_on_and_what_belongs_to_no_turn_always_is() {
        let mut current = Current::default();
        assert!(current.wants(None), "a notice, or a stop, with nothing being said");
        let (first, _) = current.begin();
        assert!(current.wants(Some(&first)));
        let (second, _) = current.begin();
        assert!(!current.wants(Some(&first)), "a replaced turn's lines are dropped");
        assert!(current.wants(Some(&second)));
        current.interrupt();
        assert!(!current.wants(Some(&second)), "nor is anything sent for a turn talked over");
        assert!(current.wants(None), "but the stop that follows it is");
    }

    #[test]
    fn each_line_is_told_to_the_voice_as_what_it_is() {
        assert_eq!(Line::Hush.request(), ("voice.stop", json!({})));
        assert_eq!(Line::Add("Nine.".into()).request(), ("voice.add", json!({ "text": "Nine." })));
        assert_eq!(Line::End.request(), ("voice.end", json!({})));
        assert_eq!(Line::Say("Ten.".into()).request(), ("voice.say", json!({ "text": "Ten." })));
    }
}
