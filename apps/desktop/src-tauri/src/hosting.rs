use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication};

/// Processes climbed through before giving up: a session sits a few below its app.
const DEPTH: usize = 16;

/// The nearest process, from one up through its parents, that is an app with windows: the app a
/// coding session runs in, as Claude's desktop app or VS Code is to the sessions it starts.
pub fn hosting(pid: i32, parent: impl Fn(i32) -> Option<i32>, is_app: impl Fn(i32) -> bool) -> Option<i32> {
    let mut at = pid;
    for _ in 0..DEPTH {
        if is_app(at) {
            return Some(at);
        }
        match parent(at) {
            Some(up) if up > 1 && up != at => at = up,
            _ => return None,
        }
    }
    None
}

fn parent_of(pid: i32) -> Option<i32> {
    // SAFETY: an all-zero proc_bsdinfo is a valid value of a plain C struct, which the kernel fills
    // when it answers, and the size given is that struct's own.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    // SAFETY: the buffer is the struct above and the size its size, as the call requires.
    let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&mut info as *mut libc::proc_bsdinfo).cast(), size) };
    (read == size).then_some(info.pbi_ppid as i32)
}

/// An app with windows of its own, by the name it goes by and how Launch Services knows it.
fn app_at(pid: i32) -> Option<(String, String)> {
    let running = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
    if running.activationPolicy() != NSApplicationActivationPolicy::Regular {
        return None;
    }
    let bundle = running.bundleIdentifier()?.to_string();
    let name = running.localizedName().map(|name| name.to_string()).unwrap_or_else(|| bundle.clone());
    Some((name, bundle))
}

/// Brings forward the app a process runs in, as its icon in the Dock would, and says which it was.
/// Launch Services does the bringing, since an app asking to be brought forward is refused when
/// the one asking is not itself in front, and the island never takes the front.
pub fn reveal(pid: i32) -> Result<String, String> {
    let app = hosting(pid, parent_of, |at| app_at(at).is_some()).ok_or("the app the session runs in was not found")?;
    let (name, bundle) = app_at(app).ok_or("the app the session runs in has closed")?;
    if !bundle.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return Err(format!("{name} cannot be brought forward by name"));
    }
    let opened = std::process::Command::new("/usr/bin/open").arg("-b").arg(&bundle).status().map_err(|failure| failure.to_string())?;
    if opened.success() {
        Ok(name)
    } else {
        Err(format!("{name} could not be brought forward"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_session_is_found_in_the_nearest_app_above_its_process() {
        // A session's process under Claude's helper under Claude, as the desktop app starts them.
        let parents: HashMap<i32, i32> = HashMap::from([(900, 800), (800, 700), (700, 1)]);
        let parent = |pid: i32| parents.get(&pid).copied();
        assert_eq!(hosting(900, parent, |pid| pid == 700), Some(700));
        assert_eq!(hosting(900, parent, |pid| pid == 800), Some(800), "the nearest");
        assert_eq!(hosting(900, parent, |_| false), None, "no app above it, launchd is not one");
        let looped = |pid: i32| Some(pid);
        assert_eq!(hosting(5, looped, |_| false), None, "a process its own parent ends the walk");
    }

    #[test]
    fn a_process_knows_its_parent() {
        assert_eq!(parent_of(std::process::id() as i32), Some(std::os::unix::process::parent_id() as i32));
    }
}
