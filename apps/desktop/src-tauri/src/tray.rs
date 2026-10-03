use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{App, Runtime};

use crate::hotkey::reveal_main;

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Kyuren", true, None::<&str>)?;
    let mind = MenuItem::with_id(app, "mind", "Show the mind", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Kyuren", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &mind, &separator, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("kyuren")
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => reveal_main(app),
            "mind" => crate::mind::toggle(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                reveal_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
