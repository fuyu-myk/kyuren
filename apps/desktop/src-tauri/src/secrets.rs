use std::sync::Arc;

use keyring::Entry;
use serde_json::json;
use tauri::AppHandle;

use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

const SERVICE: &str = "dev.kyuren.assistant";

/// Every credential Kyuren knows how to hold. Naming them here rather than accepting any name
/// keeps the interface from becoming a general secret store reachable from the webview.
pub const NAMES: [&str; 4] = ["anthropic", "notion", "google", "microsoft"];

/// What a forged skill's credential is called. Namespaced so that a skill can never be given the
/// name of a credential Kyuren holds for something else, and spelled out so the webview cannot
/// turn this into a general secret store.
const FORGED: &str = "skill:";

fn forged(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(FORGED) else {
        return false;
    };
    !rest.is_empty()
        && rest.len() <= 40
        && rest
            .chars()
            .all(|one| one.is_ascii_lowercase() || one.is_ascii_digit() || one == '_')
}

pub fn known(name: &str) -> bool {
    NAMES.contains(&name) || forged(name)
}

pub fn read(name: &str) -> Option<String> {
    Entry::new(SERVICE, name)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|secret| !secret.is_empty())
}

pub fn write(name: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, name).map_err(|failure| failure.to_string())?;
    entry
        .set_password(secret)
        .map_err(|failure| failure.to_string())
}

pub fn forget(name: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, name).map_err(|failure| failure.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(failure) => Err(failure.to_string()),
    }
}

/// Which credentials exist, without revealing any of them.
pub fn held() -> Vec<String> {
    NAMES
        .iter()
        .filter(|name| read(name).is_some())
        .map(|name| (*name).to_string())
        .collect()
}

async fn give(core: &Arc<Sidecar>, name: &str) {
    let Some(secret) = read(name) else { return };
    let _ = core
        .request(
            "secret.set",
            json!({ "name": name, "secret": secret }),
            PING_TIMEOUT,
        )
        .await;
}

/// Secrets live in the keychain and are handed to the sidecar that needs them, rather than being
/// written into a file or an environment the rest of the machine can read.
///
/// The skills say which credentials they need, because this side cannot enumerate the keychain and
/// should not be guessing at names.
pub async fn hand_over(core: &Arc<Sidecar>) {
    for name in NAMES {
        give(core, name).await;
    }

    let Ok(answer) = core.request("skills.credentials", json!({}), PING_TIMEOUT).await else {
        return;
    };
    let wanted = answer
        .get("names")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();

    for name in wanted.iter().filter_map(serde_json::Value::as_str) {
        let full = format!("{FORGED}{name}");
        if known(&full) {
            give(core, &full).await;
        }
    }
}

pub async fn resend(app: &AppHandle) {
    use tauri::Manager;
    let core = app
        .try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.core));
    if let Some(core) = core {
        hand_over(&core).await;
    }
}

/// A sidecar that has finished an authorisation hands the result here rather than keeping it. The
/// keychain is the only place a credential is written, and the sidecar is given it back the same
/// way every other credential arrives.
pub fn store_from(app: &AppHandle, data: &serde_json::Value) {
    let Some(name) = data.get("name").and_then(serde_json::Value::as_str) else {
        return;
    };
    let Some(secret) = data.get("secret").and_then(serde_json::Value::as_str) else {
        return;
    };
    if !known(name) {
        eprintln!("kyuren secret.store: {name} is not a credential Kyuren holds");
        return;
    }

    if let Err(failure) = write(name, secret) {
        eprintln!("kyuren secret.store: {failure}");
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        resend(&app).await;
        let _ = tauri::Emitter::emit(&app, "connections", held());
    });
}
