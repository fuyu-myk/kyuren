use std::cell::RefCell;
use std::path::Path;

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApp, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession, NSDraggingSource, NSEvent, NSEventModifierFlags,
    NSEventType, NSImage,
};
use objc2_foundation::{NSArray, NSData, NSPoint, NSRect, NSString, NSURL};
use tauri::{AppHandle, Emitter};
use tauri_nspanel::ManagerExt;

/// Under the cursor when an icon could not be drawn.
const FALLBACK_ICON: &[u8] = include_bytes!("../icons/64x64.png");

/// What a drag out of the shelf lets the place it lands do: move it, unless option is held, when it
/// may only copy, as in the Finder. Moving is offered beside copying, not alone, since a messenger
/// takes only a copy and refuses a drag that cannot give one; the Finder moves within a disk and
/// copies to another, as it would from any folder.
pub fn allowed(copying: bool) -> NSDragOperation {
    if copying {
        NSDragOperation::Copy
    } else {
        NSDragOperation::Copy | NSDragOperation::Move
    }
}

/// What is being dragged off the shelf.
pub struct Carried {
    pub id: String,
    /// The file itself lives on the shelf, rather than where it was dropped from.
    pub held: bool,
    /// Option was held as the drag began.
    pub copying: bool,
}

/// Whether a drag out takes something off the shelf. Dropped anywhere, something pointed at has gone
/// where it was going, moved or copied, and the shelf lets go of it; dropped back on the island it
/// has gone nowhere, though the island takes every drop as a copy. A file the shelf itself holds
/// leaves only once it has been moved out, since a copy dropped somewhere is not the shelf's to
/// throw away.
pub fn leaves(dropped: bool, held: bool, back_on_island: bool) -> bool {
    dropped && !held && !back_on_island
}

struct Carrying {
    app: AppHandle,
    carried: Carried,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "KyurenShelfDrag"]
    #[ivars = Carrying]
    struct ShelfDrag;

    unsafe impl NSObjectProtocol for ShelfDrag {}

    unsafe impl NSDraggingSource for ShelfDrag {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        unsafe fn mask(&self, _session: &NSDraggingSession, _context: NSDraggingContext) -> NSDragOperation {
            // Option pressed along the way copies as much as option held from the start.
            let held = NSEvent::modifierFlags_class().contains(NSEventModifierFlags::Option);
            allowed(self.ivars().carried.copying || held)
        }

        #[unsafe(method(draggingSession:endedAtPoint:operation:))]
        unsafe fn ended(&self, _session: &NSDraggingSession, at: NSPoint, operation: NSDragOperation) {
            let ivars = self.ivars();
            let app = ivars.app.clone();
            let dropped = operation != NSDragOperation::None;
            let _ = app.emit_to(crate::island::LABEL, "shelf:dragged", dropped);
            let back = crate::island::on_island(&app, (at.x, at.y));
            let forgetting = leaves(dropped, ivars.carried.held, back).then(|| ivars.carried.id.clone());
            // Off the main thread, which the listing waits on.
            tauri::async_runtime::spawn_blocking(move || {
                if let Some(id) = forgetting {
                    let _ = crate::shelf::forget(&crate::shelf::shelf_dir(), &id);
                }
                crate::shelf::changed(&app)
            });
        }
    }
);

impl ShelfDrag {
    fn new(app: AppHandle, carried: Carried, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(Carrying { app, carried });
        // SAFETY: NSObject's own init, on an instance just allocated with its ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    /// The latest drag's source, kept until the next replaces it, since AppKit does not promise to
    /// keep a source alive for the length of its drag.
    static LATEST: RefCell<Option<Retained<ShelfDrag>>> = const { RefCell::new(None) };
}

/// Starts dragging a file out of the island from under the cursor, its icon with it. Called on the
/// main thread while the button that began the drag is still down.
pub fn begin(app: &AppHandle, path: &Path, icon: Option<&Path>, carried: Carried) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("a drag is started on the main thread")?;
    let panel = app.get_webview_panel(crate::island::LABEL).map_err(|_| "the island is not open".to_string())?;
    let window = panel.as_panel();
    let view = window.contentView().ok_or("the island has nothing to drag from")?;
    let image = icon
        .and_then(|icon| NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(&icon.to_string_lossy())))
        .or_else(|| NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(FALLBACK_ICON)))
        .ok_or("there is no picture to drag")?;

    let at = window.mouseLocationOutsideOfEventStream();
    let size = image.size();
    let centre = view.convertPoint_fromView(at, None);
    let frame = NSRect::new(NSPoint::new(centre.x - size.width / 2.0, centre.y - size.height / 2.0), size);
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let item = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), &ProtocolObject::from_retained(url));
    // SAFETY: what a dragging frame shows is an image, and this is one.
    unsafe { item.setDraggingFrame_contents(frame, Some(&*image)) };

    let timestamp = NSApp(mtm).currentEvent().map_or(0.0, |event| event.timestamp());
    let event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
        NSEventType::LeftMouseDragged,
        at,
        NSEventModifierFlags::empty(),
        timestamp,
        window.windowNumber(),
        None,
        0,
        1,
        1.0,
    )
    .ok_or("the drag could not be started")?;
    let source = ShelfDrag::new(app.clone(), carried, mtm);
    view.beginDraggingSessionWithItems_event_source(&NSArray::from_retained_slice(&[item]), &event, ProtocolObject::from_ref(&*source));
    LATEST.with(|latest| latest.replace(Some(source)));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drag_out_lets_go_of_what_was_pointed_at_wherever_it_lands_but_back_on_the_island() {
        assert!(leaves(true, false, false), "dropped somewhere, moved or copied");
        assert!(!leaves(false, false, false), "dropped nowhere");
        assert!(!leaves(true, false, true), "dropped back where it came from");
        assert!(!leaves(true, true, false), "the shelf's own file stays until it is moved out");
    }

    #[test]
    fn a_drag_out_may_move_unless_option_asks_for_a_copy() {
        assert_eq!(allowed(false), NSDragOperation::Copy | NSDragOperation::Move, "the place it lands chooses");
        assert_eq!(allowed(true), NSDragOperation::Copy);
        assert!(!allowed(true).contains(NSDragOperation::Generic), "so the Finder's command-to-move cannot override it");
    }
}
