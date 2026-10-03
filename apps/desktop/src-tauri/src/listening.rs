use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::island;
use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

/// How close two summons may come before the second is taken as the same one: a held key
/// repeats every few dozen milliseconds, and a hand that means twice takes longer than this.
const SETTLE: Duration = Duration::from_millis(320);

fn last_summon() -> &'static Mutex<Option<Instant>> {
    static LAST: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

pub fn on_summon(app: &AppHandle) {
    // A summon hard on the heels of another is the key repeating, not the user asking twice. Taken
    // as a toggle each time, the orb flickers and is left however the last repeat left it.
    if let Ok(mut last) = last_summon().lock() {
        if last.map(|at| at.elapsed() < SETTLE).unwrap_or(false) {
            return;
        }
        *last = Some(Instant::now());
    }

    let listening = island::toggle(app);

    let Some(perception) = perception(app) else {
        return;
    };

    if let Some(core) = core(app) {
        // Summoning is the earliest warning that a question is coming, and dismissing abandons a
        // reply that is no longer wanted.
        let method = if listening { "model.warm" } else { "agent.stop" };
        tauri::async_runtime::spawn(async move {
            let _ = core.request(method, json!({}), PING_TIMEOUT).await;
        });
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let method = if listening { "microphone.start" } else { "microphone.stop" };

        match perception.request(method, json!({}), PING_TIMEOUT).await {
            Ok(_) => {
                let _ = app.emit("orb:state", if listening { "listening" } else { "idle" });
                if !listening {
                    let _ = app.emit("orb:energy", 0.0);
                }
            }
            Err(failure) => {
                eprintln!("kyuren {method}: {failure}");
                let _ = app.emit("orb:state", "idle");
            }
        }
    });
}

/// Kyuren heard its name. That is a summons, unless it is already listening, in which case the
/// name was part of what is being said to it and means nothing on its own.
pub fn on_wake(app: &AppHandle) {
    if !island::summoned() {
        on_summon(app);
    }
}

fn core(app: &AppHandle) -> Option<Arc<Sidecar>> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.core))
}

fn perception(app: &AppHandle) -> Option<Arc<Sidecar>> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.perception))
}
