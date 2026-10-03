use tauri::{AppHandle, Emitter};

/// More shortcuts than this is not a row of keys anyone reads at a glance.
const MOST: usize = 24;
/// A playbook's name is a word or a few, never a paragraph.
const LONGEST: usize = 100;

/// The playbooks chosen as shortcuts, as kept: named plainly, each once, in the order chosen.
pub fn names_from(chosen: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for one in chosen {
        let name = one.trim();
        if name.is_empty() || name.len() > LONGEST || name.chars().any(char::is_control) || kept.iter().any(|was| was == name) {
            continue;
        }
        kept.push(name.to_string());
        if kept.len() == MOST {
            break;
        }
    }
    kept
}

/// The playbooks the island's shortcuts page offers, in the order chosen; none until chosen.
#[tauri::command]
pub fn island_shortcuts() -> Vec<String> {
    names_from(&crate::settings::read_settings().island.shortcuts.unwrap_or_default())
}

/// Chooses the playbooks the island offers as shortcuts, and tells the island at once. Whether each
/// is approved is the core's to say when it is run; an unapproved one is never shown.
#[tauri::command]
pub fn island_shortcuts_set(app: AppHandle, names: Vec<String>) -> Result<Vec<String>, String> {
    let kept = names_from(&names);
    crate::settings::update_settings(|settings| settings.island.shortcuts = Some(kept.clone()))?;
    let _ = app.emit_to(crate::island::LABEL, "island:shortcuts", &kept);
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_are_kept_as_chosen_named_plainly_and_each_once() {
        let given: Vec<String> = ["standup", " research ", "", "standup", "a\nb", &"x".repeat(101), "note"].iter().map(|one| one.to_string()).collect();
        assert_eq!(names_from(&given), vec!["standup", "research", "note"]);
        let many: Vec<String> = (0..40).map(|at| format!("book-{at}")).collect();
        assert_eq!(names_from(&many).len(), MOST);
    }
}
