use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::sidecar::Sidecar;
use crate::state::{Sidecars, PING_TIMEOUT};

/// The players whose sound the visualizer may hear, by the bundle macOS knows each by.
const PLAYERS: [(&str, &str); 2] = [("spotify", "com.spotify.client"), ("music", "com.apple.Music")];

/// The player being heard, if one is, so a perception that restarts goes on hearing it.
static HEARD: Mutex<Option<&'static str>> = Mutex::new(None);

pub fn bundle_of(player: &str) -> Option<&'static str> {
    PLAYERS.iter().find(|(name, _)| *name == player).map(|(_, bundle)| *bundle)
}

fn perception<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<Sidecar>> {
    app.try_state::<Sidecars>().map(|state| Arc::clone(&state.perception))
}

fn request(bundle: Option<&str>) -> (&'static str, Value) {
    match bundle {
        Some(bundle) => ("music.listen", json!({ "bundle": bundle })),
        None => ("music.quiet", json!({})),
    }
}

/// Hears the player named, its sound drawn under the music widget, or with none named hears none.
/// Only a player the widget shows may be named; the island names one only while the widget is in
/// sight with the visualizer on and a track playing.
#[tauri::command]
pub async fn music_hear(app: AppHandle, player: Option<String>) -> Result<Value, String> {
    let bundle = match player.as_deref() {
        Some(player) => Some(bundle_of(player).ok_or_else(|| format!("{player} is not a player the island shows"))?),
        None => None,
    };
    if let Ok(mut heard) = HEARD.lock() {
        *heard = bundle;
    }
    let perception = perception(&app).ok_or("perception is not running")?;
    let (method, params) = request(bundle);
    perception.request(method, params, PING_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// A perception that has just restarted hears nothing, so the player heard before is heard again.
pub fn restored<R: Runtime>(app: &AppHandle<R>) {
    let Some(bundle) = HEARD.lock().ok().and_then(|heard| *heard) else { return };
    let Some(perception) = perception(app) else { return };
    tauri::async_runtime::spawn(async move {
        let (method, params) = request(Some(bundle));
        if let Err(failure) = perception.request(method, params, PING_TIMEOUT).await {
            eprintln!("kyuren music: {failure}");
        }
    });
}

/// Whether the music widget draws what plays, which is off until switched on, since it needs
/// macOS to let Kyuren hear the player.
#[tauri::command]
pub fn island_visualizer() -> bool {
    crate::settings::read_settings().island.visualizer.unwrap_or(false)
}

/// Switched from the settings or the cover alike, so each is told what the other did.
#[tauri::command]
pub fn island_visualizer_set(app: AppHandle, on: bool) -> Result<bool, String> {
    crate::settings::update_settings(|settings| settings.island.visualizer = Some(on))?;
    let _ = app.emit("island:visualizer", on);
    Ok(on)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_players_the_island_shows_are_heard() {
        assert_eq!(bundle_of("spotify"), Some("com.spotify.client"));
        assert_eq!(bundle_of("music"), Some("com.apple.Music"));
        assert_eq!(bundle_of("Spotify"), None, "only as the host names them");
        assert_eq!(bundle_of("com.apple.Safari"), None);
        assert_eq!(bundle_of(""), None);
    }
}
