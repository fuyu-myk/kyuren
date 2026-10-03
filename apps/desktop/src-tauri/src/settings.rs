use serde::{Deserialize, Serialize};

use crate::wake::Wake;

/// Where a search goes: a template with {query} in it, and a second for when the first refuses or
/// finds nothing. Empty means the core's default for each.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Web {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
}

/// Which of the island's tabs are shown, None meaning all of them, and which widgets its glance
/// tab holds, None meaning none: widgets are asked for, never assumed.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Island {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tabs: Option<Vec<String>>,
    /// The tabs there were when they were last arranged, so one added since is shown rather than
    /// taken for one hidden.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub widgets: Option<Vec<String>>,
    /// The playbooks the island's shortcuts page offers, in the order chosen; none until chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcuts: Option<Vec<String>>,
    /// The page the island opens on whenever the notch is expanded; none is what needs the user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home: Option<String>,
    /// Which music players macOS has let Kyuren control, each learned the first time a control is
    /// used on it, since the permission is given per player; a player is asked for its position
    /// only once it is so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub music_allowed: Option<std::collections::BTreeMap<String, bool>>,
}

/// Everything the application remembers between launches, in one file a person can read and edit.
/// The core reads what it needs from the same file, so a change here is a change there.
#[derive(Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub wake: Wake,
    #[serde(default)]
    pub web: Web,
    #[serde(default)]
    pub island: Island,
    /// The pomodoro, kept so a period left running carries over a restart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pomodoro: Option<crate::pomodoro::Pomodoro>,
}

pub fn kyuren_home() -> std::path::PathBuf {
    let home = std::env::var("KYUREN_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/.kyuren")
    });
    std::path::PathBuf::from(home)
}

pub fn settings_path() -> std::path::PathBuf {
    kyuren_home().join("settings.json")
}

/// Kyuren's folder holds what was said to it, what it did and the notes in its vault, so no other
/// account on the machine may look inside, whatever made the folder first.
pub fn keep_private(home: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(home)?;
    std::fs::set_permissions(home, std::fs::Permissions::from_mode(0o700))
}

pub fn read_settings() -> Settings {
    std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// One writer at a time, so two changes made together cannot each undo the other.
fn writing() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

/// The file as it stands. Missing is the defaults; there but unreadable is a refusal, so a file
/// someone mistyped is left for them to mend rather than written over with defaults.
fn read_checked(path: &std::path::Path) -> Result<Settings, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|failure| format!("the settings file could not be read, so it was left as it is: {failure}")),
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(failure) => Err(failure.to_string()),
    }
}

/// Written beside the file and renamed over it, so a reader finds the old file or the new one,
/// never half of either.
fn write_whole(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|failure| failure.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|failure| failure.to_string())?;
    let beside = path.with_extension("json.writing");
    std::fs::write(&beside, text).map_err(|failure| failure.to_string())?;
    std::fs::rename(&beside, path).map_err(|failure| failure.to_string())
}

fn update_at(path: &std::path::Path, change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
    let _held = writing().lock().map_err(|_| "settings are being written elsewhere and that failed".to_string())?;
    let mut settings = read_checked(path)?;
    change(&mut settings);
    write_whole(path, &settings)?;
    Ok(settings)
}

/// Changes the settings in one step: read, changed and written whole, with no other change between.
pub fn update_settings(change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
    update_at(&settings_path(), change)
}

pub fn write_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    let _held = writing().lock().map_err(|_| "settings are being written elsewhere and that failed".to_string())?;
    read_checked(&path)?;
    write_whole(&path, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_is_written_whole_and_a_mistyped_file_is_left_alone() {
        let dir = std::env::temp_dir().join(format!("kyuren-settings-{}", std::process::id()));
        let path = dir.join("settings.json");
        let _ = std::fs::remove_dir_all(&dir);

        let made = update_at(&path, |one| one.island.widgets = Some(vec!["system".into()])).expect("a missing file is the defaults");
        assert_eq!(made.island.widgets, Some(vec!["system".to_string()]));
        assert_eq!(read_checked(&path).ok().and_then(|one| one.island.widgets), Some(vec!["system".to_string()]));
        assert!(!path.with_extension("json.writing").exists(), "nothing is left beside it");

        std::fs::write(&path, "{ \"island\": { \"widgets\": [\"system\" ").expect("written");
        assert!(update_at(&path, |one| one.island.widgets = None).is_err(), "a file that cannot be read is not written over");
        assert!(std::fs::read_to_string(&path).expect("still there").contains("system"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kyurens_folder_is_closed_to_every_other_account_whoever_made_it() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kyuren-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mode = |path: &std::path::Path| std::fs::metadata(path).expect("there").permissions().mode() & 0o777;

        keep_private(&dir).expect("made");
        assert_eq!(mode(&dir), 0o700);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("opened");
        std::fs::write(dir.join("events.log"), "kept\n").expect("written");
        keep_private(&dir).expect("closed");
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(std::fs::read_to_string(dir.join("events.log")).expect("still there"), "kept\n", "nothing in it is touched");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
