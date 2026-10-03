use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use objc2::rc::Retained;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::NSRunningApplication;
use objc2_foundation::{
    MainThreadMarker, NSDictionary, NSDistributedNotificationCenter, NSNotification, NSNotificationSuspensionBehavior, NSNumber,
    NSObject, NSObjectProtocol, NSString,
};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::{Sidecars, PING_TIMEOUT};

/// The players the island follows: the name it gives each, its bundle, and what it broadcasts
/// when what it plays changes. The broadcasts need no permission; controlling a player does.
const PLAYERS: [(&str, &str, &str); 2] = [
    ("spotify", "com.spotify.client", "com.spotify.client.PlaybackStateChanged"),
    ("music", "com.apple.Music", "com.apple.Music.playerInfo"),
];

/// What is playing, with the position as it was at `at`, so the island can move it on itself.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playing {
    pub player: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds.
    pub duration: f64,
    /// Seconds, at `at`; unknown where the player's broadcast does not say it.
    pub position: Option<f64>,
    pub at: u64,
    pub playing: bool,
    /// What the artwork is looked up by: Spotify's track id, or Music's store id.
    pub track: Option<String>,
    /// The player's own volume, 0 to 100, once it has been asked.
    pub volume: Option<f64>,
}

fn text(info: &Map<String, Value>, key: &str) -> String {
    info.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn number(info: &Map<String, Value>, key: &str) -> Option<f64> {
    info.get(key).and_then(Value::as_f64)
}

/// Spotify's broadcast: names, the duration in milliseconds and the position in seconds. Stopped
/// is nothing playing.
pub fn from_spotify(info: &Map<String, Value>, now: u64) -> Option<Playing> {
    let state = text(info, "Player State");
    if state == "Stopped" || state.is_empty() {
        return None;
    }
    Some(Playing {
        player: "spotify".into(),
        title: text(info, "Name"),
        artist: text(info, "Artist"),
        album: text(info, "Album"),
        duration: number(info, "Duration").unwrap_or(0.0) / 1000.0,
        position: number(info, "Playback Position"),
        at: now,
        playing: state == "Playing",
        track: Some(text(info, "Track ID")).filter(|id| !id.is_empty()),
        volume: None,
    })
}

/// Music's broadcast: names and the total time in milliseconds, but no position. The store id in
/// its link is what its artwork is looked up by.
pub fn from_music(info: &Map<String, Value>, now: u64) -> Option<Playing> {
    let state = text(info, "Player State");
    if state == "Stopped" || state.is_empty() {
        return None;
    }
    Some(Playing {
        player: "music".into(),
        title: text(info, "Name"),
        artist: text(info, "Artist"),
        album: text(info, "Album"),
        duration: number(info, "Total Time").unwrap_or(0.0) / 1000.0,
        position: None,
        at: now,
        playing: state == "Playing",
        track: store_id(&text(info, "Store URL")),
        volume: None,
    })
}

/// The `i` parameter of a store link, which names the track itself rather than its album.
pub fn store_id(url: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("i="))
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

/// What the island asks of a player.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Toggle,
    Next,
    Previous,
    /// To a position, in seconds.
    Seek(f64),
    /// To a volume, 0 to 100.
    Volume(f64),
    /// Everything about what is playing, as one line.
    Read,
}

/// One field to the next in what a read returns: a record separator, which no title holds.
pub const FIELD: char = '\u{1e}';

/// The AppleScript for an action. Numbers go in and come out as whole milliseconds, so a locale
/// that writes a decimal comma cannot garble them, and every event is given three seconds.
pub fn script(bundle: &str, action: Action) -> String {
    let verb = match action {
        Action::Toggle => "playpause".to_string(),
        Action::Next => "next track".to_string(),
        Action::Previous => "previous track".to_string(),
        Action::Seek(seconds) => format!("set player position to {}", (seconds.max(0.0) * 1000.0).round() / 1000.0),
        Action::Volume(level) => format!("set sound volume to {}", level.clamp(0.0, 100.0).round()),
        Action::Read => {
            // Spotify gives a duration in milliseconds and Music in seconds, and only Spotify gives
            // an id its cover can be found by.
            let spotify = bundle == "com.spotify.client";
            let duration = if spotify { "(duration of t)" } else { "((duration of t) * 1000)" };
            let id = if spotify { "id of t" } else { "\"\"" };
            return format!(
                "with timeout of 3 seconds\ntell application id \"{bundle}\"\nset t to current track\nset fields to {{name of t, artist of t, album of t, ({duration} as integer) as text, ((player position * 1000) as integer) as text, player state as text, sound volume as text, {id}}}\nend tell\nend timeout\nset AppleScript's text item delimiters to (character id 30)\nreturn fields as text"
            );
        }
    };
    format!("with timeout of 3 seconds\ntell application id \"{bundle}\" to {verb}\nend timeout")
}

/// A read's one line, back into what is playing.
pub fn from_read(player: &str, line: &str, now: u64) -> Option<Playing> {
    let fields: Vec<&str> = line.trim_end_matches(['\n', '\r']).split(FIELD).collect();
    let [title, artist, album, duration, position, state, volume, id] = fields.as_slice() else { return None };
    if *state == "stopped" {
        return None;
    }
    Some(Playing {
        player: player.into(),
        title: title.to_string(),
        artist: artist.to_string(),
        album: album.to_string(),
        duration: duration.parse::<f64>().ok()? / 1000.0,
        position: position.parse::<f64>().ok().map(|ms| ms / 1000.0),
        at: now,
        playing: *state == "playing",
        track: Some(id.to_string()).filter(|id| id.starts_with("spotify:track:")),
        volume: volume.parse().ok(),
    })
}

/// The same as what the island already has: the same track in the same state, and where it would
/// be by now had it kept playing. A player asked every two seconds would otherwise be news every
/// two seconds.
pub fn same(was: &Playing, now: &Playing) -> bool {
    let alike = was.player == now.player
        && was.title == now.title
        && was.artist == now.artist
        && was.album == now.album
        && was.playing == now.playing
        && was.track == now.track
        && was.volume == now.volume
        && (was.duration - now.duration).abs() < 0.5;
    alike
        && match (was.position, now.position) {
            (None, None) => true,
            (Some(then), Some(seen)) => {
                let moved = if was.playing { now.at.saturating_sub(was.at) as f64 / 1000.0 } else { 0.0 };
                (then + moved - seen).abs() < 2.0
            }
            _ => false,
        }
}

/// What the island last heard.
fn now_playing() -> &'static Mutex<Option<Playing>> {
    static NOW: OnceLock<Mutex<Option<Playing>>> = OnceLock::new();
    NOW.get_or_init(|| Mutex::new(None))
}

/// A cover being looked up, found, or not found as of when.
#[derive(Clone, Debug)]
enum Cover {
    Asking,
    Found(String),
    Missing(u64),
}

/// The covers looked up, by what they were looked up by, kept to the last few tracks.
#[derive(Default)]
struct Covers {
    held: HashMap<String, Cover>,
    order: VecDeque<String>,
}

/// Enough for a few tracks back and forth; a cover is a few dozen kilobytes.
const COVERS: usize = 12;
/// A cover not found, as when offline, is asked for again after this.
const RETRY_MS: u64 = 60_000;

fn covers() -> &'static Mutex<Covers> {
    static COVERS_HELD: OnceLock<Mutex<Covers>> = OnceLock::new();
    COVERS_HELD.get_or_init(|| Mutex::new(Covers::default()))
}

fn widget_on(name: &str) -> bool {
    crate::widgets::widgets_from(crate::settings::read_settings().island.widgets.as_deref()).iter().any(|one| one == name)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or(0)
}

fn running(bundle: &str) -> bool {
    NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle)).count() > 0
}

/// The broadcast's details as plain values: names and numbers, which is all the players send.
fn plain(info: &NSDictionary) -> Map<String, Value> {
    let mut found = Map::new();
    for key in info.allKeys().iter() {
        let Some(name) = key.downcast_ref::<NSString>() else { continue };
        let Some(value) = info.objectForKey(&key) else { continue };
        if let Some(said) = value.downcast_ref::<NSString>() {
            found.insert(name.to_string(), Value::String(said.to_string()));
        } else if let Some(count) = value.downcast_ref::<NSNumber>() {
            found.insert(name.to_string(), json!(count.doubleValue()));
        }
    }
    found
}

fn tell(app: &AppHandle, playing: Option<Playing>) {
    if let Ok(mut held) = now_playing().lock() {
        let unchanged = match (held.as_ref(), playing.as_ref()) {
            (None, None) => true,
            (Some(was), Some(now)) => same(was, now),
            _ => false,
        };
        if unchanged {
            return;
        }
        held.clone_from(&playing);
    }
    let _ = app.emit_to(crate::island::LABEL, "music:now", &playing);
    if let Some(found) = playing {
        look_up_artwork(app, found, true);
    }
}

/// Artwork is looked up by the core, which reads the web, once per track and only while the widget
/// is switched on: the broadcasts are heard regardless, but nothing leaves the Mac for a widget
/// that was never asked for. The island's pages take only images already in hand. A cover already
/// found is sent again only when asked to, as when the track changes back to it.
fn look_up_artwork(app: &AppHandle, playing: Playing, resend: bool) {
    if !widget_on("music") {
        return;
    }
    let Some(track) = playing.track.clone() else { return };
    let Ok(mut held) = covers().lock() else { return };
    match held.held.get(&track).cloned() {
        Some(Cover::Found(art)) => {
            if resend {
                let _ = app.emit_to(crate::island::LABEL, "music:art", json!({ "track": track, "art": art }));
            }
            return;
        }
        Some(Cover::Asking) => return,
        Some(Cover::Missing(at)) if now_ms().saturating_sub(at) < RETRY_MS => return,
        _ => {}
    }
    held.held.insert(track.clone(), Cover::Asking);
    drop(held);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let core = app.try_state::<Sidecars>().map(|state| std::sync::Arc::clone(&state.core));
        let asked = match core {
            Some(core) => core.request("media.artwork", json!({ "player": playing.player, "track": track }), PING_TIMEOUT * 3).await.ok(),
            None => None,
        };
        let found = asked.and_then(|answer| answer.get("art").and_then(Value::as_str).map(str::to_string));
        let Ok(mut held) = covers().lock() else { return };
        match found {
            Some(art) => {
                held.held.insert(track.clone(), Cover::Found(art.clone()));
                held.order.retain(|one| one != &track);
                held.order.push_back(track.clone());
                while held.order.len() > COVERS {
                    if let Some(oldest) = held.order.pop_front() {
                        held.held.remove(&oldest);
                    }
                }
                drop(held);
                let _ = app.emit_to(crate::island::LABEL, "music:art", json!({ "track": track, "art": art }));
            }
            None => {
                held.held.insert(track, Cover::Missing(now_ms()));
            }
        }
    });
}

struct HeardIvars {
    app: AppHandle,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and Heard does not implement Drop.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = HeardIvars]
    struct Heard;

    // SAFETY: NSObjectProtocol has no safety requirements.
    unsafe impl NSObjectProtocol for Heard {}

    impl Heard {
        // SAFETY: the signature is the one a notification centre calls an observer's selector with.
        #[unsafe(method(heard:))]
        fn heard(&self, notification: &NSNotification) {
            let name = notification.name().to_string();
            let info = notification.userInfo().map(|info| plain(&info)).unwrap_or_default();
            let playing = if name == PLAYERS[0].2 { from_spotify(&info, now_ms()) } else { from_music(&info, now_ms()) };
            tell(&self.ivars().app, playing);
        }
    }
);

impl Heard {
    fn new(app: AppHandle, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(HeardIvars { app });
        // SAFETY: NSObject's init takes nothing and returns the object it was given.
        unsafe { msg_send![super(this), init] }
    }
}

/// Listens for both players' broadcasts. Delivery is asked to be immediate: by default AppKit holds
/// distributed notifications back while the app is not the one in front, which Kyuren rarely is.
pub fn install(app: &AppHandle) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    let observer = Heard::new(app.clone(), mtm);
    let center = NSDistributedNotificationCenter::defaultCenter();
    for (_, _, broadcast) in PLAYERS {
        // SAFETY: the observer answers heard:, which takes a notification, and is kept alive below
        // for as long as it is registered, which is the life of the app.
        unsafe {
            center.addObserver_selector_name_object_suspensionBehavior(
                &observer,
                sel!(heard:),
                Some(&NSString::from_str(broadcast)),
                None,
                NSNotificationSuspensionBehavior::DeliverImmediately,
            );
        }
    }
    // A notification centre does not keep its observers alive; this one is meant to live on.
    std::mem::forget(observer);
}

/// Runs an AppleScript in a separate process, so a first-time permission prompt waits there and
/// not on the island. Kyuren is the one asking, as the process that started it.
fn run(script: &str) -> Result<String, String> {
    let output = std::process::Command::new("/usr/bin/osascript").arg("-e").arg(script).output().map_err(|failure| failure.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn denied(said: &str) -> bool {
    said.contains("-1743") || said.contains("Not authorized")
}

fn allowed(player: &str) -> bool {
    crate::settings::read_settings().island.music_allowed.as_ref().and_then(|each| each.get(player)).copied() == Some(true)
}

fn remember(player: &str, granted: bool) {
    if crate::settings::read_settings().island.music_allowed.as_ref().and_then(|each| each.get(player)).copied() == Some(granted) {
        return;
    }
    let _ = crate::settings::update_settings(|settings| {
        settings.island.music_allowed.get_or_insert_with(Default::default).insert(player.to_string(), granted);
    });
}

/// The player to act on: the one last heard, if it is still running, or else whichever runs.
fn current_player() -> Option<(&'static str, &'static str)> {
    let heard = now_playing().lock().ok().and_then(|held| held.as_ref().map(|one| one.player.clone()));
    let preferred = heard.and_then(|player| PLAYERS.iter().find(|(name, _, _)| *name == player).map(|(name, bundle, _)| (*name, *bundle)));
    preferred.filter(|(_, bundle)| running(bundle)).or_else(|| PLAYERS.iter().find(|(_, bundle, _)| running(bundle)).map(|(name, bundle, _)| (*name, *bundle)))
}

/// Asks the player what it is playing, where and how loud. Only once macOS has let Kyuren control
/// that player, since asking otherwise is what brings up the permission prompt.
fn read(app: &AppHandle) {
    let Some((player, bundle)) = current_player() else { return };
    if !allowed(player) {
        return;
    }
    match run(&script(bundle, Action::Read)) {
        Ok(line) => {
            let track = now_playing().lock().ok().and_then(|held| held.as_ref().filter(|one| one.player == player).and_then(|one| one.track.clone()));
            let read = from_read(player, &line, now_ms()).map(|found| Playing { track: found.track.clone().or(track), ..found });
            tell(app, read);
        }
        Err(said) if denied(&said) => remember(player, false),
        Err(_) => {}
    }
}

/// The widget just switched on: each player that is open is asked what it plays, which is when
/// macOS asks, once for each, whether Kyuren may. Whether it may is remembered either way.
pub fn introduce(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        for (player, bundle, _) in PLAYERS {
            if !running(bundle) {
                continue;
            }
            match run(&script(bundle, Action::Read)) {
                Ok(line) => {
                    remember(player, true);
                    if let Some(found) = from_read(player, &line, now_ms()) {
                        tell(&app, Some(found));
                    }
                }
                Err(said) if denied(&said) => remember(player, false),
                Err(_) => {}
            }
        }
    });
}

/// Asked for from the widget, when it has heard nothing yet: the open players are asked what they
/// play, which is when macOS asks whether Kyuren may.
#[tauri::command]
pub fn music_introduce(app: AppHandle) {
    if widget_on("music") {
        introduce(&app);
    }
}

#[tauri::command]
pub fn music_now() -> Option<Playing> {
    now_playing().lock().ok().and_then(|held| held.clone())
}

/// The artwork already found for a track, for an island that has just loaded.
#[tauri::command]
pub fn music_art(track: String) -> Option<String> {
    covers().lock().ok().and_then(|held| match held.held.get(&track) {
        Some(Cover::Found(art)) => Some(art.clone()),
        _ => None,
    })
}

/// Asks the player again, while the glance shows it, and finds the cover of a track already
/// playing when the widget was switched on.
#[tauri::command]
pub async fn music_refresh(app: AppHandle) {
    if !widget_on("music") {
        return;
    }
    if let Some(current) = music_now() {
        look_up_artwork(&app, current, false);
    }
    let _ = tauri::async_runtime::spawn_blocking(move || read(&app)).await;
}

/// A control used on the island: play or pause, skip, seek, or the player's own volume. The first
/// one used is what asks macOS for permission, and whether it was given is remembered. A volume
/// still being slid to is not `settle`d, and the player is read again only once it is.
#[tauri::command]
pub async fn music_control(app: AppHandle, action: String, value: Option<f64>, settle: Option<bool>) -> Result<(), String> {
    let action = match action.as_str() {
        "toggle" => Action::Toggle,
        "next" => Action::Next,
        "previous" => Action::Previous,
        "seek" => Action::Seek(value.ok_or("seeking needs a position")?),
        "volume" => Action::Volume(value.ok_or("a volume needs a level")?),
        _ => return Err(format!("{action} is not something the player does")),
    };
    if !widget_on("music") {
        return Err("the now-playing widget is switched off".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (player, bundle) = current_player().ok_or("neither Spotify nor Music is open")?;
        match run(&script(bundle, action)) {
            Ok(_) => {
                remember(player, true);
                if settle.unwrap_or(true) {
                    read(&app);
                }
                Ok(())
            }
            Err(said) if denied(&said) => {
                remember(player, false);
                Err("Kyuren is not allowed to control the player; it can be allowed in System Settings, Privacy and Security, Automation".into())
            }
            Err(said) => Err(said.trim().to_string()),
        }
    })
    .await
    .map_err(|failure| failure.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs.iter().map(|(key, value)| (key.to_string(), value.clone())).collect()
    }

    #[test]
    fn spotify_says_what_plays_where_and_whether_it_plays() {
        let info = map(&[
            ("Name", json!("Pastel Rain")),
            ("Artist", json!("Sangatsu no Phantasia")),
            ("Album", json!("Girls Blue Happy Sad")),
            ("Duration", json!(211_000.0)),
            ("Playback Position", json!(41.5)),
            ("Player State", json!("Playing")),
            ("Track ID", json!("spotify:track:abc")),
        ]);
        let playing = from_spotify(&info, 7).expect("something plays");
        assert_eq!((playing.duration, playing.position, playing.playing, playing.at), (211.0, Some(41.5), true, 7));
        assert_eq!(playing.track.as_deref(), Some("spotify:track:abc"));
        let stopped = map(&[("Player State", json!("Stopped"))]);
        assert_eq!(from_spotify(&stopped, 7), None, "stopped is nothing playing");
    }

    #[test]
    fn music_says_no_position_and_names_its_track_in_a_store_link() {
        let info = map(&[
            ("Name", json!("Song")),
            ("Total Time", json!(180_000.0)),
            ("Player State", json!("Paused")),
            ("Store URL", json!("itms://itunes.apple.com/album/x/id111?i=222&uo=4")),
        ]);
        let playing = from_music(&info, 1).expect("something is paused");
        assert_eq!((playing.duration, playing.position, playing.playing), (180.0, None, false));
        assert_eq!(playing.track.as_deref(), Some("222"));
        assert_eq!(store_id("https://music.apple.com/album/x?id=1"), None, "an album alone is not a track");
    }

    #[test]
    fn a_control_is_one_line_to_the_player_and_numbers_are_whole() {
        assert_eq!(script("com.spotify.client", Action::Toggle), "with timeout of 3 seconds\ntell application id \"com.spotify.client\" to playpause\nend timeout");
        assert!(script("com.apple.Music", Action::Seek(83.25)).contains("set player position to 83.25"));
        assert!(script("com.apple.Music", Action::Volume(140.0)).contains("set sound volume to 100"), "a volume is kept within the player's range");
        assert!(script("com.apple.Music", Action::Read).contains("((duration of t) * 1000)"), "Music's duration is in seconds");
        assert!(script("com.spotify.client", Action::Read).contains("(duration of t) as integer"), "Spotify's is already milliseconds");
    }

    #[test]
    fn the_same_track_moving_on_as_expected_is_not_news() {
        let was = Playing { player: "spotify".into(), title: "t".into(), duration: 200.0, position: Some(40.0), at: 1_000, playing: true, ..Playing::default() };
        assert!(same(&was, &Playing { position: Some(50.2), at: 11_000, ..was.clone() }), "ten seconds on, ten seconds further");
        assert!(!same(&was, &Playing { position: Some(120.0), at: 11_000, ..was.clone() }), "a seek is news");
        assert!(!same(&was, &Playing { playing: false, ..was.clone() }), "a pause is news");
        assert!(!same(&was, &Playing { title: "u".into(), ..was.clone() }), "another track is news");
    }

    #[test]
    fn a_read_comes_back_as_what_plays() {
        let line = ["Song", "Artist", "Album", "180000", "41500", "playing", "64", ""].join(&FIELD.to_string());
        let playing = from_read("music", &format!("{line}\n"), 9).expect("it plays");
        assert_eq!((playing.duration, playing.position, playing.volume, playing.playing), (180.0, Some(41.5), Some(64.0), true));
        assert_eq!(playing.track, None, "Music says no store id when asked");
        let spotify = ["Song", "Artist", "Album", "211000", "1000", "paused", "40", "spotify:track:abc"].join(&FIELD.to_string());
        assert_eq!(from_read("spotify", &spotify, 9).and_then(|one| one.track).as_deref(), Some("spotify:track:abc"), "Spotify's id finds its cover");
        let stopped = ["", "", "", "0", "0", "stopped", "50", ""].join(&FIELD.to_string());
        assert_eq!(from_read("music", &stopped, 9), None);
        assert_eq!(from_read("music", "too few", 9), None);
    }
}
