use std::path::PathBuf;

pub fn workspace_root() -> PathBuf {
    if let Ok(explicit) = std::env::var("KYUREN_WORKSPACE_ROOT") {
        return PathBuf::from(explicit);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("manifest is nested under the workspace root")
        .to_path_buf()
}

/// The PATH an application gets from the Dock or the Finder is launchd's bare one, which has no
/// node and no claude on it. The user's login shell knows where those live, so it is asked once,
/// and its answer becomes this process's PATH before any sidecar is spawned. Everything spawned
/// afterwards inherits it, which is the whole point.
pub async fn adopt_login_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let asked = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        tokio::task::spawn_blocking(move || {
            // Interactive and login both, so that .zprofile and .zshrc each get their say; the
            // path is printed last so that anything the shell prints first can be ignored.
            std::process::Command::new(&shell)
                .args(["-lic", "printf '\\n__KYUREN_PATH__%s\\n' \"$PATH\""])
                .stdin(std::process::Stdio::null())
                .output()
                .ok()
        }),
    )
    .await;

    let Ok(Ok(Some(output))) = asked else { return };
    let text = String::from_utf8_lossy(&output.stdout);
    let Some(found) = text.lines().rev().find_map(|line| line.strip_prefix("__KYUREN_PATH__")) else {
        return;
    };
    let found = found.trim();
    if found.is_empty() {
        return;
    }
    // What launchd gave is kept at the end, so nothing the shell forgot goes missing either.
    let current = std::env::var("PATH").unwrap_or_default();
    let merged = if current.is_empty() { found.to_string() } else { format!("{found}:{current}") };
    std::env::set_var("PATH", merged);
}
