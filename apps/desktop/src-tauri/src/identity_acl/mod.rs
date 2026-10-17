use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

use crate::store_redb::RedbStore;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentity {
    pub device_id: String,
    pub public_key: String,
    pub key_rotated_at: String,
}

pub struct AclManager {
    cache: Mutex<Option<LocalIdentity>>,
}

impl AclManager {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(None),
        }
    }

    pub fn get_or_create_identity(&self, store: &RedbStore) -> anyhow::Result<LocalIdentity> {
        if let Some(cached) = self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .clone()
        {
            return Ok(cached);
        }

        let existing = store.get_device_identity("current")?;
        if let Some(payload) = existing {
            let parsed: LocalIdentity = serde_json::from_value(payload)?;
            *self
                .cache
                .lock()
                .map_err(|e| anyhow::anyhow!(e.to_string()))? = Some(parsed.clone());
            return Ok(parsed);
        }

        self.rotate_identity(store)
    }

    /// Derives a deterministic identity from a BIP-39 mnemonic seed.
    /// The first 32 bytes of the 64-byte seed are used as an ed25519 private key seed.
    /// The account ID is a UUID v5 derived from the public key — same mnemonic always
    /// produces the same identity, enabling account recovery after a db wipe.
    pub fn get_or_create_identity_from_seed(
        &self,
        seed: &[u8],
        store: &RedbStore,
    ) -> anyhow::Result<LocalIdentity> {
        let seed_bytes: [u8; 32] = seed[..32]
            .try_into()
            .map_err(|_| anyhow::anyhow!("bip39 seed too short"))?;

        let signing_key = SigningKey::from_bytes(&seed_bytes);
        let verifying_key = signing_key.verifying_key();
        let public_key_bytes = verifying_key.to_bytes(); // [u8; 32]

        // Deterministic account ID: UUID v5(OID namespace, public_key_bytes)
        let account_id =
            uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, &public_key_bytes).to_string();

        // If the exact same identity is already stored, reuse it (preserves key_rotated_at)
        if let Some(payload) = store.get_device_identity("current")? {
            if let Ok(existing) = serde_json::from_value::<LocalIdentity>(payload) {
                if existing.device_id == account_id {
                    *self
                        .cache
                        .lock()
                        .map_err(|e| anyhow::anyhow!(e.to_string()))? = Some(existing.clone());
                    return Ok(existing);
                }
            }
        }

        // New or changed identity — persist public identity
        let identity = LocalIdentity {
            device_id: account_id,
            public_key: STANDARD_NO_PAD.encode(public_key_bytes),
            key_rotated_at: chrono::Utc::now().to_rfc3339(),
        };

        store.put_device_identity("current", &serde_json::to_value(&identity)?)?;
        *self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))? = Some(identity.clone());
        Ok(identity)
    }

    pub fn rotate_identity(&self, store: &RedbStore) -> anyhow::Result<LocalIdentity> {
        let mut public_key = [0_u8; 32];
        let mut private_key = [0_u8; 32];
        rand::fill(&mut public_key);
        rand::fill(&mut private_key);

        let identity = LocalIdentity {
            device_id: uuid::Uuid::new_v4().to_string(),
            public_key: STANDARD_NO_PAD.encode(public_key),
            key_rotated_at: chrono::Utc::now().to_rfc3339(),
        };

        store.put_device_identity("current", &serde_json::to_value(&identity)?)?;
        *self
            .cache
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))? = Some(identity.clone());
        Ok(identity)
    }

    pub fn workspace_can_module(
        &self,
        store: &RedbStore,
        workspace_id: &str,
        user_id: &str,
        module: &str,
        min_level: &str,
    ) -> anyhow::Result<bool> {
        let role_level = store
            .list_workspace_members(workspace_id)?
            .into_iter()
            .find(|member| member.user_id == user_id && member.is_active)
            .map(|member| match member.role.as_str() {
                "owner" | "admin" => "admin".to_string(),
                "editor" => "edit".to_string(),
                "viewer" => "view".to_string(),
                _ => "none".to_string(),
            })
            .unwrap_or_else(|| "none".to_string());

        let acl_level = store
            .get_workspace_acl(workspace_id, user_id)?
            .map(|acl| match module {
                "notes" => acl.notes,
                "tasks" => acl.tasks,
                _ => "none".to_string(),
            })
            .unwrap_or_else(|| "none".to_string());

        let granted_rank = rank_permission(&role_level).max(rank_permission(&acl_level));
        Ok(granted_rank >= rank_permission(min_level))
    }
}

fn rank_permission(permission: &str) -> i32 {
    match permission {
        "none" => 0,
        "view" => 1,
        "edit" => 2,
        "admin" => 3,
        _ => 0,
    }
}
