/// Every command the app registers. Declared, each becomes a permission a window has to be
/// granted, so a window can call only the commands its own capability names.
const COMMANDS: &[&str] = &[
    "sidecar_status", "speak", "resolve_permission", "open_link",
    "store_secret", "forget_secret", "held_secrets", "connect_service",
    "morning_brief", "mind_graph", "run_capability", "askable_capabilities",
    "ask", "island_rect", "island_mode", "island_focus",
    "island_screen", "coding_sessions", "coding_asks", "coding_detail",
    "coding_step", "coding_reveal", "coding_seen", "coding_answer",
    "coding_hooks", "coding_hooks_set", "glance_stats", "glance_watch",
    "island_widgets", "island_widgets_set", "pomodoro_state", "pomodoro_start",
    "pomodoro_pause", "pomodoro_reset", "pomodoro_period", "music_now",
    "music_art", "music_refresh", "music_control", "music_introduce",
    "shelf_list", "shelf_add", "shelf_remove", "shelf_reveal",
    "shelf_drag", "island_dismiss", "island_reveal", "island_tabs",
    "island_tabs_set", "island_home", "island_shortcuts", "island_shortcuts_set",
    "island_home_set", "model_options", "known_capabilities", "project_board",
    "skills_list", "skill_approve", "skill_forget", "session_list",
    "session_read", "session_start", "session_rename", "session_prefer",
    "session_forget", "show_mind", "start_vision", "stop_vision",
    "capture_screen", "wake_listen", "wake_state", "ambient_state",
    "ambient_recent", "ambient_look", "vaults_list", "vault_connect",
    "vault_disconnect", "vault_mode", "playbooks_list", "playbook_read",
    "playbook_approve", "playbook_reject", "playbook_runs", "playbook_repair",
    "playbook_invoke", "research_notes", "research_read", "web_engine",
    "web_engine_set", "web_fallback_set", "web_search_try",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri-build reads the app's configuration, capabilities and commands");
}
