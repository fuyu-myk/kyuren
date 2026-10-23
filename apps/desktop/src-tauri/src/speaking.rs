use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::state::{Sidecars, PING_TIMEOUT, SPEAK_TIMEOUT};

/// How long a notice waits for a quiet moment before it is let go, shown but never said.
const NOTICE_WAIT: Duration = Duration::from_secs(60);
/// How long nothing must be said or heard before a waiting notice is said, so that someone who has
/// only paused is not talked over.
const QUIET: Duration = Duration::from_millis(1500);
const LOOK: Duration = Duration::from_millis(250);

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
    /// The turn being said has not yet ended.
    live: bool,
    /// What that turn was asked.
    asked: Option<String>,
    /// Some of that turn's reply has been heard.
    answered: bool,
    /// Sentences of that turn sent to the voice and not yet heard out.
    unheard: usize,
    /// The voice is saying something.
    sounding: bool,
    /// Someone is talking.
    hearing: bool,
}

impl Current {
    /// What a new turn is asked. Heard while the turn being said goes on and before any of its reply,
    /// it carries on that turn's question after a pause rather than asking one of its own.
    pub fn asking(&self, heard: &str) -> String {
        match &self.asked {
            Some(before) if self.live && !self.answered => format!("{before} {heard}"),
            _ => heard.to_string(),
        }
    }

    /// A new spoken turn takes over; the one it replaces, if any, is to be stopped.
    pub fn begin(&mut self, asked: String) -> (String, Option<String>) {
        self.count += 1;
        let id = format!("voice:{}", self.count);
        let previous = self.turn.replace(id.clone());
        self.live = true;
        self.asked = Some(asked);
        self.answered = false;
        // Whatever was sounding is hushed as the turn begins.
        self.unheard = 0;
        self.sounding = false;
        (id, previous)
    }

    pub fn is(&self, id: &str) -> bool {
        self.turn.as_deref() == Some(id)
    }

    /// Talked over or dismissed: nothing more of it is said, and it is to be stopped.
    pub fn interrupt(&mut self) -> Option<String> {
        self.live = false;
        self.unheard = 0;
        self.sounding = false;
        self.turn.take()
    }

    /// A sentence of the turn being said goes to the voice, if that is the turn.
    pub fn adds(&mut self, turn: &str) -> bool {
        let current = self.is(turn);
        if current {
            self.unheard += 1;
        }
        current
    }

    /// A turn has ended, however it went. Whether it was the one being said and has nothing left
    /// to be heard.
    pub fn settle(&mut self, turn: &str) -> bool {
        if !self.is(turn) {
            return false;
        }
        self.live = false;
        self.unheard == 0 && !self.sounding
    }

    pub fn live(&self) -> bool {
        self.live
    }

    /// The voice has begun saying something, or has finished or been stopped.
    pub fn sounds(&mut self, sounding: bool) {
        self.sounding = sounding;
        if sounding && self.live {
            self.answered = true;
        }
        if !sounding {
            self.unheard = 0;
        }
    }

    pub fn hears(&mut self, hearing: bool) {
        self.hearing = hearing;
    }

    /// Nothing is being said, owed or heard, so a notice would cut across nobody.
    pub fn quiet(&self) -> bool {
        !self.live && self.unheard == 0 && !self.sounding && !self.hearing
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

fn with<T>(app: &AppHandle, look: impl FnOnce(&mut Current) -> T) -> Option<T> {
    app.try_state::<Saying>()
        .and_then(|saying| saying.current.lock().ok().map(|mut current| look(&mut current)))
}

fn wanted(app: &AppHandle, turn: Option<&str>) -> bool {
    with(app, |current| current.wants(turn)).unwrap_or(false)
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

/// A spoken turn begins under a name of its own, for what was heard: what was being said gives
/// way, and the turn it replaces is stopped. Returns the turn and what it is asked.
pub fn begin(app: &AppHandle, heard: &str) -> (String, String) {
    let begun = with(app, |current| {
        let asked = current.asking(heard);
        let (turn, previous) = current.begin(asked.clone());
        (turn, previous, asked)
    });
    // Without the line to the voice installed nothing is said, though the turn still runs.
    let Some((turn, previous, asked)) = begun else {
        return ("voice".to_string(), heard.to_string());
    };
    send(app, Some(turn.clone()), Line::Hush);
    if let Some(previous) = previous {
        stop(app, previous);
    }
    (turn, asked)
}

/// A sentence the core says for a spoken turn.
pub fn said(app: &AppHandle, data: &Value) {
    let (Some(turn), Some(text)) = (data.get("id").and_then(Value::as_str), data.get("text").and_then(Value::as_str)) else {
        return;
    };
    if with(app, |current| current.adds(turn)).unwrap_or(false) {
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
/// part way through a reply never says it has finished. Whether it was the turn being said and
/// nothing of it is left to be heard.
pub fn settled(app: &AppHandle, turn: &str) -> bool {
    if wanted(app, Some(turn)) {
        send(app, Some(turn.to_string()), Line::End);
    }
    with(app, |current| current.settle(turn)).unwrap_or(false)
}

/// Whether the turn being said goes on, as it does while a tool runs after its first words.
pub fn live(app: &AppHandle) -> bool {
    with(app, |current| current.live()).unwrap_or(false)
}

pub fn sounding(app: &AppHandle, sounding: bool) {
    with(app, |current| current.sounds(sounding));
}

pub fn hearing(app: &AppHandle, hearing: bool) {
    with(app, |current| current.hears(hearing));
}

fn quiet(app: &AppHandle) -> bool {
    with(app, |current| current.quiet()).unwrap_or(true)
}

/// Something to be said in its own right, such as a notice. It is said once nothing is being said
/// or heard, rather than across a reply or someone talking, and let go if no such moment comes.
pub fn notice(app: &AppHandle, text: String) {
    if quiet(app) {
        send(app, None, Line::Say(text));
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let given_up = Instant::now() + NOTICE_WAIT;
        let mut calm: Option<Instant> = None;
        while Instant::now() < given_up {
            tokio::time::sleep(LOOK).await;
            if !quiet(&app) {
                calm = None;
                continue;
            }
            if calm.get_or_insert_with(Instant::now).elapsed() >= QUIET {
                send(&app, None, Line::Say(text));
                return;
            }
        }
        eprintln!("kyuren notice: nothing was quiet for long enough to say it");
    });
}

/// Talked over or dismissed: the spoken turn is stopped and says nothing more.
pub fn interrupt(app: &AppHandle) {
    let stopped = with(app, Current::interrupt).flatten();
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
        let (first, replaced) = current.begin("one".into());
        assert_eq!(replaced, None);
        assert!(current.is(&first));
        let (second, replaced) = current.begin("two".into());
        assert_ne!(first, second);
        assert_eq!(replaced.as_deref(), Some(first.as_str()));
        assert!(current.is(&second));
        assert!(!current.is(&first), "what the replaced turn still says is not spoken");
    }

    #[test]
    fn a_turn_talked_over_says_nothing_more_and_is_stopped_once() {
        let mut current = Current::default();
        let (turn, _) = current.begin("asked".into());
        assert_eq!(current.interrupt().as_deref(), Some(turn.as_str()));
        assert!(!current.is(&turn));
        assert_eq!(current.interrupt(), None, "nothing is left to stop");
    }

    #[test]
    fn only_the_turn_being_said_is_sent_on_and_what_belongs_to_no_turn_always_is() {
        let mut current = Current::default();
        assert!(current.wants(None), "a notice, or a stop, with nothing being said");
        let (first, _) = current.begin("asked".into());
        assert!(current.wants(Some(&first)));
        let (second, _) = current.begin("asked".into());
        assert!(!current.wants(Some(&first)), "a replaced turn's lines are dropped");
        assert!(current.wants(Some(&second)));
        current.interrupt();
        assert!(!current.wants(Some(&second)), "nor is anything sent for a turn talked over");
        assert!(current.wants(None), "but the stop that follows it is");
    }

    #[test]
    fn a_notice_waits_while_anything_is_said_owed_or_heard() {
        let mut current = Current::default();
        assert!(current.quiet());
        let (turn, _) = current.begin("asked".into());
        assert!(!current.quiet(), "a turn under way");
        assert!(current.adds(&turn));
        current.sounds(true);
        assert!(!current.settle(&turn), "its last words are still being said");
        assert!(!current.quiet());
        current.sounds(false);
        assert!(current.quiet(), "heard out, and over");
        current.hears(true);
        assert!(!current.quiet(), "someone is talking");
        current.hears(false);
        assert!(current.quiet());
    }

    #[test]
    fn a_turn_that_ends_with_its_words_heard_out_says_so_and_one_still_owing_them_does_not() {
        let mut current = Current::default();
        let (turn, _) = current.begin("asked".into());
        current.adds(&turn);
        current.sounds(true);
        current.sounds(false);
        assert!(current.live(), "heard out while it goes on, as through a tool");
        assert!(current.settle(&turn));

        let (next, _) = current.begin("asked".into());
        current.adds(&next);
        assert!(!current.settle(&next), "its last sentence is still on its way to the voice");
        assert!(!current.quiet());
        let (later, _) = current.begin("asked".into());
        assert!(!current.adds(&next), "a replaced turn's words are not counted");
        assert!(!current.settle(&next), "nor is it the one being said when it ends");
        assert!(current.live());
        assert!(current.settle(&later));
    }

    #[test]
    fn more_heard_before_any_reply_joins_the_question_and_after_it_is_a_question_of_its_own() {
        let mut current = Current::default();
        assert_eq!(current.asking("what is on my calendar"), "what is on my calendar");
        current.begin("what is on my calendar".into());
        let asked = current.asking("for tomorrow afternoon");
        assert_eq!(asked, "what is on my calendar for tomorrow afternoon", "a pause, not a new question");
        current.begin(asked);
        assert_eq!(current.asking("and the evening"), "what is on my calendar for tomorrow afternoon and the evening");

        current.sounds(true);
        assert_eq!(current.asking("thanks"), "thanks", "its reply has begun, so this answers it");
        let (turn, _) = current.begin("thanks".into());
        current.settle(&turn);
        assert_eq!(current.asking("one more thing"), "one more thing", "nor once a turn is over");
        current.begin("one more thing".into());
        current.interrupt();
        assert_eq!(current.asking("never mind"), "never mind", "nor once it is talked over");
    }

    #[test]
    fn each_line_is_told_to_the_voice_as_what_it_is() {
        assert_eq!(Line::Hush.request(), ("voice.stop", json!({})));
        assert_eq!(Line::Add("Nine.".into()).request(), ("voice.add", json!({ "text": "Nine." })));
        assert_eq!(Line::End.request(), ("voice.end", json!({})));
        assert_eq!(Line::Say("Ten.".into()).request(), ("voice.say", json!({ "text": "Ten." })));
    }
}
