mod coding;
mod hosting;
mod commands;
mod conversation;
mod hotkey;
mod listening;
mod media;
mod mind;
mod nearby;
mod island;
mod paths;
mod playbooks;
mod pomodoro;
mod presence;
mod reader;
mod reader_proxy;
mod reader_ui;
mod secrets;
mod settings;
mod sessions;
mod shelf;
mod shelf_drag;
mod shelf_icon;
mod shortcuts;
mod sidecar;
mod sight;
mod state;
mod stats;
mod tray;
mod vaults;
mod wake;
mod web;
mod widgets;

use tauri::{Listener, Manager, RunEvent};

use crate::state::Sidecars;

/// A panic in an application launched from the Finder dies without a word: its message goes to a
/// stderr nobody is reading. It is written down first, so the next crash says what it was.
fn write_panics_down() {
    let earlier = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        let home = std::env::var("KYUREN_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_default();
            format!("{home}/.kyuren")
        });
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(format!("{home}/crash.log"))
        {
            let _ = writeln!(file, "{at} {panic}");
        }
        earlier(panic);
    }));
}

pub fn run() {
    write_panics_down();
    tauri::Builder::default()
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(reader::SCHEME, reader::answered)
        // The main window comes back the size and place it was left. The island and the mind are
        // placed by code and must not be remembered.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["island", "mind"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_status,
            commands::speak,
            commands::resolve_permission,
            commands::open_link,
            commands::store_secret,
            commands::forget_secret,
            commands::held_secrets,
            commands::connect_service,
            commands::morning_brief,
            commands::mind_graph,
            commands::run_capability,
            commands::askable_capabilities,
            sessions::ask,
            island::island_rect,
            island::island_mode,
            island::island_focus,
            island::island_screen,
            coding::coding_sessions,
            coding::coding_asks,
            coding::coding_detail,
            coding::coding_step,
            coding::coding_reveal,
            coding::coding_seen,
            coding::coding_answer,
            coding::coding_hooks,
            coding::coding_hooks_set,
            stats::glance_stats,
            stats::glance_watch,
            widgets::island_widgets,
            widgets::island_widgets_set,
            pomodoro::pomodoro_state,
            pomodoro::pomodoro_start,
            pomodoro::pomodoro_pause,
            pomodoro::pomodoro_reset,
            pomodoro::pomodoro_period,
            media::music_now,
            media::music_art,
            media::music_refresh,
            media::music_control,
            media::music_introduce,
            shelf::shelf_list,
            shelf::shelf_add,
            shelf::shelf_remove,
            shelf::shelf_reveal,
            shelf::shelf_drag,
            island::island_dismiss,
            island::island_reveal,
            island::island_tabs,
            island::island_tabs_set,
            island::island_home,
            shortcuts::island_shortcuts,
            shortcuts::island_shortcuts_set,
            island::island_home_set,
            sessions::model_options,
            sessions::known_capabilities,
            sessions::project_board,
            sessions::skills_list,
            sessions::skill_approve,
            sessions::skill_forget,
            sessions::session_list,
            sessions::session_read,
            sessions::session_start,
            sessions::session_rename,
            sessions::session_prefer,
            sessions::session_forget,
            commands::show_mind,
            sight::start_vision,
            sight::stop_vision,
            sight::capture_screen,
            wake::wake_listen,
            wake::wake_state,
            presence::ambient_state,
            presence::ambient_recent,
            presence::ambient_look,
            vaults::vaults_list,
            vaults::vault_connect,
            vaults::vault_disconnect,
            vaults::vault_mode,
            playbooks::playbooks_list,
            playbooks::playbook_read,
            playbooks::playbook_approve,
            playbooks::playbook_reject,
            playbooks::playbook_runs,
            playbooks::playbook_repair,
            playbooks::playbook_invoke,
            playbooks::research_notes,
            playbooks::research_read,
            web::web_engine,
            web::web_engine_set,
            web::web_fallback_set,
            web::web_search_try
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            if let Err(failure) = settings::keep_private(&settings::kyuren_home()) {
                eprintln!("kyuren home: {failure}");
            }

            tauri::async_runtime::block_on(paths::adopt_login_path());
            let sidecars = tauri::async_runtime::block_on(Sidecars::start(&handle))?;
            let status = tauri::async_runtime::block_on(sidecars.probe());
            eprintln!("kyuren sidecars: {status}");
            app.manage(sidecars);

            island::install(&handle)?;
            widgets::install(&handle);
            pomodoro::install();
            media::install(&handle);
            reader::install(&handle)?;
            hotkey::register_eventually(&handle);
            tray::install(app)?;

            let summoned = handle.clone();
            app.listen("summon", move |_event| listening::on_summon(&summoned));

            // A machine that was listening for its name when it was shut goes back to listening.
            let wake = wake::wanted();
            if wake.on {
                let woken = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(failure) = wake::apply(&woken, wake).await {
                        eprintln!("kyuren wake: {failure}");
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Kyuren")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                hotkey::unregister(app);
                if let Some(sidecars) = app.try_state::<Sidecars>() {
                    tauri::async_runtime::block_on(sidecars.shutdown());
                }
            }
        });
}
