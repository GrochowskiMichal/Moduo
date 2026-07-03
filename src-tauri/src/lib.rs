use std::{fs, path::PathBuf, sync::Mutex};

use tauri::Manager;

pub mod auth;
pub mod commands;
pub mod config;
pub mod domain;
pub mod email_sync;
pub mod embeddings;
pub mod graph_helix;
pub mod identity_acl;
pub mod keychain;
pub mod migration_legacy;
pub mod store_redb;
pub mod sync;

pub struct AppState {
    pub config: config::AppConfig,
    pub session: Mutex<Option<auth::AuthSession>>,
    pub store: std::sync::Arc<store_redb::RedbStore>,
    pub acl: identity_acl::AclManager,
    pub graph: std::sync::Arc<graph_helix::GraphManager>,
    pub embeddings: std::sync::Arc<embeddings::EmbeddingEngine>,
    pub indexer: embeddings::BackgroundIndexer,
    /// Background cloud-sync worker. Present only when signed in with a Supabase JWT.
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

        let sidecar_path = std::env::var("HELIX_SIDECAR_PATH")
            .ok()
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty());

        let session = store
            .kv_get("auth", "session-cache")
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_value::<auth::AuthSession>(value).ok());

        let store = std::sync::Arc::new(store);
        let graph = std::sync::Arc::new(graph_helix::GraphManager::new(
            sidecar_path,
            db_path.parent().map(|p| p.to_path_buf()),
        ));
        let embeddings = std::sync::Arc::new(embeddings::EmbeddingEngine::new(None)?);
        let indexer =
            embeddings::BackgroundIndexer::new(store.clone(), graph.clone(), embeddings.clone());

        Ok(Self {
            config,
            session: Mutex::new(session),
            store,
            acl,
            graph,
            embeddings,
            indexer,
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

pub fn run() {
    tauri::Builder::default()
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
            commands::graph::graph_upsert_nodes_edges,
            commands::graph::graph_query_related,
            commands::graph::graph_query_hybrid,
            commands::graph::graph_get_full,
            commands::embeddings::embed_and_index_note,
            commands::embeddings::embed_and_index_task,
            commands::embeddings::embed_and_index_email,
            commands::migration::migration_import_legacy,
            commands::local_store::local_store_get,
            commands::local_store::local_store_set,
            commands::local_store::local_store_remove,
            commands::email::account_commands::email_accounts_list,
            commands::email::account_commands::email_account_connect_and_save,
            commands::email::account_commands::email_account_disconnect,
            commands::email::email_list_envelopes,
            commands::email::email_get_message_body,
            commands::email::email_prefetch_bodies,
            commands::email::email_sync_now,
            commands::email::email_set_activity_state,
            commands::email::email_apply_flag,
            commands::email::email_get_mailbox_status,
            commands::email::send_commands::email_send_saved,
            commands::calendar::calendar_google_oauth_start,
            commands::calendar::calendar_outlook_oauth_start,
            commands::calendar::calendar_apple_oauth_start,
            commands::calendar::calendar_google_events_sync,
            commands::calendar::calendar_outlook_events_sync,
            commands::integrations::integration_connect_zoom,
            commands::integrations::integration_connect_google_meet,
            commands::integrations::integration_get_status,
            commands::integrations::integration_disconnect,
            commands::system::open_external_url,
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
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                commands::email::stop_all_idle_workers();
            }
        });
}
