use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::settings::{read_settings, write_settings};
use crate::sidecar::Sidecar;
use crate::state::{Sidecars, GATHER_TIMEOUT, PING_TIMEOUT};

fn core(app: &AppHandle) -> Result<Arc<Sidecar>, String> {
    app.try_state::<Sidecars>()
        .map(|state| Arc::clone(&state.core))
        .ok_or_else(|| "cognition is not running".to_string())
}

/// The engines as set, and the ones in use, which are the core's defaults where none is set.
#[tauri::command]
pub async fn web_engine(app: AppHandle) -> Result<Value, String> {
    let set = read_settings().web;
    let live = core(&app)?
        .request("web.engine", json!({}), PING_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())?;
    Ok(json!({
        "set": set.engine,
        "live": live.get("engine").cloned().unwrap_or(Value::Null),
        "fallbackSet": set.fallback,
        "fallbackLive": live.get("fallback").cloned().unwrap_or(Value::Null),
    }))
}

/// An engine template as the user gave it: empty for the default, otherwise a web address with
/// {query} in it, so a search can never be sent somewhere that is not a search.
fn template(engine: &str) -> Result<Option<String>, String> {
    let trimmed = engine.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("the engine must be a web address".into());
    }
    if !trimmed.contains("{query}") {
        return Err("the engine must contain {query} where the words go".into());
    }
    // Searches are read through the reader, which never reaches nearby, so such an engine is
    // refused when it is set rather than every search failing later.
    let at = tauri::Url::parse(&trimmed.replace("{query}", "x")).map_err(|_| "the engine must be a web address".to_string())?;
    if crate::nearby::nearby(&at) {
        return Err("the reader reaches only the public web, and that engine is on this machine or its network".into());
    }
    Ok(Some(trimmed.to_string()))
}

/// Sets where searches go. Empty puts the default back.
#[tauri::command]
pub async fn web_engine_set(engine: String) -> Result<Value, String> {
    let mut settings = read_settings();
    settings.web.engine = template(&engine)?;
    write_settings(&settings)?;
    Ok(json!({ "engine": settings.web.engine }))
}

/// Sets where a search goes when the first engine refuses it or finds nothing. Empty puts the
/// default back.
#[tauri::command]
pub async fn web_fallback_set(engine: String) -> Result<Value, String> {
    let mut settings = read_settings();
    settings.web.fallback = template(&engine)?;
    write_settings(&settings)?;
    Ok(json!({ "fallback": settings.web.fallback }))
}

/// One search, from the window, to see the browser and the engine working.
#[tauri::command]
pub async fn web_search_try(app: AppHandle, query: String) -> Result<Value, String> {
    core(&app)?
        .request("web.search", json!({ "query": query }), GATHER_TIMEOUT)
        .await
        .map_err(|failure| failure.to_string())
}

#[cfg(test)]
mod tests {
    use super::template;

    #[test]
    fn an_engine_is_a_web_address_with_a_place_for_the_words() {
        assert_eq!(template("  "), Ok(None));
        assert_eq!(
            template(" https://www.bing.com/search?q={query} "),
            Ok(Some("https://www.bing.com/search?q={query}".into()))
        );
        assert!(template("file:///etc/passwd?q={query}").is_err());
        assert!(template("https://www.bing.com/search").is_err());
    }

    #[test]
    fn an_engine_on_this_machine_or_its_network_is_refused_when_it_is_set() {
        for engine in ["http://localhost:8888/search?q={query}", "http://192.168.1.20/?q={query}", "http://searx/?q={query}"] {
            assert!(template(engine).is_err_and(|why| why.contains("this machine or its network")), "{engine}");
        }
    }
}
