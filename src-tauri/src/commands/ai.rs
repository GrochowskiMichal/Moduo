use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::{keychain, AppState};

const AI_NAMESPACE: &str = "ai";
const AI_CREDENTIALS_KEY: &str = "credentials";
const AI_KEYCHAIN_ACCOUNT: &str = "ai_encryption_secret";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialUpsertInput {
    pub api_key: String,
    pub model: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiCredential {
    pub id: String,
    pub model: String,
    pub encrypted_api_key_b64: String,
    pub nonce_b64: String,
    pub key_preview: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialSummary {
    pub id: String,
    pub model: String,
    pub key_preview: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentialResolved {
    pub id: String,
    pub model: String,
    pub api_key: String,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn get_or_create_encryption_secret(state: &AppState) -> Result<String, String> {
    let service = &state.config.keychain_service;
    if let Some(value) = keychain::get_secret(service, AI_KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())? {
        if !value.trim().is_empty() {
            return Ok(value);
        }
    }

    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let generated = STANDARD.encode(bytes);
    keychain::set_secret(service, AI_KEYCHAIN_ACCOUNT, &generated).map_err(|e| e.to_string())?;
    Ok(generated)
}

fn derive_cipher_key(secret: &str) -> [u8; 32] {
    let digest = Sha256::digest(secret.as_bytes());
    let mut key = [0_u8; 32];
    key.copy_from_slice(&digest);
    key
}

fn encrypt_api_key(plain: &str, key_bytes: &[u8; 32]) -> Result<(String, String), String> {
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_raw = [0_u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_raw);
    let nonce = Nonce::from_slice(&nonce_raw);
    let encrypted = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|_| "Failed to encrypt API key".to_string())?;

    Ok((STANDARD.encode(encrypted), STANDARD.encode(nonce_raw)))
}

fn decrypt_api_key(cipher_b64: &str, nonce_b64: &str, key_bytes: &[u8; 32]) -> Result<String, String> {
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);

    let encrypted = STANDARD
        .decode(cipher_b64)
        .map_err(|_| "Corrupted encrypted API key".to_string())?;
    let nonce_raw = STANDARD
        .decode(nonce_b64)
        .map_err(|_| "Corrupted key nonce".to_string())?;
    if nonce_raw.len() != 12 {
        return Err("Invalid nonce length".to_string());
    }

    let nonce = Nonce::from_slice(&nonce_raw);
    let plain = cipher
        .decrypt(nonce, encrypted.as_ref())
        .map_err(|_| "Failed to decrypt API key".to_string())?;
    String::from_utf8(plain).map_err(|_| "API key is not UTF-8".to_string())
}

fn load_credentials(state: &AppState) -> Result<Vec<StoredAiCredential>, String> {
    let raw = state
        .store
        .kv_get(AI_NAMESPACE, AI_CREDENTIALS_KEY)
        .map_err(|e| e.to_string())?;

    match raw {
        Some(value) => serde_json::from_value::<Vec<StoredAiCredential>>(value)
            .map_err(|e| format!("Failed to parse AI credentials: {}", e)),
        None => Ok(Vec::new()),
    }
}

fn save_credentials(state: &AppState, entries: &[StoredAiCredential]) -> Result<(), String> {
    let payload = serde_json::to_value(entries).map_err(|e| e.to_string())?;
    state
        .store
        .kv_set(AI_NAMESPACE, AI_CREDENTIALS_KEY, &payload)
        .map_err(|e| e.to_string())
}

fn summarize(entry: &StoredAiCredential) -> AiCredentialSummary {
    AiCredentialSummary {
        id: entry.id.clone(),
        model: entry.model.clone(),
        key_preview: entry.key_preview.clone(),
        created_at: entry.created_at.clone(),
        updated_at: entry.updated_at.clone(),
    }
}

#[tauri::command]
pub async fn ai_credentials_list(state: State<'_, AppState>) -> Result<Vec<AiCredentialSummary>, String> {
    let mut entries = load_credentials(&state)?;
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(entries.iter().map(summarize).collect())
}

#[tauri::command]
pub async fn ai_credentials_upsert(
    state: State<'_, AppState>,
    input: AiCredentialUpsertInput,
) -> Result<AiCredentialSummary, String> {
    let api_key = input.api_key.trim();
    let model = input.model.trim();

    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }
    if model.is_empty() {
        return Err("Model name is required".to_string());
    }

    let secret = get_or_create_encryption_secret(&state)?;
    let key_bytes = derive_cipher_key(&secret);
    let (encrypted_api_key_b64, nonce_b64) = encrypt_api_key(api_key, &key_bytes)?;

    let now = now_iso();
    let id = uuid::Uuid::new_v4().to_string();
    let suffix = api_key
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    let key_preview = if suffix.is_empty() {
        "••••".to_string()
    } else {
        format!("••••{}", suffix)
    };

    let mut entries = load_credentials(&state)?;
    let record = StoredAiCredential {
        id,
        model: model.to_string(),
        encrypted_api_key_b64,
        nonce_b64,
        key_preview,
        created_at: now.clone(),
        updated_at: now,
    };
    entries.push(record.clone());
    save_credentials(&state, &entries)?;
    Ok(summarize(&record))
}

#[tauri::command]
pub async fn ai_credentials_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut entries = load_credentials(&state)?;
    let original_len = entries.len();
    entries.retain(|entry| entry.id != id);
    if entries.len() == original_len {
        return Ok(());
    }
    save_credentials(&state, &entries)
}

#[tauri::command]
pub async fn ai_credentials_get(state: State<'_, AppState>, id: String) -> Result<AiCredentialResolved, String> {
    let entries = load_credentials(&state)?;
    let record = entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "AI credential not found".to_string())?;

    let secret = get_or_create_encryption_secret(&state)?;
    let key_bytes = derive_cipher_key(&secret);
    let api_key = decrypt_api_key(&record.encrypted_api_key_b64, &record.nonce_b64, &key_bytes)?;

    Ok(AiCredentialResolved {
        id: record.id.clone(),
        model: record.model.clone(),
        api_key,
    })
}
