use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSArray, NSFileManager, NSString, NSURL};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::shelf_icon::{draw_icons, icon_file};

/// More than this many at once is not a drop someone meant.
const MOST_AT_ONCE: usize = 50;
/// A drop is kept only this soon after it is made, since the page asks for it as it lands.
const FRESH: Duration = Duration::from_secs(10);
/// What Finder leaves in a folder it has shown, which is not something kept.
const FINDER_NOTES: &str = ".DS_Store";

/// Something on the shelf.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelved {
    pub id: String,
    /// Its own name, which is what a messenger shows when it is dragged in.
    pub name: String,
    #[serde(skip_serializing)]
    pub path: PathBuf,
    pub folder: bool,
    /// Bytes, for a file.
    pub size: u64,
    pub added: u64,
    /// Its Finder icon as an image in hand, since the island loads nothing from disk itself.
    pub icon: Option<String>,
}

/// Something dropped on the shelf, which stays where it was until it is dragged out: where it was,
/// and its disk and its number there, which find it again however it is renamed or moved on that
/// disk, and never find another file in its place.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Pointer {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<u64>,
}

/// Where something pointed at is now.
#[derive(Clone, Debug, PartialEq)]
pub enum Found {
    At(PathBuf),
    /// Deleted, or in the Trash.
    Gone,
    /// On a disk that is not there now, or not answering: looked for again later, not let go of.
    Unreachable,
}

/// A volume as fsgetpath takes it; only its first number, the device, is read.
#[repr(C)]
struct VolumeId {
    val: [i32; 2],
}

extern "C" {
    /// The path a file has now, from its volume and its number on it (sys/fsgetpath.h).
    fn fsgetpath(buf: *mut libc::c_char, size: libc::size_t, fsid: *mut VolumeId, object: u64) -> libc::ssize_t;
}

/// How something is on the shelf. Pointed at, it is where it was dropped from; held, the file itself
/// lives on the shelf, as everything dropped did before the shelf kept a place instead of a file.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Pointed,
    Held,
}

/// Where the shelf keeps what is on it: a small file for each thing pointed at, named for when it
/// came, and a folder for each thing held.
pub fn shelf_dir() -> PathBuf {
    crate::settings::settings_path().parent().map(Path::to_path_buf).unwrap_or_default().join("shelf")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_millis() as u64).unwrap_or(0)
}

/// A drop as the window reported it, and when.
type Drop = (Instant, Vec<PathBuf>);

/// What was last dropped on the island.
fn last_drop() -> &'static Mutex<Option<Drop>> {
    static LAST: OnceLock<Mutex<Option<Drop>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

/// Remembers what was dropped on the island, which is all the shelf takes: the page says when to
/// keep a drop, never what is in it.
pub fn dropped(paths: &[PathBuf]) {
    if let Ok(mut last) = last_drop().lock() {
        *last = Some((Instant::now(), paths.to_vec()));
    }
}

/// The last drop, once, and only while it is fresh.
fn take_drop() -> Vec<PathBuf> {
    let taken = last_drop().lock().ok().and_then(|mut last| last.take());
    taken.filter(|(at, _)| at.elapsed() <= FRESH).map(|(_, paths)| paths).unwrap_or_default()
}

/// A name for something new: when it came, made unique among those already there.
pub fn id_for(now: u64, taken: &[String]) -> String {
    let base = now.to_string();
    if !taken.contains(&base) {
        return base;
    }
    (2..).map(|count| format!("{base}-{count}")).find(|id| !taken.contains(id)).unwrap_or(base)
}

/// An id is a time and perhaps a count, never a path.
pub fn valid_id(id: &str) -> bool {
    let digits = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit());
    match id.split_once('-') {
        Some((time, count)) => digits(time) && digits(count),
        None => digits(id),
    }
}

/// When an id came and its count within that moment, for putting the newest first.
fn order_of(id: &str) -> (u64, u64) {
    let (time, count) = id.split_once('-').unwrap_or((id, "1"));
    (time.parse().unwrap_or(0), count.parse().unwrap_or(1))
}

fn pointer_file(root: &Path, id: &str) -> PathBuf {
    root.join(format!("{id}.json"))
}

/// A file or folder as what it is rather than how its path is spelled, which a case or a firmlink
/// can change.
fn identity(path: &Path) -> Option<(u64, u64)> {
    std::fs::metadata(path).ok().map(|meta| (meta.dev(), meta.ino()))
}

/// What a drop may bring: whole paths to things that are there. Something already on the shelf,
/// dragged out and back, is left where it is. A folder holding the shelf, or a whole disk, is not
/// something to drag about from a shelf.
pub fn droppable(root: &Path, paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    if paths.len() > MOST_AT_ONCE {
        return Err(format!("the shelf takes at most {MOST_AT_ONCE} things at once"));
    }
    let shelf = identity(root);
    let holding: Vec<(u64, u64)> = root.ancestors().filter_map(identity).collect();
    let mut wanted = Vec::new();
    for path in paths {
        if !path.is_absolute() || path.file_name().is_none() {
            return Err(format!("{} is not a whole path", path.display()));
        }
        let real = path.canonicalize().map_err(|_| format!("{} is not there", path.display()))?;
        if shelf.is_some() && real.ancestors().skip(1).filter_map(identity).any(|one| Some(one) == shelf) {
            continue;
        }
        let Some((dev, ino)) = identity(&real) else {
            return Err(format!("{} is not there", path.display()));
        };
        if holding.contains(&(dev, ino)) {
            return Err(format!("{} holds the shelf itself", path.display()));
        }
        if real.parent().and_then(identity).is_some_and(|(above, _)| above != dev) {
            return Err(format!("{} is a whole disk", path.display()));
        }
        wanted.push(path.clone());
    }
    Ok(wanted)
}

/// The disk and number of what a path names itself, a link as the link.
fn file_id(path: &Path) -> Option<(i32, u64)> {
    std::fs::symlink_metadata(path).ok().map(|meta| (meta.dev() as i32, meta.ino()))
}

/// The path a file on a disk has now, from its number there.
fn path_of(volume: i32, file: u64) -> Found {
    let mut buffer = vec![0u8; libc::PATH_MAX as usize + 1];
    let mut id = VolumeId { val: [volume, 0] };
    // SAFETY: the buffer is writable for the whole length given, and the volume a valid fsid_t.
    let length = unsafe { fsgetpath(buffer.as_mut_ptr().cast(), buffer.len(), &mut id, file) };
    if length < 0 {
        return match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ENOENT) => Found::Gone,
            _ => Found::Unreachable,
        };
    }
    let end = buffer.iter().position(|byte| *byte == 0).unwrap_or(buffer.len());
    Found::At(PathBuf::from(OsStr::from_bytes(&buffer[..end])))
}

/// In a Trash, which to the shelf is as good as gone.
fn trashed(path: &Path) -> bool {
    path.components().any(|part| part.as_os_str() == ".Trash" || part.as_os_str() == ".Trashes")
}

/// Where something pointed at is now. Found by its number on its disk first, which follows it
/// through renames and moves and never finds another file. Once that is gone, what stands at the
/// path it was dropped from is taken for it, since an app saving a document replaces the file
/// with a new one under the same name.
pub fn resolved(pointer: &Pointer) -> Found {
    if let (Some(volume), Some(file)) = (pointer.volume, pointer.file) {
        match path_of(volume, file) {
            Found::At(path) if trashed(&path) => return Found::Gone,
            Found::At(path) => return Found::At(path),
            Found::Unreachable => return Found::Unreachable,
            Found::Gone => {}
        }
    }
    let path = PathBuf::from(&pointer.path);
    match std::fs::symlink_metadata(&path) {
        Ok(_) if trashed(&path) => Found::Gone,
        Ok(_) => Found::At(path),
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => Found::Gone,
        Err(_) => Found::Unreachable,
    }
}

fn read_pointer(file: &Path) -> Option<Pointer> {
    std::fs::read_to_string(file).ok().and_then(|text| serde_json::from_str(&text).ok())
}

/// One drop added at a time, so two cannot take the same name.
fn adding() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Puts things on the shelf by pointing at them where they are, which is where they stay until
/// they are dragged out. Something already pointed at is not pointed at twice. Says which were put.
pub fn point_at(root: &Path, paths: &[PathBuf], now: u64) -> Result<Vec<String>, String> {
    let _held = adding().lock().map_err(|_| "an earlier drop failed partway".to_string())?;
    std::fs::create_dir_all(root).map_err(|failure| failure.to_string())?;
    let mut taken: Vec<String> = entries(root).into_iter().map(|(id, _)| id).collect();
    let mut known: Vec<(i32, u64)> = entries(root)
        .into_iter()
        .filter(|(_, kind)| *kind == Kind::Pointed)
        .filter_map(|(id, _)| read_pointer(&pointer_file(root, &id)))
        .filter_map(|pointer| pointer.volume.zip(pointer.file))
        .collect();
    let mut added = Vec::new();
    for path in paths {
        let Some(it) = file_id(path) else { continue };
        if known.contains(&it) {
            continue;
        }
        let id = id_for(now, &taken);
        let pointer = Pointer { path: path.to_string_lossy().to_string(), volume: Some(it.0), file: Some(it.1) };
        let text = serde_json::to_string(&pointer).map_err(|failure| failure.to_string())?;
        let beside = root.join(format!(".{id}.json.writing"));
        std::fs::write(&beside, text).and_then(|()| std::fs::rename(&beside, pointer_file(root, &id))).map_err(|failure| failure.to_string())?;
        taken.push(id.clone());
        known.push(it);
        added.push(id);
    }
    Ok(added)
}

/// Every id on the shelf and how it is there.
fn entries(root: &Path) -> Vec<(String, Kind)> {
    let Ok(found) = std::fs::read_dir(root) else { return Vec::new() };
    found
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            match name.strip_suffix(".json") {
                Some(id) if valid_id(id) && entry.path().is_file() => Some((id.to_string(), Kind::Pointed)),
                None if valid_id(&name) && entry.path().is_dir() => Some((name, Kind::Held)),
                _ => None,
            }
        })
        .collect()
}

fn item_in(folder: &Path) -> Option<PathBuf> {
    let mut found: Vec<std::fs::DirEntry> = std::fs::read_dir(folder).ok()?.flatten().filter(|entry| entry.file_name() != FINDER_NOTES).collect();
    found.sort_by_key(std::fs::DirEntry::file_name);
    found.into_iter().next().map(|entry| entry.path())
}

/// Where what an id names is, by how it is on the shelf.
fn found(root: &Path, id: &str, kind: &Kind) -> Found {
    match kind {
        Kind::Pointed => read_pointer(&pointer_file(root, id)).map_or(Found::Gone, |pointer| resolved(&pointer)),
        Kind::Held => item_in(&root.join(id)).map_or(Found::Gone, Found::At),
    }
}

/// Takes an id off the shelf with its icon. Something pointed at is only no longer pointed at: it
/// is wherever it is. A folder held is cleared only when it holds nothing else. Says whether it
/// went.
fn clear(root: &Path, id: &str, kind: &Kind) -> bool {
    let gone = match kind {
        Kind::Pointed => std::fs::remove_file(pointer_file(root, id)).is_ok(),
        Kind::Held => {
            let folder = root.join(id);
            let _ = std::fs::remove_file(folder.join(FINDER_NOTES));
            std::fs::remove_dir(&folder).is_ok()
        }
    };
    if gone {
        let _ = std::fs::remove_file(icon_file(root, id));
    }
    gone
}

/// What is on the shelf, newest first. What is gone, moved out or deleted, is cleared away, but only
/// while nothing is being added; holding the lock as it lists keeps an add from starting meanwhile.
pub fn list_in(root: &Path) -> Vec<Shelved> {
    let quiet = adding().try_lock();
    listing(root, quiet.is_ok())
}

fn listing(root: &Path, clearing: bool) -> Vec<Shelved> {
    let mut shelved: Vec<Shelved> = Vec::new();
    for (id, kind) in entries(root) {
        let path = match found(root, &id, &kind) {
            Found::At(path) => path,
            Found::Gone => {
                if clearing {
                    clear(root, &id, &kind);
                }
                continue;
            }
            Found::Unreachable => continue,
        };
        let meta = std::fs::symlink_metadata(&path).ok();
        shelved.push(Shelved {
            name: path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default(),
            folder: meta.as_ref().is_some_and(std::fs::Metadata::is_dir),
            size: meta.as_ref().filter(|meta| meta.is_file()).map_or(0, std::fs::Metadata::len),
            added: order_of(&id).0,
            icon: None,
            path,
            id,
        });
    }
    shelved.sort_by_key(|one| std::cmp::Reverse(order_of(&one.id)));
    shelved
}

/// What an id names on the shelf, found by the id alone: an id is never a path.
pub fn kept(id: &str) -> Result<(PathBuf, Kind), String> {
    let gone = || format!("{id} is not on the shelf");
    if !valid_id(id) {
        return Err(gone());
    }
    let root = shelf_dir();
    let kind = if pointer_file(&root, id).is_file() { Kind::Pointed } else { Kind::Held };
    match found(&root, id, &kind) {
        Found::At(path) => Ok((path, kind)),
        Found::Gone => Err(gone()),
        Found::Unreachable => Err(format!("{id} is on a disk that is not there now")),
    }
}

fn trash(path: &Path) -> Result<(), String> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None).map_err(|failure| failure.localizedDescription().to_string())
}

/// Takes something off the shelf. Pointed at, it stays where it is and the shelf only lets go of
/// it; held, the shelf's own file goes to the Trash rather than gone, since it may be the only
/// copy, and put back from there it is on the shelf again.
pub fn forget(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("{id} is not on the shelf"));
    }
    if pointer_file(root, id).is_file() {
        return if clear(root, id, &Kind::Pointed) { Ok(()) } else { Err(format!("{id} could not be taken off the shelf")) };
    }
    if let Some(item) = item_in(&root.join(id)) {
        trash(&item)?;
    }
    clear(root, id, &Kind::Held);
    Ok(())
}

/// The shelf with its icons. Not to be called on the main thread: what is on it may be on a slow
/// disk, and nothing that waits on one should keep the app from drawing.
fn listed() -> Vec<Shelved> {
    let root = shelf_dir();
    let items = list_in(&root);
    let drawing: Vec<(String, PathBuf)> = items.iter().map(|one| (one.id.clone(), one.path.clone())).collect();
    draw_icons(&root, &drawing);
    items
        .into_iter()
        .map(|one| {
            let icon = std::fs::read(icon_file(&root, &one.id))
                .ok()
                .map(|png| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)));
            Shelved { icon, ..one }
        })
        .collect()
}

pub(crate) fn changed(app: &AppHandle) -> Vec<Shelved> {
    let items = listed();
    let _ = app.emit_to(crate::island::LABEL, "shelf:changed", &items);
    items
}

#[tauri::command]
pub async fn shelf_list() -> Vec<Shelved> {
    tauri::async_runtime::spawn_blocking(listed).await.unwrap_or_default()
}

/// Puts what was just dropped on the island on the shelf, leaving it where it is.
#[tauri::command]
pub async fn shelf_add(app: AppHandle) -> Result<Vec<Shelved>, String> {
    let paths = take_drop();
    if paths.is_empty() {
        return Err("nothing was dropped to keep".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = shelf_dir();
        let pointed = droppable(&root, &paths).and_then(|wanted| point_at(&root, &wanted, now_ms()));
        let items = changed(&app);
        pointed.map(|_| items)
    })
    .await
    .map_err(|failure| failure.to_string())?
}

/// Takes something off the shelf, leaving it where it is if it was only pointed at.
#[tauri::command]
pub async fn shelf_remove(app: AppHandle, id: String) -> Result<Vec<Shelved>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        forget(&shelf_dir(), &id)?;
        Ok(changed(&app))
    })
    .await
    .map_err(|failure| failure.to_string())?
}

/// Shows something on the shelf in the Finder, selected. Found off the main thread, since it may
/// be on a slow disk.
#[tauri::command]
pub async fn shelf_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let (path, _) = tauri::async_runtime::spawn_blocking(move || kept(&id)).await.map_err(|failure| failure.to_string())??;
    app.run_on_main_thread(move || {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&[url]));
    })
    .map_err(|failure| failure.to_string())
}

/// Drags something off the shelf as the file itself, so it can be dropped in the Finder or a
/// messenger: moved from where it is, or copied with option held. Asked for while the button is
/// still down, as the page sees a drag begin.
#[tauri::command]
pub async fn shelf_drag(app: AppHandle, id: String, copying: bool) -> Result<(), String> {
    let found = id.clone();
    let (path, kind) = tauri::async_runtime::spawn_blocking(move || kept(&found)).await.map_err(|failure| failure.to_string())??;
    let icon = Some(icon_file(&shelf_dir(), &id)).filter(|icon| icon.is_file());
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let carried = crate::shelf_drag::Carried { id, held: kind == Kind::Held, copying };
        if let Err(failure) = crate::shelf_drag::begin(&handle, &path, icon.as_deref(), carried) {
            let _ = handle.emit_to(crate::island::LABEL, "shelf:trouble", failure);
        }
    })
    .map_err(|failure| failure.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kyuren-shelf-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("made");
        dir.canonicalize().expect("there")
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir).expect("there").flatten().map(|entry| entry.file_name().to_string_lossy().to_string()).collect();
        names.sort();
        names
    }

    #[test]
    fn a_new_thing_is_named_for_when_it_came_and_never_clashes() {
        assert_eq!(id_for(1000, &[]), "1000");
        assert_eq!(id_for(1000, &["1000".into()]), "1000-2");
        assert_eq!(id_for(1000, &["1000".into(), "1000-2".into()]), "1000-3");
        assert!(valid_id("1000") && valid_id("1000-3"));
        for path in ["../x", "1000/..", "", "12-", "-3", ".icons", "1000-2-3", "1000 ", "1000.json"] {
            assert!(!valid_id(path), "{path:?} is never an id");
        }
    }

    #[test]
    fn what_is_dropped_stays_where_it_is_and_the_shelf_points_at_it() {
        let outside = scratch("outside");
        let root = scratch("root");
        std::fs::write(outside.join("report.pdf"), b"pdf").expect("written");
        std::fs::create_dir(outside.join("photos")).expect("made");

        assert_eq!(point_at(&root, &[outside.join("report.pdf")], 1_000).expect("put"), vec!["1000"]);
        assert_eq!(point_at(&root, &[outside.join("photos"), outside.join("report.pdf")], 2_000).expect("put"), vec!["2000"], "never twice");
        assert_eq!(names_in(&outside), vec!["photos", "report.pdf"], "nothing moved");

        let items = list_in(&root);
        let seen: Vec<(&str, bool, u64)> = items.iter().map(|one| (one.name.as_str(), one.folder, one.size)).collect();
        assert_eq!(seen, vec![("photos", true, 0), ("report.pdf", false, 3)], "newest first");
        assert_eq!(items[1].path, outside.join("report.pdf"));
        std::fs::remove_dir_all(&outside).expect("cleared");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn something_pointed_at_is_followed_when_renamed_or_moved_and_let_go_when_deleted() {
        let outside = scratch("followed");
        let root = scratch("followed-root");
        std::fs::write(outside.join("draft.txt"), b"one").expect("written");
        std::fs::create_dir(outside.join("later")).expect("made");
        point_at(&root, &[outside.join("draft.txt")], 1_000).expect("put");

        std::fs::rename(outside.join("draft.txt"), outside.join("later").join("final.txt")).expect("moved and renamed");
        let items = list_in(&root);
        assert_eq!(items.iter().map(|one| one.name.as_str()).collect::<Vec<_>>(), vec!["final.txt"]);
        assert_eq!(items[0].path.canonicalize().expect("there"), outside.join("later").join("final.txt"));

        std::fs::remove_file(outside.join("later").join("final.txt")).expect("deleted");
        assert!(listing(&root, false).is_empty());
        assert!(pointer_file(&root, "1000").exists(), "not while something may be being added");
        assert!(listing(&root, true).is_empty());
        assert!(!pointer_file(&root, "1000").exists(), "and then let go of");
        std::fs::remove_dir_all(&outside).expect("cleared");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn a_file_renamed_and_another_saved_in_its_place_is_still_the_one_followed() {
        let outside = scratch("replaced");
        let root = scratch("replaced-root");
        std::fs::write(outside.join("a.txt"), b"original").expect("written");
        point_at(&root, &[outside.join("a.txt")], 1_000).expect("put");
        std::fs::rename(outside.join("a.txt"), outside.join("b.txt")).expect("renamed");
        std::fs::write(outside.join("a.txt"), b"newcomer").expect("written");
        let items = listing(&root, true);
        assert_eq!(items.iter().map(|one| one.name.as_str()).collect::<Vec<_>>(), vec!["b.txt"]);
        assert_eq!(std::fs::read(&items[0].path).expect("there"), b"original");
        std::fs::remove_dir_all(&outside).expect("cleared");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn a_document_saved_over_by_its_app_is_the_saved_one_and_one_in_the_trash_is_gone() {
        let outside = scratch("saved");
        let root = scratch("saved-root");
        std::fs::write(outside.join("notes.md"), b"one").expect("written");
        point_at(&root, &[outside.join("notes.md")], 1_000).expect("put");
        // An app's save: a new file written beside it and moved over its name.
        std::fs::write(outside.join(".notes.md.saving"), b"two").expect("written");
        std::fs::rename(outside.join(".notes.md.saving"), outside.join("notes.md")).expect("saved over");
        let items = listing(&root, true);
        assert_eq!(std::fs::read(&items[0].path).expect("there"), b"two");

        std::fs::create_dir(outside.join(".Trash")).expect("made");
        std::fs::rename(outside.join("notes.md"), outside.join(".Trash").join("notes.md")).expect("trashed");
        std::fs::write(outside.join("notes.md"), b"three").expect("written");
        point_at(&root, &[outside.join("notes.md")], 2_000).expect("put");
        std::fs::rename(outside.join("notes.md"), outside.join(".Trash").join("notes 2.md")).expect("trashed");
        assert!(listing(&root, true).is_empty(), "in the Trash is gone, however it is found");
        std::fs::remove_dir_all(&outside).expect("cleared");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn something_on_a_disk_that_is_not_there_is_kept_for_when_it_is() {
        let root = scratch("unmounted");
        let pointer = Pointer { path: "/Volumes/No Such Disk/plan.key".into(), volume: Some(0x7eee_0001), file: Some(42) };
        std::fs::write(pointer_file(&root, "1000"), serde_json::to_string(&pointer).expect("json")).expect("written");
        assert_eq!(resolved(&pointer), Found::Unreachable);
        assert!(listing(&root, true).is_empty(), "not shown while it cannot be reached");
        assert!(pointer_file(&root, "1000").exists(), "nor let go of");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn taking_something_pointed_at_off_the_shelf_leaves_it_where_it_is() {
        let outside = scratch("forget");
        let root = scratch("forget-root");
        std::fs::write(outside.join("a.txt"), b"a").expect("written");
        point_at(&root, &[outside.join("a.txt")], 1_000).expect("put");
        std::fs::create_dir_all(root.join(".icons")).expect("made");
        std::fs::write(icon_file(&root, "1000"), b"png").expect("written");

        forget(&root, "1000").expect("let go");
        assert!(list_in(&root).is_empty());
        assert_eq!(std::fs::read(outside.join("a.txt")).expect("still there"), b"a");
        assert!(!icon_file(&root, "1000").exists(), "its icon goes with it");
        assert!(forget(&root, "../a").is_err(), "an id is never a path");
        std::fs::remove_dir_all(&outside).expect("cleared");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn a_file_held_from_before_is_still_listed_and_cleared_once_dragged_out() {
        let root = scratch("held");
        std::fs::create_dir_all(root.join("900")).expect("made");
        std::fs::write(root.join("900").join("kept.txt"), b"kept").expect("written");
        std::fs::write(root.join("900").join(FINDER_NOTES), b"finder").expect("written");
        let items = list_in(&root);
        assert_eq!(items.iter().map(|one| one.name.as_str()).collect::<Vec<_>>(), vec!["kept.txt"], "what Finder leaves is not what was kept");

        std::fs::remove_file(root.join("900").join("kept.txt")).expect("dragged out to move it");
        forget(&root, "900").expect("cleared");
        assert!(!root.join("900").exists());
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn many_from_one_moment_are_ordered_by_their_count() {
        let root = scratch("order");
        let outside = scratch("order-outside");
        let paths: Vec<PathBuf> = (0..12).map(|at| outside.join(format!("{at}.txt"))).collect();
        for path in &paths {
            std::fs::write(path, b"x").expect("written");
        }
        point_at(&root, &paths, 1_000).expect("put");
        let ids: Vec<String> = list_in(&root).into_iter().map(|one| one.id).take(3).collect();
        assert_eq!(ids, vec!["1000-12", "1000-11", "1000-10"]);
        std::fs::remove_dir_all(&outside).expect("cleared");
        std::fs::remove_dir_all(&root).expect("cleared");
    }

    #[test]
    fn a_drop_brings_only_whole_paths_to_real_things_outside_the_shelf() {
        let home = scratch("guard");
        let root = home.join("shelf");
        std::fs::create_dir_all(root.join("1000")).expect("made");
        std::fs::write(root.join("1000").join("kept.txt"), b"k").expect("written");
        std::fs::write(home.join("a.txt"), b"a").expect("written");

        assert_eq!(droppable(&root, &[home.join("a.txt")]), Ok(vec![home.join("a.txt")]));
        assert_eq!(droppable(&root, &[root.join("1000").join("kept.txt")]), Ok(vec![]), "dragged out and back is left be");
        assert!(droppable(&root, &[PathBuf::from("a.txt")]).is_err(), "a path must be whole");
        assert!(droppable(&root, &[PathBuf::from("/")]).is_err(), "nothing without a name");
        assert!(droppable(&root, &[home.join("gone.txt")]).is_err());
        assert!(droppable(&root, std::slice::from_ref(&home)).is_err(), "a folder holding the shelf");
        let shouted = home.with_file_name(home.file_name().expect("named").to_string_lossy().to_uppercase());
        assert!(droppable(&root, &[shouted]).is_err(), "however its name is spelled");
        assert_eq!(droppable(&root, &[PathBuf::from("/dev")]), Err("/dev is a whole disk".to_string()));
        assert!(droppable(&root, &vec![home.join("a.txt"); MOST_AT_ONCE + 1]).is_err());
        std::fs::remove_dir_all(&home).expect("cleared");
    }

    #[test]
    fn a_drop_is_kept_once_and_only_as_the_window_reported_it() {
        dropped(&[PathBuf::from("/Users/someone/a.txt")]);
        assert_eq!(take_drop(), vec![PathBuf::from("/Users/someone/a.txt")]);
        assert!(take_drop().is_empty(), "never twice");
    }
}
