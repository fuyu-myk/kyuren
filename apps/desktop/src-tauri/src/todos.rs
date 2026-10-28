use serde_json::{json, Value};
use tauri::State;

use crate::state::{Sidecars, GATHER_TIMEOUT};

/// The todos live in the Notion database chosen for them, which only the core reaches; each of
/// these asks it, and it checks what it is given.
async fn asked(sidecars: &Sidecars, method: &str, params: Value) -> Result<Value, String> {
    sidecars.core.request(method, params, GATHER_TIMEOUT).await.map_err(|failure| failure.to_string())
}

/// The todos not yet done, with the database they are kept in and what it can hold.
#[tauri::command]
pub async fn todos_list(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "todos.list", json!({})).await
}

/// Adds a todo, with a date, a time, a priority and a note as wanted.
#[tauri::command]
pub async fn todos_add(
    text: String,
    date: Option<String>,
    time: Option<String>,
    priority: Option<String>,
    note: Option<String>,
    sidecars: State<'_, Sidecars>,
) -> Result<Value, String> {
    let params = json!({ "text": text, "date": date, "time": time, "priority": priority, "note": note });
    asked(&sidecars, "todos.add", params).await
}

/// Ticks a todo off, or back on.
#[tauri::command]
pub async fn todos_tick(id: String, done: bool, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "todos.tick", json!({ "id": id, "done": done })).await
}

/// Whether Notion is connected, the databases shared with Kyuren, and which one holds the todos.
#[tauri::command]
pub async fn notion_todos(sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "notion.todos", json!({})).await
}

/// Chooses the database the todos are kept in, or none.
#[tauri::command]
pub async fn notion_todos_choose(id: Option<String>, sidecars: State<'_, Sidecars>) -> Result<Value, String> {
    asked(&sidecars, "notion.todos.choose", json!({ "id": id })).await
}
