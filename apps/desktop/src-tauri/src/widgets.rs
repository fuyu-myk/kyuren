use tauri::{AppHandle, Emitter};

/// The widgets the island's glance tab can hold, in the order they are shown.
pub const WIDGETS: [&str; 4] = ["music", "pomodoro", "network", "system"];

/// The widgets switched on, in the order the user arranged them, unknown names dropped. Nothing set
/// is none: a widget reads the machine or the music, so it is asked for rather than assumed.
pub fn widgets_from(set: Option<&[String]>) -> Vec<String> {
    crate::island::chosen_from(&WIDGETS, set.unwrap_or(&[]))
}

fn sampled(widgets: &[String]) -> bool {
    widgets.iter().any(|one| one == "network" || one == "system")
}

/// At launch: sampling runs only if a widget that needs it is on.
pub fn install(app: &AppHandle) {
    let widgets = widgets_from(crate::settings::read_settings().island.widgets.as_deref());
    crate::stats::want(app, sampled(&widgets));
}

#[tauri::command]
pub fn island_widgets() -> Vec<String> {
    widgets_from(crate::settings::read_settings().island.widgets.as_deref())
}

/// Sets which widgets the glance holds, tells the island at once, and starts or stops sampling.
#[tauri::command]
pub fn island_widgets_set(app: AppHandle, widgets: Vec<String>) -> Result<Vec<String>, String> {
    let kept = widgets_from(Some(&widgets));
    let had_music = widgets_from(crate::settings::read_settings().island.widgets.as_deref()).iter().any(|one| one == "music");
    crate::settings::update_settings(|settings| settings.island.widgets = Some(kept.clone()))?;
    crate::stats::want(&app, sampled(&kept));
    let _ = app.emit_to(crate::island::LABEL, "island:widgets", &kept);
    // Switched on, the music widget asks the player what it plays now rather than waiting for the
    // next track; this is the moment macOS asks whether Kyuren may, being the moment it was wanted.
    if !had_music && kept.iter().any(|one| one == "music") {
        crate::media::introduce(&app);
    }
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widgets_are_asked_for_kept_as_arranged_and_unknown_names_dropped() {
        assert!(widgets_from(None).is_empty(), "nothing is on until it is asked for");
        let chosen = vec!["system".to_string(), "bogus".to_string(), "music".to_string()];
        assert_eq!(widgets_from(Some(&chosen)), vec!["system", "music"], "in the order arranged");
        assert!(sampled(&["network".to_string()]));
        assert!(!sampled(&["music".to_string(), "pomodoro".to_string()]), "the clock and the music need no sampling");
    }
}
