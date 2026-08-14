use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use tauri::menu::Menu;
#[cfg(target_os = "macos")]
use tauri::menu::{
    AboutMetadata, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub mod auth;
pub mod commands;
pub mod config;
pub mod domain;
pub mod email_sync;
pub mod identity_acl;
pub mod keychain;
pub mod migration_legacy;
pub mod store_redb;
/// Cloud-sync worker (redb ↔ Supabase). Superseded by the JS `notesV2` engine for
/// the cloud build; kept behind the future offline/"lite" feature, not compiled by default.
#[cfg(feature = "lite")]
pub mod sync;

pub struct AppState {
    pub config: config::AppConfig,
    pub session: Mutex<Option<auth::AuthSession>>,
    pub store: std::sync::Arc<store_redb::RedbStore>,
    pub acl: identity_acl::AclManager,
    /// Desktop confirm-before-quit opt-in, mirrored from the webview-only
    /// `confirmBeforeQuit` preference (which lives only in the webview store) so the
    /// native quit handlers (the custom Quit menu item for ⌘Q and the window
    /// `CloseRequested` handler) can read it synchronously. Pushed by the webview on
    /// boot and on every toggle via `set_confirm_before_quit`.
    pub confirm_before_quit: Mutex<bool>,
    /// True while a quit-confirm dialog is already open. The dialog is non-blocking, so
    /// it returns immediately and leaves the event loop live — a repeated ⌘Q (or another
    /// close) would otherwise stack a second dialog. Cleared when the user cancels.
    pub quit_prompt_open: AtomicBool,
    /// Background cloud-sync worker. Present only when signed in with a Supabase JWT.
    /// Feature-gated behind the future offline/"lite" build.
    #[cfg(feature = "lite")]
    pub sync_worker: Mutex<Option<sync::SyncHandle>>,
}

impl AppState {
    fn new(db_path: PathBuf) -> anyhow::Result<Self> {
        let config = config::AppConfig::from_env();
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let store = store_redb::RedbStore::open(&db_path)?;
        let acl = identity_acl::AclManager::new();
        let _ = acl.get_or_create_identity(&store)?;

        let session = store
            .kv_get("auth", "session-cache")
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_value::<auth::AuthSession>(value).ok());

        let store = std::sync::Arc::new(store);

        Ok(Self {
            config,
            session: Mutex::new(session),
            store,
            acl,
            confirm_before_quit: Mutex::new(false),
            quit_prompt_open: AtomicBool::new(false),
            #[cfg(feature = "lite")]
            sync_worker: Mutex::new(None),
        })
    }
}

fn perform_one_time_auth_v3_reset(
    app: &tauri::AppHandle,
    _config: &config::AppConfig,
) -> anyhow::Result<PathBuf> {
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let data_root = app_data_root.join("moduo");
    let marker = data_root.join("migrations").join("auth_v3_full_reset.done");
    let db_path = data_root.join("moduo_desktop.redb");

    if !marker.exists() {
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(PathBuf::from("moduo_desktop.redb"));
        let _ = fs::remove_file(PathBuf::from("src-tauri/moduo_desktop.redb"));

        let marker_parent = marker
            .parent()
            .ok_or_else(|| anyhow::anyhow!("invalid_reset_marker_path"))?;
        fs::create_dir_all(marker_parent)?;
        fs::write(&marker, chrono::Utc::now().to_rfc3339())?;
    }

    Ok(db_path)
}

/// Menu id of our custom Quit item. macOS's predefined Quit (`PredefinedMenuItem::quit`)
/// calls `NSApplication terminate:` directly, which bypasses every preventable event — so
/// confirm-before-quit could never intercept ⌘Q (it went straight to `RunEvent::Exit`).
/// Routing ⌘Q through a custom item lets `on_menu_event` honour the toggle. DF-19f-quit.
const QUIT_MENU_ID: &str = "moduo-quit";

/// Build the application menu. On macOS this mirrors `tauri::menu::Menu::default` (v2.11)
/// EXACTLY — same App/File/Edit/View/Window/Help structure so Copy/Paste/Undo/Fullscreen/
/// Minimize/etc. and their shortcuts keep working — EXCEPT the App menu's Quit is a custom
/// `MenuItem` (id `QUIT_MENU_ID`, ⌘Q) instead of the predefined Quit, so ⌘Q fires
/// `on_menu_event` and confirm-before-quit can prompt first. Non-macOS (not a shipping
/// target) keeps the stock default menu. DF-19f-quit.
#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit Moduo", true, Some("CmdOrCtrl+Q"))?;

    let app_menu = Submenu::with_items(
        app,
        pkg_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg(not(target_os = "macos"))]
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::default(app)
}

/// Read the mirrored confirm-before-quit opt-in. Recover on a poisoned lock rather than
/// fail-open, so a mid-write panic still honours the user's choice.
fn confirm_before_quit_enabled(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let enabled = match state.confirm_before_quit.lock() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    };
    enabled
}

/// Show the native "quit?" confirm; on Quit, exit the app. Only ONE dialog at a time —
/// `quit_prompt_open` guards against a repeated gesture stacking a second dialog while one
/// is open (the non-blocking `.show()` returns immediately). Cancel clears the guard so a
/// later gesture prompts again. `app.exit(0)` runs the normal shutdown (→ `RunEvent::Exit`
/// worker cleanup); it is safe here because this runs from a deferred event callback, not
/// from inside a `RunEvent` handler (where re-entering the exit loop is forbidden).
fn prompt_quit_confirm(app: &AppHandle) {
    if app
        .state::<AppState>()
        .quit_prompt_open
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    let app = app.clone();
    app.dialog()
        .message("Are you sure you want to quit Moduo?")
        .title("Quit Moduo")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |confirmed| {
            if confirmed {
                app.exit(0);
            } else {
                app.state::<AppState>()
                    .quit_prompt_open
                    .store(false, Ordering::SeqCst);
            }
        });
}

/// Unified quit gate for the app-level ⌘Q gesture (custom Quit menu item). Prompts when
/// the toggle is on, otherwise exits immediately.
fn request_app_quit(app: &AppHandle) {
    if confirm_before_quit_enabled(app) {
        prompt_quit_confirm(app);
    } else {
        app.exit(0);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(build_app_menu)
        // ⌘Q (and the Apple-menu Quit) fire our custom Quit item here, NOT the predefined
        // Quit — so we can confirm before terminating. See `build_app_menu`.
        .on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT_MENU_ID {
                request_app_quit(app);
            }
        })
        // Window close (red button / ⌘W / File → Close Window) raises `CloseRequested`,
        // which ⌘Q does NOT — so the two gestures are disjoint on macOS (no double prompt).
        // When opted in, prevent the native close and confirm first; the dialog exits on
        // Quit and keeps the window on Cancel. Off → let it close natively (unchanged).
        // Scoped to the "main" window: closing this single-window app IS quitting it, but a
        // future secondary window (OAuth/preview popup) should close on its own, not prompt.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && confirm_before_quit_enabled(window.app_handle()) {
                    api.prevent_close();
                    prompt_quit_confirm(window.app_handle());
                }
            }
        })
        .setup(|app| {
            let config = config::AppConfig::from_env();
            let db_path =
                perform_one_time_auth_v3_reset(app.handle(), &config).map_err(|e| e.to_string())?;
            let state = AppState::new(db_path).map_err(|e| e.to_string())?;
            app.manage(state);
            commands::email::bootstrap_idle_workers(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::auth_set_cloud_session,
            commands::auth::auth_get_local_auth_state,
            commands::auth::auth_generate_mnemonic,
            commands::auth::auth_register_local_mnemonic,
            commands::auth::auth_unlock_with_mnemonic,
            commands::auth::auth_forgot_reset_local,
            commands::auth::auth_refresh_session,
            commands::auth::auth_get_session,
            commands::auth::auth_sign_out,
            commands::auth::auth_get_local_identity,
            commands::auth::auth_rotate_device_keys,
            commands::auth::auth_try_auto_unlock,
            commands::auth::auth_set_pin,
            commands::auth::auth_unlock_with_pin,
            commands::auth::auth_remove_pin,
            commands::auth::auth_update_display_name,
            commands::auth::auth_get_stored_mnemonic,
            commands::auth::auth_accept_supabase_session,
            commands::workspace::workspace_list_local,
            commands::workspace::workspace_create_local,
            commands::workspace::workspace_rename_local,
            commands::workspace::workspace_leave_local,
            commands::workspace::workspace_soft_delete_local,
            commands::workspace::workspace_issue_invite,
            commands::workspace::workspace_join_invite,
            commands::workspace::workspace_list_members,
            commands::workspace::workspace_list_invites,
            commands::workspace::workspace_update_invite,
            commands::workspace::workspace_revoke_invite,
            commands::workspace::workspace_update_member_permissions,
            commands::workspace::workspace_list_notifications,
            commands::workspace::workspace_mark_notification_read,
            commands::workspace::workspace_mark_all_notifications_read,
            commands::notes::notes_list,
            commands::notes::notes_get_doc_state,
            commands::tasks_module::tasks_module_list,
            commands::tasks_module::tasks_module_seed_inbox,
            commands::tasks_module::tasks_module_upsert_bucket,
            commands::tasks_module::tasks_module_delete_bucket,
            commands::tasks_module::tasks_module_upsert_task,
            commands::tasks_module::tasks_module_delete_task,
            commands::tasks_module::tasks_module_upsert_tag,
            commands::tasks_module::tasks_module_delete_tag,
            commands::tasks_module::tasks_module_attach_tag,
            commands::tasks_module::tasks_module_detach_tag,
            commands::migration::migration_import_legacy,
            commands::local_store::local_store_get,
            commands::local_store::local_store_set,
            commands::local_store::local_store_remove,
            commands::email::account_commands::email_accounts_list,
            commands::email::account_commands::email_account_connect_and_save,
            commands::email::account_commands::email_account_disconnect,
            commands::email::account_commands::email_account_set_history_depth,
            commands::email::oauth::email_gmail_oauth_start,
            commands::email::email_list_envelopes,
            commands::email::email_get_thread,
            commands::email::email_get_message_body,
            commands::email::email_prefetch_bodies,
            commands::email::email_sync_now,
            commands::email::email_set_activity_state,
            commands::email::email_apply_flag,
            commands::email::email_list_folders,
            commands::email::email_apply_message_op,
            commands::email::email_get_mailbox_status,
            commands::email::snooze::email_snooze_thread,
            commands::email::snooze::email_snooze_restore,
            commands::email::send_commands::email_send_saved,
            commands::email::send_commands::email_send_message,
            commands::email::attachments::email_list_attachments,
            commands::email::attachments::email_save_attachment,
            commands::email::attachments::email_pick_attachments,
            commands::email::attachments::email_get_inline_images,
            commands::email::search::email_search_bodies,
            commands::email::search::email_search_server,
            commands::calendar::calendar_google_oauth_start,
            commands::calendar::calendar_outlook_oauth_start,
            commands::calendar::calendar_apple_oauth_start,
            commands::calendar::calendar_google_events_sync,
            commands::calendar::calendar_outlook_events_sync,
            commands::caldav::calendar_caldav_discover,
            commands::caldav::calendar_caldav_save_credentials,
            commands::caldav::calendar_caldav_delete_credentials,
            commands::caldav::calendar_caldav_events_sync,
            commands::caldav::calendar_ics_save_feed,
            commands::caldav::calendar_ics_delete_feed,
            commands::caldav::calendar_ics_fetch,
            commands::integrations::integration_connect_zoom,
            commands::integrations::integration_connect_google_meet,
            commands::integrations::integration_get_status,
            commands::integrations::integration_disconnect,
            commands::system::open_external_url,
            commands::system::set_confirm_before_quit,
            commands::window::window_toggle_fullscreen,
            commands::timetracking::tt_list,
            commands::timetracking::tt_upsert_entry,
            commands::timetracking::tt_delete_entry,
            commands::timetracking::tt_upsert_category,
            commands::timetracking::tt_delete_category,
            commands::timetracking::tt_upsert_rule,
            commands::timetracking::tt_delete_rule,
            commands::timetracking::tt_upsert_project,
            commands::timetracking::tt_delete_project,
            commands::timetracking::tt_upsert_focus_session,
            commands::timetracking::tt_get_active_window,
            commands::timetracking::tt_start_tracking,
            commands::timetracking::tt_stop_tracking,
            commands::timetracking::tt_get_tracking_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building moduo desktop application")
        .run(|_app, event| {
            // The confirm-before-quit decision now lives in the menu + window-close
            // handlers above (which run BEFORE the exit request), so this only cleans up
            // once an exit is actually happening — including for exits we can't intercept
            // (dock right-click → Quit, system logout), which go straight to `Exit`.
            if let tauri::RunEvent::Exit = event {
                commands::email::stop_all_idle_workers();
            }
        });
}
