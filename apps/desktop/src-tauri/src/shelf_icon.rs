use std::path::{Path, PathBuf};

use objc2::AnyThread;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace, NSGraphicsContext, NSWorkspace,
};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

/// Icons are drawn at twice their size in points, so they are sharp on a Retina screen, on the
/// island and under the cursor when dragged out.
const ICON_PIXELS: isize = 128;
const ICON_POINTS: f64 = 64.0;

/// Where an item's icon is kept, beside the shelf.
pub fn icon_file(root: &Path, id: &str) -> PathBuf {
    root.join(".icons").join(format!("{id}.png"))
}

/// The item's own Finder icon, drawn once at the shelf's size: the icon as given holds every size
/// up to a thousand pixels, far more than a tile needs.
fn icon_png(path: &Path) -> Option<Vec<u8>> {
    let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&path.to_string_lossy()));
    // SAFETY: no planes asks AppKit to hold the pixels itself, in 8-bit RGBA, which it supports,
    // and the colour space named is one of its own constants.
    let rep = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            ICON_PIXELS,
            ICON_PIXELS,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }?;
    rep.setSize(NSSize::new(ICON_POINTS, ICON_POINTS));
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    let whole = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(ICON_POINTS, ICON_POINTS));
    image.drawInRect_fromRect_operation_fraction(whole, NSRect::ZERO, NSCompositingOperation::SourceOver, 1.0);
    NSGraphicsContext::restoreGraphicsState_class();
    // SAFETY: an empty dictionary is a valid set of properties for any file type.
    let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
    Some(png.to_vec())
}

/// Written beside its place and moved there whole, so an icon is never half a file.
fn write_icon(icon: &Path, png: &[u8]) -> std::io::Result<()> {
    if let Some(folder) = icon.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let beside = icon.with_extension("png.drawing");
    std::fs::write(&beside, png)?;
    std::fs::rename(&beside, icon)
}

/// Draws the icons not drawn yet, for each id the path of what it shows. Drawn here, off the main
/// thread, into a bitmap of its own, which AppKit allows: a file on a slow disk then holds up
/// only the listing that wanted its icon, never the app.
pub fn draw_icons(root: &Path, items: &[(String, PathBuf)]) {
    for (id, path) in items {
        let icon = icon_file(root, id);
        if icon.exists() {
            continue;
        }
        if let Some(png) = icon_png(path) {
            let _ = write_icon(&icon, &png);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_icon_is_drawn_as_a_png_twice_its_size_in_points_and_written_whole() {
        let dir = std::env::temp_dir().join(format!("kyuren-shelf-icon-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("made");
        std::fs::write(dir.join("notes.txt"), b"notes").expect("written");
        let png = icon_png(&dir.join("notes.txt")).expect("drawn");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let side = |at: usize| u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]);
        assert_eq!((side(16), side(20)), (128, 128), "the header's width and height");
        write_icon(&icon_file(&dir, "1"), &png).expect("written");
        assert_eq!(std::fs::read(icon_file(&dir, "1")).expect("there"), png);
        assert!(!dir.join(".icons").join("1.png.drawing").exists(), "nothing is left beside it");
        std::fs::remove_dir_all(&dir).expect("cleared");
    }
}
