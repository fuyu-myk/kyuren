use std::error::Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// The panel macro brings MainThreadMarker, NSEvent, NSObjectProtocol, NSPoint, NSRect and NSSize into scope.
use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSScreen, NSWorkspace};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, StyleMask, WebviewWindowExt};

tauri_panel! {
    panel!(IslandPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

pub const LABEL: &str = "island";

/// The island's tabs, in the order they are shown.
pub const TABS: [&str; 8] = ["voice", "glance", "shortcuts", "shelf", "permissions", "work", "coding", "notices"];

/// The tabs there were before any list of them was kept with the tabs seen beside it: what a list
/// arranged then was arranged among.
const FIRST_TABS: [&str; 6] = ["voice", "glance", "permissions", "work", "coding", "notices"];

/// Summoned by the hotkey or by name, and listening until dismissed.
static SUMMONED: AtomicBool = AtomicBool::new(false);

pub fn summoned() -> bool {
    SUMMONED.load(Ordering::SeqCst)
}

/// Summons the island, or dismisses it if it is summoned. Returns whether it is summoned now.
pub fn toggle(app: &AppHandle) -> bool {
    let now = !SUMMONED.load(Ordering::SeqCst);
    SUMMONED.store(now, Ordering::SeqCst);
    // To every window: the island acts on it, and the main window counts it.
    let _ = app.emit(if now { "island:summon" } else { "island:dismiss" }, ());
    now
}

/// The names chosen that are among those known, in the order chosen, each once.
pub fn chosen_from(known: &[&str], chosen: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for one in chosen {
        if known.contains(&one.as_str()) && !kept.contains(one) {
            kept.push(one.clone());
        }
    }
    kept
}

/// The tabs as set, in the order the user arranged them, unknown names dropped. Nothing set is all
/// of them, in their own order. A tab added since they were arranged is shown after them, since it
/// was never one hidden.
pub fn tabs_from(set: Option<&[String]>, seen: Option<&[String]>) -> Vec<String> {
    let Some(chosen) = set else {
        return TABS.iter().map(|tab| tab.to_string()).collect();
    };
    let known = |tab: &str| seen.map_or(FIRST_TABS.contains(&tab), |seen| seen.iter().any(|one| one == tab));
    let kept = chosen_from(&TABS, chosen);
    let added: Vec<String> = TABS.iter().filter(|tab| !known(tab) && !kept.iter().any(|one| one == *tab)).map(|tab| tab.to_string()).collect();
    [kept, added].concat()
}

/// The panel the island is drawn in: wide enough for the open island and its ears, tall enough
/// for its longest view. It never changes size; the island grows inside it.
pub const PANEL_WIDTH: f64 = 880.0;
pub const PANEL_HEIGHT: f64 = 320.0;

/// Above the menu bar, where the notch is.
const LEVEL: i64 = 24 + 3;

/// A hover counts a little around the island, so its edge is not a knife.
const MARGIN: f64 = 6.0;

/// How often the cursor is looked at: every frame while the island shows, less often while it
/// waits inside the notch.
const AWAKE: Duration = Duration::from_millis(16);
const ASLEEP: Duration = Duration::from_millis(50);

/// How often the island checks whether the cursor has gone to another screen.
const SCREENS: Duration = Duration::from_millis(500);

/// What stands in for a notch on a screen without one: a short bar at the top centre.
const BAR_WIDTH: f64 = 120.0;
const BAR_HEIGHT: f64 = 24.0;

/// On a screen without a notch the hover is a thin strip along the very top, so working in the
/// menu bar does not open anything.
const STRIP: f64 = 6.0;

/// The notch of the screen the island is on, or the bar standing in for one.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Notch {
    pub present: bool,
    pub width: f64,
    pub height: f64,
}

/// A rectangle in the panel's own points, measured from its top left.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Area {
    pub fn holds(&self, x: f64, y: f64, margin: f64) -> bool {
        self.width > 0.0
            && x >= self.x - margin
            && x <= self.x + self.width + margin
            && y >= self.y - margin
            && y <= self.y + self.height + margin
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Mode {
    Hidden,
    Shown,
}

/// One look at the mouse buttons and at the app in front, to compare with the next.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Glance {
    pub pressing: bool,
    pub front: Option<i32>,
}

struct Shared {
    mode: Mode,
    island: Option<Area>,
    notch: Notch,
    screen: Option<(f64, f64)>,
    over: bool,
    ignoring: bool,
    glance: Glance,
    /// Whether the shelf is shown, which is when something dragged to the notch is taken.
    shelf: bool,
    /// Something in the island is being typed into.
    typing: bool,
    /// The app in front when the island took the keyboard.
    taken_from: Option<i32>,
}

fn shared() -> &'static Mutex<Shared> {
    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();
    SHARED.get_or_init(|| {
        Mutex::new(Shared {
            mode: Mode::Hidden,
            island: None,
            notch: Notch::default(),
            screen: None,
            over: false,
            ignoring: true,
            glance: Glance::default(),
            shelf: false,
            typing: false,
            taken_from: None,
        })
    })
}

/// A screen's notch from what the screen says of itself: the strips either side of it, and how
/// far the top of the screen is kept clear. A screen with no notch gets the bar instead.
pub fn notch_from(screen_width: f64, safe_top: f64, left: f64, right: f64, menu_bar: f64) -> Notch {
    if safe_top <= 0.0 {
        let height = if menu_bar > 0.0 { menu_bar.min(BAR_HEIGHT) } else { BAR_HEIGHT };
        return Notch { present: false, width: BAR_WIDTH, height };
    }
    let measured = screen_width - left - right;
    let width = if measured > 0.0 && measured < screen_width { measured } else { 184.0 };
    Notch { present: true, width, height: safe_top }
}

/// Where a hover counts. Hidden, it is the notch itself, or a thin strip along the top of a screen
/// without one; showing, it is the island.
pub fn hover_zone(shown: bool, notch: Notch, island: Option<Area>) -> Area {
    if shown {
        if let Some(island) = island {
            return island;
        }
    }
    let height = if notch.present { notch.height } else { STRIP };
    Area { x: (PANEL_WIDTH - notch.width) / 2.0, y: 0.0, width: notch.width, height }
}

/// Whether clicks and drops reach the island rather than what is under it. Hidden, only a drag
/// carried onto the notch does, so that it can be dropped on the shelf; the notch is dead screen,
/// so nothing else is ever pressed there.
pub fn accepts(over: bool, shown: bool, pressing: bool, shelf: bool) -> bool {
    over && (shown || (pressing && shelf))
}

/// Whether a showing island has been left: by a press that starts outside it, or by another app
/// coming forward. A press counts as it starts, so a drag begun inside and carried out is not one.
/// Kyuren itself coming forward is not leaving, as when the island brings its own window forward,
/// nor is anything coming forward while the cursor is on the island, which the user is using.
pub fn left_by(shown: bool, over: bool, was: Glance, now: Glance, own: i32) -> bool {
    if !shown {
        return false;
    }
    let pressed_outside = now.pressing && !was.pressing && !over;
    let switched = !over && matches!((was.front, now.front), (Some(before), Some(after)) if before != after && after != own);
    pressed_outside || switched
}

/// Whether the island has the keyboard. WebKit shows a hover, and sends the page the mouse's moves,
/// only in the window with the keyboard, so the island has it while the cursor is on it, and while
/// something in it is typed into. The panel takes it without taking the menu bar from the app in
/// front, which has it back as the cursor leaves. A button held changes nothing, so a drag is never
/// cut off by the keyboard moving.
pub fn keyed(shown: bool, over: bool, typing: bool, pressing: bool, now: bool) -> bool {
    if pressing {
        return now;
    }
    typing || (shown && over)
}

/// How the island gives the keyboard back.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Release {
    Resign,
    /// Brings the app that was in front back to the front.
    HandBack(i32),
    /// Gives it to Kyuren's own window, which had it.
    Refocus,
}

/// How the island lets go of the keyboard so that the next hover can take it again. Taken by a
/// hover, the app in front is still in front, and resigning returns it. With Kyuren come forward
/// meanwhile, resigning leaves AppKit holding a key window it no longer treats as one, which a
/// hover cannot make key again; the front goes back to the app that had it instead.
pub fn letting_go(front: Option<i32>, taken_from: Option<i32>, own: i32) -> Release {
    if front != Some(own) {
        return Release::Resign;
    }
    match taken_from {
        Some(before) if before != own => Release::HandBack(before),
        Some(_) => Release::Refocus,
        None => Release::Resign,
    }
}

/// The cursor, which macOS gives from the bottom left of the whole desktop, in the panel's own
/// points from its top left.
pub fn local(cursor: (f64, f64), frame: (f64, f64, f64, f64)) -> (f64, f64) {
    let (x, y, _, height) = frame;
    (cursor.0 - x, y + height - cursor.1)
}

fn notch_of(screen: &NSScreen) -> Notch {
    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let insets = screen.safeAreaInsets();
    let left = screen.auxiliaryTopLeftArea().size.width;
    let right = screen.auxiliaryTopRightArea().size.width;
    let menu_bar = (frame.origin.y + frame.size.height) - (visible.origin.y + visible.size.height);
    notch_from(frame.size.width, insets.top, left, right, menu_bar)
}

fn screen_under(cursor: NSPoint, mtm: MainThreadMarker) -> Option<objc2::rc::Retained<NSScreen>> {
    let screens = NSScreen::screens(mtm);
    let found = screens.iter().find(|screen| {
        let frame = screen.frame();
        cursor.x >= frame.origin.x
            && cursor.x < frame.origin.x + frame.size.width
            && cursor.y >= frame.origin.y
            && cursor.y < frame.origin.y + frame.size.height
    });
    found.or_else(|| NSScreen::mainScreen(mtm))
}

/// Puts the panel at the top centre of a screen, flush with its top edge, over the menu bar.
fn place(app: &AppHandle, screen: &NSScreen) -> Option<Notch> {
    let panel = app.get_webview_panel(LABEL).ok()?;
    let frame = screen.frame();
    let at = NSRect::new(
        NSPoint::new(frame.origin.x + frame.size.width / 2.0 - PANEL_WIDTH / 2.0, frame.origin.y + frame.size.height - PANEL_HEIGHT),
        NSSize::new(PANEL_WIDTH, PANEL_HEIGHT),
    );
    panel.as_panel().setFrame_display(at, true);
    let notch = notch_of(screen);
    if let Ok(mut held) = shared().lock() {
        held.notch = notch;
        held.screen = Some((frame.origin.x, frame.origin.y));
    }
    let _ = app.emit_to(LABEL, "island:screen", notch);
    Some(notch)
}

/// A window made into a panel after it was made still lets a click on it bring its app forward,
/// where a panel made as one does not: macOS takes that from how a window was made, not from its
/// style afterwards, so a click on the island took the front and the menu bar from the app in use.
/// Measured on macOS 26, the setter AppKit itself calls for a panel made as one puts it right.
fn prevent_activation(panel: &NSPanel) {
    let setter = objc2::sel!(_setPreventsActivation:);
    if panel.respondsToSelector(setter) {
        // SAFETY: AppKit's own setter for this flag, taking a BOOL, sent to the window it belongs
        // to, after checking the window answers to it.
        unsafe {
            let _: () = objc2::msg_send![panel, _setPreventsActivation: true];
        }
    }
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let window = app.get_webview_window(LABEL).ok_or("the island window is not declared")?;
    // What a drop held is learned here, from the window, so the shelf never keeps a path the page
    // merely names.
    window.on_window_event(|event| {
        if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
            crate::shelf::dropped(paths);
        }
    });
    let panel = window.to_panel::<IslandPanel>()?;
    panel.set_level(LEVEL);
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    prevent_activation(panel.as_panel());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .full_screen_auxiliary()
            .ignores_cycle()
            .into(),
    );
    panel.set_has_shadow(false);
    panel.set_ignores_mouse_events(true);
    // Ordered on screen once and kept there, nothing drawn until there is something to show.
    // Ordering is when macOS pushes a panel down below the menu bar; a move afterwards is not
    // checked, which is how it comes to sit over the notch.
    panel.show();

    if let Ok(mut held) = shared().lock() {
        held.shelf = island_tabs().iter().any(|tab| tab == "shelf");
    }

    let mtm = MainThreadMarker::new().ok_or("the island is installed off the main thread")?;
    if let Some(screen) = screen_under(NSEvent::mouseLocation(), mtm) {
        place(app, &screen);
    }

    let handle = app.clone();
    std::thread::Builder::new().name("kyuren-island".into()).spawn(move || {
        let mut last_screens = Instant::now();
        loop {
            let shown = shared().lock().map(|held| held.mode == Mode::Shown).unwrap_or(false);
            std::thread::sleep(if shown { AWAKE } else { ASLEEP });
            let screens = last_screens.elapsed() >= SCREENS;
            if screens {
                last_screens = Instant::now();
            }
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || tick(&app, screens));
        }
    })?;
    Ok(())
}

/// One look at the cursor: whether clicks reach the island, whether the island is hovered, and,
/// now and then, whether the cursor has taken the island to another screen.
fn tick(app: &AppHandle, screens: bool) {
    crate::pomodoro::check(app);
    let Some(mtm) = MainThreadMarker::new() else { return };
    let Ok(panel) = app.get_webview_panel(LABEL) else { return };
    let cursor = NSEvent::mouseLocation();

    if screens {
        let hidden = shared().lock().map(|held| held.mode == Mode::Hidden).unwrap_or(false);
        if hidden {
            if let Some(screen) = screen_under(cursor, mtm) {
                let frame = screen.frame();
                let here = Some((frame.origin.x, frame.origin.y));
                if shared().lock().map(|held| held.screen != here).unwrap_or(false) {
                    place(app, &screen);
                }
            }
        }
    }

    let frame = panel.as_panel().frame();
    let (x, y) = local((cursor.x, cursor.y), (frame.origin.x, frame.origin.y, frame.size.width, frame.size.height));
    let now = Glance {
        pressing: NSEvent::pressedMouseButtons() != 0,
        front: NSWorkspace::sharedWorkspace().frontmostApplication().map(|running| running.processIdentifier()),
    };
    let Ok(mut held) = shared().lock() else { return };
    let shown = held.mode == Mode::Shown;
    let over = hover_zone(shown, held.notch, held.island).holds(x, y, if shown { MARGIN } else { 0.0 });
    let accept = accepts(over, shown, now.pressing, held.shelf);
    if held.ignoring == accept {
        held.ignoring = !accept;
        panel.set_ignores_mouse_events(!accept);
    }
    let own = std::process::id() as i32;
    let away = left_by(shown, over, held.glance, now, own);
    // The app in front is remembered only while the island shows, so each time it comes out it
    // starts from whatever is in front then.
    held.glance = Glance { pressing: now.pressing, front: if shown { now.front.or(held.glance.front) } else { None } };
    let hovered = held.over != over;
    held.over = over;
    let key = panel.as_panel().isKeyWindow();
    let wanted = keyed(shown, over, held.typing, now.pressing, key);
    if wanted && !key {
        held.taken_from = now.front;
    }
    let release = (!wanted && key).then(|| letting_go(now.front, held.taken_from.take(), own));
    drop(held);
    if wanted && !key {
        panel.make_key_window();
    }
    match release {
        Some(Release::Resign) => panel.resign_key_window(),
        Some(Release::HandBack(pid)) => {
            if let Some(running) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
                running.activateWithOptions(NSApplicationActivationOptions::empty());
            }
        }
        Some(Release::Refocus) => match app.get_webview_window("main") {
            Some(main) if main.is_visible().unwrap_or(false) => {
                let _ = main.set_focus();
            }
            _ => panel.resign_key_window(),
        },
        None => {}
    }
    if hovered {
        let _ = app.emit_to(LABEL, "island:hover", over);
    }
    if away {
        let _ = app.emit_to(LABEL, "island:away", ());
    }
}

/// Whether a point on the screen, as AppKit gives one, is on the island as it is drawn now. Asked on
/// the main thread, where the panel is.
pub fn on_island(app: &AppHandle, at: (f64, f64)) -> bool {
    let Ok(panel) = app.get_webview_panel(LABEL) else { return false };
    let frame = panel.as_panel().frame();
    let (x, y) = local(at, (frame.origin.x, frame.origin.y, frame.size.width, frame.size.height));
    shared().lock().is_ok_and(|held| held.mode == Mode::Shown && hover_zone(true, held.notch, held.island).holds(x, y, MARGIN))
}

/// Where the island is drawn now, in the panel's points from its top left, for clicks and hover.
#[tauri::command]
pub fn island_rect(x: f64, y: f64, width: f64, height: f64) {
    if let Ok(mut held) = shared().lock() {
        held.island = if width > 0.0 && height > 0.0 { Some(Area { x, y, width, height }) } else { None };
    }
}

/// Whether the island is showing: hidden, every click passes through and only the notch is
/// watched for a hover.
#[tauri::command]
pub fn island_mode(shown: bool) {
    if let Ok(mut held) = shared().lock() {
        held.mode = if shown { Mode::Shown } else { Mode::Hidden };
    }
}

/// Something in the island is being typed into, or no longer is: the next look at the cursor gives
/// the island the keyboard or gives it back.
#[tauri::command]
pub fn island_focus(on: bool) {
    if let Ok(mut held) = shared().lock() {
        held.typing = on;
    }
}

/// Escape in the island ends a summons the way the hotkey does, microphone and all.
#[tauri::command]
pub fn island_dismiss(app: AppHandle) {
    if summoned() {
        crate::listening::on_summon(&app);
    }
}

/// Brings the main window forward, for what the island can only point at.
#[tauri::command]
pub fn island_reveal(app: AppHandle) {
    crate::hotkey::reveal_main(&app);
}

#[tauri::command]
pub fn island_tabs() -> Vec<String> {
    let island = crate::settings::read_settings().island;
    tabs_from(island.tabs.as_deref(), island.seen.as_deref())
}

/// Sets which tabs the island shows, and tells the island at once. Every tab there is was seen in
/// arranging them, so one left out now is hidden.
#[tauri::command]
pub fn island_tabs_set(app: AppHandle, tabs: Vec<String>) -> Result<Vec<String>, String> {
    let kept = chosen_from(&TABS, &tabs);
    crate::settings::update_settings(|settings| {
        settings.island.tabs = Some(kept.clone());
        settings.island.seen = Some(TABS.iter().map(|tab| tab.to_string()).collect());
    })?;
    if let Ok(mut held) = shared().lock() {
        held.shelf = kept.iter().any(|tab| tab == "shelf");
    }
    let _ = app.emit_to(LABEL, "island:tabs", &kept);
    Ok(kept)
}

/// The page the island opens on whenever the notch is expanded, if one was chosen.
#[tauri::command]
pub fn island_home() -> Option<String> {
    crate::settings::read_settings().island.home.filter(|tab| TABS.contains(&tab.as_str()))
}

/// Chooses the page to open on, or none for what needs the user, and tells the island at once.
#[tauri::command]
pub fn island_home_set(app: AppHandle, home: Option<String>) -> Result<Option<String>, String> {
    if let Some(tab) = home.as_deref() {
        if !TABS.contains(&tab) {
            return Err(format!("{tab} is not one of the island's pages"));
        }
    }
    crate::settings::update_settings(|settings| settings.island.home.clone_from(&home))?;
    let _ = app.emit_to(LABEL, "island:home", &home);
    Ok(home)
}

/// The notch of the screen the island is on, for a page that has just loaded.
#[tauri::command]
pub fn island_screen() -> Notch {
    shared().lock().map(|held| held.notch).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_notch_is_what_the_strips_either_side_of_it_leave() {
        let notch = notch_from(1800.0, 38.0, 808.0, 808.0, 38.0);
        assert_eq!(notch, Notch { present: true, width: 184.0, height: 38.0 });
        assert_eq!(notch_from(1512.0, 32.0, 0.0, 0.0, 32.0).width, 184.0, "strips that say nothing fall back to the usual width");
    }

    #[test]
    fn a_screen_without_a_notch_gets_a_short_bar_no_taller_than_its_menu_bar() {
        assert_eq!(notch_from(2560.0, 0.0, 0.0, 0.0, 22.0), Notch { present: false, width: 120.0, height: 22.0 });
        assert_eq!(notch_from(2560.0, 0.0, 0.0, 0.0, 0.0).height, 24.0, "a hidden menu bar still leaves the bar its height");
    }

    #[test]
    fn hidden_the_hover_is_the_notch_and_showing_it_is_the_island() {
        let notch = Notch { present: true, width: 184.0, height: 38.0 };
        let hidden = hover_zone(false, notch, Some(Area { x: 40.0, y: 0.0, width: 800.0, height: 200.0 }));
        assert_eq!(hidden, Area { x: 348.0, y: 0.0, width: 184.0, height: 38.0 });
        let island = Area { x: 40.0, y: 0.0, width: 800.0, height: 200.0 };
        assert_eq!(hover_zone(true, notch, Some(island)), island);
        let bare = hover_zone(false, Notch { present: false, width: 120.0, height: 24.0 }, None);
        assert_eq!(bare.height, 6.0, "without a notch, only a thin strip along the top");
    }

    #[test]
    fn tabs_are_kept_as_arranged_and_unknown_names_are_dropped() {
        let all: Vec<String> = TABS.iter().map(|tab| tab.to_string()).collect();
        assert_eq!(tabs_from(None, None), all);
        let chosen = vec!["notices".to_string(), "bogus".to_string(), "voice".to_string(), "notices".to_string()];
        assert_eq!(tabs_from(Some(&chosen), Some(&all)), vec!["notices", "voice"], "kept as arranged, each once");
        assert!(tabs_from(Some(&[]), Some(&all)).is_empty(), "every tab may be switched off");
    }

    #[test]
    fn a_tab_added_since_the_tabs_were_arranged_is_shown_and_one_hidden_since_stays_hidden() {
        let arranged = vec!["coding".to_string(), "voice".to_string()];
        assert_eq!(tabs_from(Some(&arranged), None), vec!["coding", "voice", "shortcuts", "shelf"], "arranged before either was");
        let all: Vec<String> = TABS.iter().map(|tab| tab.to_string()).collect();
        assert_eq!(tabs_from(Some(&arranged), Some(&all)), vec!["coding", "voice"], "hidden with it there to see");
        let placed = vec!["shelf".to_string(), "voice".to_string()];
        assert_eq!(tabs_from(Some(&placed), None), vec!["shelf", "voice", "shortcuts"], "never twice");
    }

    #[test]
    fn hidden_only_a_drag_onto_the_notch_reaches_the_island_and_only_with_the_shelf_shown() {
        assert!(accepts(true, true, false, false), "a showing island takes what is over it");
        assert!(!accepts(false, true, true, true), "and nothing beside it");
        assert!(!accepts(true, false, false, true), "hidden, a cursor over the notch passes through");
        assert!(accepts(true, false, true, true), "a drag carried onto the notch is taken, for the shelf");
        assert!(!accepts(true, false, true, false), "with the shelf hidden it is not");
    }

    #[test]
    fn the_island_has_the_keyboard_while_the_cursor_is_on_it_or_something_in_it_is_typed_into() {
        assert!(keyed(true, true, false, false, false), "showing with the cursor on it, so a hover shows");
        assert!(!keyed(true, false, false, false, true), "the cursor gone, it is given back");
        assert!(!keyed(false, true, false, false, true), "hidden, a cursor over the notch never takes it");
        assert!(keyed(true, false, true, false, false), "typed into, it is kept wherever the cursor goes");
        assert!(!keyed(true, true, false, true, false), "a button held changes nothing, so a drag is never cut off");
        assert!(keyed(true, false, false, true, true), "either way");
    }

    #[test]
    fn the_keyboard_goes_back_the_way_that_leaves_the_next_hover_able_to_take_it() {
        const OWN: i32 = 42;
        assert_eq!(letting_go(Some(100), Some(100), OWN), Release::Resign, "taken by a hover, with the app in front still in front");
        assert_eq!(letting_go(Some(OWN), Some(100), OWN), Release::HandBack(100), "a click brought Kyuren forward meanwhile");
        assert_eq!(letting_go(Some(OWN), Some(OWN), OWN), Release::Refocus, "taken from Kyuren's own window, which has it back");
        assert_eq!(letting_go(Some(OWN), None, OWN), Release::Resign, "taken by AppKit itself, from nothing known");
    }

    #[test]
    fn a_press_outside_or_another_app_coming_forward_leaves_the_island() {
        const OWN: i32 = 42;
        let idle = Glance { pressing: false, front: Some(100) };
        let pressed = Glance { pressing: true, front: Some(100) };
        assert!(left_by(true, false, idle, pressed, OWN), "a press that starts outside");
        assert!(!left_by(true, true, idle, pressed, OWN), "a press on the island is a use of it");
        assert!(!left_by(true, false, pressed, pressed, OWN), "a press begun inside and dragged out is not a leaving");
        assert!(left_by(true, false, idle, Glance { pressing: false, front: Some(200) }, OWN), "another app came forward");
        assert!(!left_by(true, false, Glance { pressing: false, front: None }, idle, OWN), "the first look only learns which app is forward");
        assert!(!left_by(false, false, idle, Glance { pressing: true, front: Some(200) }, OWN), "hidden, there is nothing to leave");
    }

    #[test]
    fn a_click_on_the_island_that_brings_kyuren_forward_is_a_use_of_it_not_a_leaving() {
        const OWN: i32 = 42;
        let idle = Glance { pressing: false, front: Some(100) };
        assert!(!left_by(true, true, idle, Glance { pressing: true, front: Some(OWN) }, OWN), "clicked, Kyuren itself came forward");
        assert!(!left_by(true, false, idle, Glance { pressing: false, front: Some(OWN) }, OWN), "Kyuren coming forward is never leaving it");
        assert!(!left_by(true, true, idle, Glance { pressing: false, front: Some(200) }, OWN), "with the cursor on it, whatever came forward");
        assert!(left_by(true, false, Glance { pressing: false, front: Some(OWN) }, Glance { pressing: false, front: Some(100) }, OWN), "but going back to another app is");
    }

    #[test]
    fn the_cursor_is_turned_into_the_panels_own_points_from_its_top_left() {
        // A panel 720 by 320 at the top of a screen 1117 points tall, with its left edge at 540.
        assert_eq!(local((900.0, 1117.0), (540.0, 797.0, 720.0, 320.0)), (360.0, 0.0));
        assert_eq!(local((560.0, 1000.0), (540.0, 797.0, 720.0, 320.0)), (20.0, 117.0));
        assert!(Area { x: 268.0, y: 0.0, width: 184.0, height: 38.0 }.holds(360.0, 10.0, 0.0));
        assert!(!Area { x: 268.0, y: 0.0, width: 184.0, height: 38.0 }.holds(360.0, 50.0, 0.0));
        assert!(!Area::default().holds(0.0, 0.0, 6.0), "nothing drawn is never hovered");
    }
}
