use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    #[default]
    Focus,
    Short,
    Long,
}

pub const FOCUS_MS: u64 = 25 * 60_000;
pub const SHORT_MS: u64 = 5 * 60_000;
pub const LONG_MS: u64 = 15 * 60_000;
/// Focus periods to a set; the set ends in the long break.
pub const ROUNDS: u32 = 4;
/// A period found run out longer ago than this, as when the app was closed through it, is moved
/// past without ringing: a chime for an hour-old break is noise.
const STALE_MS: u64 = 60_000;

pub fn length(period: Period) -> u64 {
    match period {
        Period::Focus => FOCUS_MS,
        Period::Short => SHORT_MS,
        Period::Long => LONG_MS,
    }
}

/// The timer, kept by wall-clock time: a Mac asleep through a focus period finds it over when it
/// wakes, which a clock that stops in sleep would not.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pomodoro {
    pub period: Period,
    /// When the period ends, in epoch milliseconds, while it runs.
    pub ends_at: Option<u64>,
    /// What is left of it while it is stopped.
    pub left: u64,
    /// Focus periods finished in this set.
    pub done: u32,
}

impl Default for Pomodoro {
    fn default() -> Self {
        Pomodoro { period: Period::Focus, ends_at: None, left: FOCUS_MS, done: 0 }
    }
}

pub fn start(clock: Pomodoro, now: u64) -> Pomodoro {
    match clock.ends_at {
        Some(_) => clock,
        None => Pomodoro { ends_at: Some(now + clock.left), ..clock },
    }
}

pub fn pause(clock: Pomodoro, now: u64) -> Pomodoro {
    match clock.ends_at {
        Some(end) => Pomodoro { ends_at: None, left: end.saturating_sub(now), ..clock },
        None => clock,
    }
}

pub fn reset(clock: Pomodoro) -> Pomodoro {
    Pomodoro { ends_at: None, left: length(clock.period), ..clock }
}

pub fn switch(clock: Pomodoro, period: Period) -> Pomodoro {
    Pomodoro { period, ends_at: None, left: length(period), done: clock.done }
}

/// The period that follows one run out, waiting to be started. A focus period counts toward the
/// set, and the set's last earns the long break; after it the count begins again.
pub fn after(clock: Pomodoro) -> Pomodoro {
    match clock.period {
        Period::Focus => {
            let done = clock.done + 1;
            let period = if done >= ROUNDS { Period::Long } else { Period::Short };
            Pomodoro { period, ends_at: None, left: length(period), done }
        }
        Period::Short => Pomodoro { period: Period::Focus, ends_at: None, left: FOCUS_MS, done: clock.done },
        Period::Long => Pomodoro::default(),
    }
}

/// Run out, by now.
pub fn due(clock: Pomodoro, now: u64) -> bool {
    clock.ends_at.is_some_and(|end| now >= end)
}

/// When the running period ends, kept apart from the lock so the island's tick can look at it for
/// nothing. Zero is not running.
static DEADLINE: AtomicU64 = AtomicU64::new(0);

fn held() -> &'static Mutex<Pomodoro> {
    static HELD: OnceLock<Mutex<Pomodoro>> = OnceLock::new();
    HELD.get_or_init(|| Mutex::new(crate::settings::read_settings().pomodoro.unwrap_or_default()))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or(0)
}

/// Keeps a change: remembered for the next launch, the deadline set, and the island told.
fn kept(app: &AppHandle, clock: Pomodoro) -> Pomodoro {
    DEADLINE.store(clock.ends_at.unwrap_or(0), Ordering::SeqCst);
    let _ = crate::settings::update_settings(|settings| settings.pomodoro = Some(clock));
    let _ = app.emit_to(crate::island::LABEL, "pomodoro:state", clock);
    clock
}

fn changed(app: &AppHandle, change: impl FnOnce(Pomodoro, u64) -> Pomodoro) -> Pomodoro {
    let Ok(mut clock) = held().lock() else { return Pomodoro::default() };
    *clock = change(*clock, now_ms());
    let next = *clock;
    drop(clock);
    kept(app, next)
}

/// At launch, picking up a period left running.
pub fn install() {
    if let Ok(clock) = held().lock() {
        DEADLINE.store(clock.ends_at.unwrap_or(0), Ordering::SeqCst);
    }
}

/// On the island's tick: a period that has run out rings, once, and the next waits to be started.
pub fn check(app: &AppHandle) {
    let deadline = DEADLINE.load(Ordering::SeqCst);
    let now = now_ms();
    if deadline == 0 || now < deadline {
        return;
    }
    DEADLINE.store(0, Ordering::SeqCst);
    let Ok(mut clock) = held().lock() else { return };
    if !due(*clock, now) {
        return;
    }
    let finished = clock.period;
    *clock = after(*clock);
    let next = *clock;
    drop(clock);
    kept(app, next);
    let shown = crate::widgets::widgets_from(crate::settings::read_settings().island.widgets.as_deref()).iter().any(|one| one == "pomodoro");
    if shown && now - deadline <= STALE_MS {
        let _ = app.emit_to(crate::island::LABEL, "pomodoro:rang", finished);
    }
}

#[tauri::command]
pub fn pomodoro_state() -> Pomodoro {
    held().lock().map(|clock| *clock).unwrap_or_default()
}

#[tauri::command]
pub fn pomodoro_start(app: AppHandle) -> Pomodoro {
    changed(&app, start)
}

#[tauri::command]
pub fn pomodoro_pause(app: AppHandle) -> Pomodoro {
    changed(&app, pause)
}

#[tauri::command]
pub fn pomodoro_reset(app: AppHandle) -> Pomodoro {
    changed(&app, |clock, _| reset(clock))
}

#[tauri::command]
pub fn pomodoro_period(app: AppHandle, period: Period) -> Pomodoro {
    changed(&app, |clock, _| switch(clock, period))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn started_it_runs_to_a_time_paused_it_keeps_what_is_left() {
        let ready = Pomodoro::default();
        let running = start(ready, 1_000);
        assert_eq!(running.ends_at, Some(1_000 + FOCUS_MS));
        assert_eq!(start(running, 5_000), running, "starting a running clock changes nothing");
        let paused = pause(running, 61_000);
        assert_eq!((paused.ends_at, paused.left), (None, FOCUS_MS - 60_000));
        assert_eq!(start(paused, 100_000).ends_at, Some(100_000 + FOCUS_MS - 60_000), "it resumes where it stopped");
        assert_eq!(reset(paused).left, FOCUS_MS);
    }

    #[test]
    fn a_focus_period_earns_a_break_and_the_fourth_the_long_one() {
        let first = after(Pomodoro::default());
        assert_eq!((first.period, first.done, first.ends_at), (Period::Short, 1, None), "the next waits to be started");
        let back = after(first);
        assert_eq!((back.period, back.done), (Period::Focus, 1));
        let fourth = after(Pomodoro { done: 3, ..Pomodoro::default() });
        assert_eq!((fourth.period, fourth.done, fourth.left), (Period::Long, 4, LONG_MS));
        assert_eq!(after(fourth), Pomodoro::default(), "after the long break the set begins again");
    }

    #[test]
    fn it_has_run_out_only_once_its_time_has_come() {
        let running = start(Pomodoro::default(), 0);
        assert!(!due(running, FOCUS_MS - 1));
        assert!(due(running, FOCUS_MS));
        assert!(!due(pause(running, 10), FOCUS_MS * 2), "a stopped clock never runs out");
        assert_eq!(switch(running, Period::Short), Pomodoro { period: Period::Short, ends_at: None, left: SHORT_MS, done: 0 });
    }
}
