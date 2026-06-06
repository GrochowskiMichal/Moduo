use serde::{Deserialize, Serialize};

use crate::domain::NoteMeta;
use crate::store_redb::RedbStore;

const MIGRATION_KEY: &str = "legacy_v1";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPayload {
    pub notes: Vec<NoteMeta>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub already_migrated: bool,
    pub imported: bool,
    pub notes_count: usize,
    pub checksums: std::collections::HashMap<String, String>,
}

pub fn import_legacy_payload(
    store: &RedbStore,
    payload: LegacyPayload,
) -> anyhow::Result<MigrationReport> {
    if store.get_migration_marker(MIGRATION_KEY)?.is_some() {
        return Ok(MigrationReport {
            already_migrated: true,
            imported: false,
            notes_count: 0,
            checksums: std::collections::HashMap::new(),
        });
    }

    for note in &payload.notes {
        store.put_note(note)?;
    }

    store.set_migration_marker(MIGRATION_KEY, &chrono::Utc::now().to_rfc3339())?;

    let workspace_id = payload
        .notes
        .first()
        .map(|n| n.workspace_id.clone())
        .unwrap_or_else(|| "default-workspace".to_string());

    let checksums = store.dump_workspace_hashes(&workspace_id)?;

    Ok(MigrationReport {
        already_migrated: false,
        imported: true,
        notes_count: payload.notes.len(),
        checksums,
    })
}
