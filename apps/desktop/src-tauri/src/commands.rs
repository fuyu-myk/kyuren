use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::conversation::answer_permission;
use crate::secrets;
use crate::state::{Sidecars, GATHER_TIMEOUT, PING_TIMEOUT, SPEAK_TIMEOUT};

#[tauri::command]
pub async fn sidecar_status(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    Ok(sidecars.probe().await)
}

#[tauri::command]
pub async fn speak(text: String, sidecars: State<'_, Sidecars>) -> Result<(), String> {
    sidecars
        .perception
        .request("voice.say", json!({ "text": text }), SPEAK_TIMEOUT)
        .await
        .map(|_| ())
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn resolve_permission(app: AppHandle, id: String, allow: bool) -> Result<Value, String> {
    answer_permission(&app, id, allow).await
}

/// Opens a web address in the user's own browser. Only http and https: a link in an answer is a
/// place to go and look, never a way to run something here.
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("only web addresses can be opened".into());
    }
    std::process::Command::new("open")
        .arg(trimmed)
        .spawn()
        .map(|_| ())
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn store_secret(app: AppHandle, name: String, secret: String) -> Result<Vec<String>, String> {
    if !secrets::known(&name) {
        return Err(format!("{name} is not a credential Kyuren holds"));
    }
    if secret.trim().is_empty() {
        return Err("the credential is empty".into());
    }
    secrets::write(&name, secret.trim())?;
    secrets::resend(&app).await;
    Ok(secrets::held())
}

#[tauri::command]
pub async fn forget_secret(app: AppHandle, name: String) -> Result<Vec<String>, String> {
    if !secrets::known(&name) {
        return Err(format!("{name} is not a credential Kyuren holds"));
    }
    secrets::forget(&name)?;
    secrets::resend(&app).await;
    Ok(secrets::held())
}

#[tauri::command]
pub fn held_secrets() -> Vec<String> {
    secrets::held()
}

/// Consent pages Kyuren will open. The sidecar builds the address from a pinned host, and this
/// checks it again on the way out, so a wrong or tampered address opens nothing.
const CONSENT_HOSTS: [&str; 2] = [
    "https://accounts.google.com/",
    "https://login.microsoftonline.com/",
];

/// Starts a service's authorisation and opens its consent page. The grant comes back to a listener
/// the sidecar opened on the loopback address, so the code never leaves the machine.
#[tauri::command]
pub async fn connect_service(
    service: String,
    client_id: String,
    client_secret: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<(), String> {
    let answer = sidecars
        .core
        .request(
            "oauth.connect",
            json!({
                "service": service,
                "clientId": client_id,
                "clientSecret": client_secret.unwrap_or_default(),
            }),
            PING_TIMEOUT,
        )
        .await
        .map_err(|failure| failure.to_string())?;

    let url = answer
        .get("url")
        .and_then(Value::as_str)
        .ok_or("the sidecar did not return a consent address")?;

    if !CONSENT_HOSTS.iter().any(|host| url.starts_with(host)) {
        return Err("the consent address was not one Kyuren opens".into());
    }

    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|failure| format!("could not open the consent page: {failure}"))?;

    Ok(())
}

#[tauri::command]
pub async fn morning_brief(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    sidecars
        .core
        .request("brief.today", json!({}), GATHER_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub async fn mind_graph(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    sidecars
        .core
        .request("memory.graph", json!({}), GATHER_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

/// The capabilities that are a whole request on their own, and the words each one is asked in.
///
/// The rest need to be given something to work on, so asking for one of those by itself would be
/// asking nothing. Kept here rather than in the webview so that the graph can only ask for things
/// Kyuren has agreed to be asked.
const ON_THEIR_OWN: [(&str, &str); 2] = [
    ("today", "What does today hold?"),
    ("remember", "What have I written down lately?"),
];

/// A capability that is a whole request, and the words it is asked in.
#[derive(serde::Serialize)]
pub struct Asked {
    name: String,
    /// Carried out so that what is shown as having been asked is what was actually asked.
    asking: String,
}

/// Which capabilities may be offered to run, so that none is offered that cannot be.
#[tauri::command]
pub fn askable_capabilities() -> Vec<Asked> {
    ON_THEIR_OWN
        .iter()
        .map(|(name, asking)| Asked {
            name: (*name).to_string(),
            asking: (*asking).to_string(),
        })
        .collect()
}

/// Asking Kyuren to use one of its own capabilities, from a pane or from the graph rather than by
/// talking to it. Phrased as a request in words so the same gate and the same loop judge it.
///
/// Given a pane, the asking and the answer are kept as a session there, so a capability run from
/// the hub leaves something behind to read.
#[tauri::command]
pub async fn run_capability(
    tool: String,
    pane: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    let asked = ON_THEIR_OWN
        .iter()
        .find(|(name, _)| *name == tool)
        .map(|(_, asking)| *asking)
        .ok_or_else(|| format!("{tool} is not a capability that can be asked for on its own"))?;

    sidecars
        .core
        .request_untimed(
            "agent.run",
            json!({ "prompt": asked, "difficulty": "moderate", "pane": pane }),
        )
        .await
        .map_err(|failure| failure.to_string())
}

#[tauri::command]
pub fn show_mind(app: AppHandle) {
    crate::mind::toggle(&app);
}
