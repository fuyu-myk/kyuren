use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// How long a todo may be, and how many the list holds.
const LONGEST: usize = 200;
const MOST: usize = 200;

/// A todo: what it says, whether it is done, and when it was added.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub at: u64,
}

/// Where the list is kept: in Kyuren's own folder, beside its settings.
pub fn todos_file() -> PathBuf {
    crate::settings::kyuren_home().join("todos.json")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or(0)
}

/// One change at a time, so two made together cannot each undo the other.
fn writing() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// The list as kept. Missing is empty; there but unreadable is a refusal, so a list mistyped by
/// hand is left to be mended rather than written over.
fn read_checked(file: &Path) -> Result<Vec<Todo>, String> {
    match std::fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).map_err(|failure| format!("the todo list could not be read, so it was left as it is: {failure}")),
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(failure) => Err(failure.to_string()),
    }
}

/// Written beside the file, readable by this account alone, and renamed over it, so a reader finds
/// the old list or the new one, never half of either.
fn write_whole(file: &Path, todos: &[Todo]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|failure| failure.to_string())?;
    }
    let text = serde_json::to_string_pretty(todos).map_err(|failure| failure.to_string())?;
    let beside = file.with_extension("json.writing");
    let mut out = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(&beside)
        .map_err(|failure| failure.to_string())?;
    out.write_all(text.as_bytes()).map_err(|failure| failure.to_string())?;
    std::fs::rename(&beside, file).map_err(|failure| failure.to_string())
}

/// What a todo says, as kept: one line, its ends trimmed.
pub fn text_of(text: &str) -> Result<String, String> {
    let kept = text.trim();
    if kept.is_empty() {
        return Err("a todo needs something to say".to_string());
    }
    if kept.chars().count() > LONGEST {
        return Err(format!("a todo is at most {LONGEST} characters"));
    }
    if kept.chars().any(char::is_control) {
        return Err("a todo is one line of plain text".to_string());
    }
    Ok(kept.to_string())
}

fn id_for(now: u64, todos: &[Todo]) -> String {
    (0u32..)
        .map(|n| if n == 0 { now.to_string() } else { format!("{now}-{n}") })
        .find(|id| !todos.iter().any(|one| &one.id == id))
        .unwrap_or_default()
}

/// The list with a todo added at its end.
pub fn added(todos: &[Todo], text: &str, now: u64) -> Result<Vec<Todo>, String> {
    let text = text_of(text)?;
    if todos.len() >= MOST {
        return Err(format!("the list holds {MOST} todos; remove some first"));
    }
    let todo = Todo { id: id_for(now, todos), text, done: false, at: now };
    Ok(todos.iter().cloned().chain(std::iter::once(todo)).collect())
}

fn found(todos: &[Todo], id: &str) -> Result<(), String> {
    if todos.iter().any(|one| one.id == id) {
        Ok(())
    } else {
        Err("that todo is no longer on the list".to_string())
    }
}

/// The list with one todo ticked off, or ticked back on.
pub fn ticked(todos: &[Todo], id: &str, done: bool) -> Result<Vec<Todo>, String> {
    found(todos, id)?;
    Ok(todos.iter().map(|one| if one.id == id { Todo { done, ..one.clone() } } else { one.clone() }).collect())
}

pub fn removed(todos: &[Todo], id: &str) -> Result<Vec<Todo>, String> {
    found(todos, id)?;
    Ok(todos.iter().filter(|one| one.id != id).cloned().collect())
}

/// The list without what is done.
pub fn cleared(todos: &[Todo]) -> Vec<Todo> {
    todos.iter().filter(|one| !one.done).cloned().collect()
}

/// A change to the list: read, changed and written whole with no other change between, then told
/// to the island.
fn change_at(file: &Path, change: impl FnOnce(&[Todo]) -> Result<Vec<Todo>, String>) -> Result<Vec<Todo>, String> {
    let _held = writing().lock().map_err(|_| "the todo list is being written elsewhere and that failed".to_string())?;
    let next = change(&read_checked(file)?)?;
    write_whole(file, &next)?;
    Ok(next)
}

async fn changed(app: AppHandle, change: impl FnOnce(&[Todo]) -> Result<Vec<Todo>, String> + Send + 'static) -> Result<Vec<Todo>, String> {
    let next = tauri::async_runtime::spawn_blocking(move || change_at(&todos_file(), change)).await.map_err(|failure| failure.to_string())??;
    let _ = app.emit_to(crate::island::LABEL, "todos:changed", &next);
    Ok(next)
}

#[tauri::command]
pub async fn todos_list() -> Result<Vec<Todo>, String> {
    tauri::async_runtime::spawn_blocking(|| read_checked(&todos_file())).await.map_err(|failure| failure.to_string())?
}

#[tauri::command]
pub async fn todos_add(app: AppHandle, text: String) -> Result<Vec<Todo>, String> {
    changed(app, move |todos| added(todos, &text, now_ms())).await
}

#[tauri::command]
pub async fn todos_tick(app: AppHandle, id: String, done: bool) -> Result<Vec<Todo>, String> {
    changed(app, move |todos| ticked(todos, &id, done)).await
}

#[tauri::command]
pub async fn todos_remove(app: AppHandle, id: String) -> Result<Vec<Todo>, String> {
    changed(app, move |todos| removed(todos, &id)).await
}

/// Takes what is done off the list.
#[tauri::command]
pub async fn todos_clear(app: AppHandle) -> Result<Vec<Todo>, String> {
    changed(app, |todos| Ok(cleared(todos))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn todo(id: &str, done: bool) -> Todo {
        Todo { id: id.to_string(), text: format!("todo {id}"), done, at: 1 }
    }

    #[test]
    fn a_todo_is_one_trimmed_line_of_plain_text() {
        assert_eq!(text_of("  buy milk \n"), Ok("buy milk".to_string()));
        assert!(text_of("   ").is_err());
        assert!(text_of("one\ntwo").is_err(), "one line");
        assert!(text_of("bell\u{7}").is_err());
        assert!(text_of(&"a".repeat(LONGEST)).is_ok());
        assert!(text_of(&"a".repeat(LONGEST + 1)).is_err());
    }

    #[test]
    fn todos_are_added_at_the_end_each_with_its_own_id_and_no_more_than_the_list_holds() {
        let one = added(&[], "first", 1000).expect("added");
        let two = added(&one, "second", 1000).expect("added");
        assert_eq!(two.iter().map(|one| (one.id.as_str(), one.text.as_str())).collect::<Vec<_>>(), vec![("1000", "first"), ("1000-1", "second")]);
        let full: Vec<Todo> = (0..MOST).map(|at| todo(&at.to_string(), false)).collect();
        assert!(added(&full, "one too many", 1).is_err());
    }

    #[test]
    fn a_todo_is_ticked_removed_or_cleared_once_done_and_one_gone_is_said_to_be() {
        let list = vec![todo("a", false), todo("b", false), todo("c", true)];
        let ticked_off = ticked(&list, "a", true).expect("ticked");
        assert_eq!(ticked_off.iter().map(|one| one.done).collect::<Vec<_>>(), vec![true, false, true]);
        assert!(!ticked(&ticked_off, "a", false).expect("back on")[0].done, "ticked back on");
        assert_eq!(removed(&list, "b").expect("removed").iter().map(|one| one.id.as_str()).collect::<Vec<_>>(), vec!["a", "c"]);
        assert_eq!(cleared(&ticked_off).iter().map(|one| one.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        assert!(ticked(&list, "gone", true).is_err());
        assert!(removed(&list, "gone").is_err());
    }

    #[test]
    fn the_list_is_written_whole_for_this_account_alone_and_a_mistyped_one_is_left_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kyuren-todos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("todos.json");
        assert_eq!(change_at(&file, |todos| added(todos, "buy milk", 5)).expect("written").len(), 1);
        assert_eq!(read_checked(&file).expect("read")[0].text, "buy milk");
        assert_eq!(std::fs::metadata(&file).expect("there").permissions().mode() & 0o777, 0o600);
        std::fs::write(&file, "{ not a list").expect("mistyped");
        assert!(change_at(&file, |todos| added(todos, "more", 6)).is_err());
        assert_eq!(std::fs::read_to_string(&file).expect("kept"), "{ not a list");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
