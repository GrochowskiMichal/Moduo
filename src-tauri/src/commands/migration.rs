use tauri::State;

use crate::{migration_legacy::LegacyPayload, AppState};

#[tauri::command]
pub async fn migration_import_legacy(
    state: State<'_, AppState>,
    payload: LegacyPayload,
) -> Result<crate::migration_legacy::MigrationReport, String> {
    crate::migration_legacy::import_legacy_payload(&state.store, payload).map_err(|e| e.to_string())
}
