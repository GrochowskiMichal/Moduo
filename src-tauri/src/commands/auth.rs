use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use bip39::{Language, Mnemonic};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    auth, commands::workspace::join_invite_for_user, domain::ModulePermissions, keychain, AppState,
};

// ── Keychain keys ─────────────────────────────────────────────────────────────
const KEYCHAIN_MNEMONIC_ACCOUNT: &str = "local_mnemonic_phrase";

// ── DB keys ───────────────────────────────────────────────────────────────────
const LOCAL_AUTH_PROFILE_KEY: &str = "local-auth-profile";
const LOCAL_SESSION_CACHE_KEY: &str = "session-cache";

// ─────────────────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAuthProfile {
    pub user_id: String,
    pub display_name: String,
    /// Argon2 hash of the normalised mnemonic phrase.
    pub mnemonic_hash: String,
    /// Optional Argon2 hash of a PIN for fast-unlock.
    pub pin_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAuthStateResponse {
    pub profile_exists: bool,
    pub display_name: Option<String>,
    pub user_id: Option<String>,
    /// Whether a PIN has been configured for fast-unlock.
    pub has_pin: bool,
    /// Whether the mnemonic is cached in the OS keychain (allows auto-unlock).
    pub has_keychain_mnemonic: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentityResponse {
    pub device_id: String,
    pub public_key: String,
    pub key_rotated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMnemonicResponse {
    pub words: Vec<String>,
    pub phrase: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthRegisterResponse {
    pub session: auth::AuthSession,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterMnemonicInput {
    pub display_name: String,
    pub mnemonic_phrase: String,
    pub invite_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockMnemonicInput {
    pub mnemonic_phrase: String,
    pub invite_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDisplayNameInput {
    pub display_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDisplayNameResponse {
    pub display_name: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn hash_secret(secret: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|e| e.to_string())
}

fn verify_secret(secret: &str, hash: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(hash).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(secret.as_bytes(), &parsed)
        .is_ok())
}

/// Normalises whitespace/case and validates as a BIP-39 mnemonic.
/// Returns `(Mnemonic, canonical_phrase)`.
fn parse_mnemonic(phrase: &str) -> Result<(Mnemonic, String), String> {
    let normalized: String = phrase
        .split_whitespace()
        .map(|w| w.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");

    let mnemonic =
        Mnemonic::parse_normalized(&normalized).map_err(|e| format!("invalid_mnemonic: {}", e))?;

    // to_string() on a Mnemonic returns the canonical space-separated phrase.
    Ok((mnemonic.clone(), mnemonic.to_string()))
}

fn load_local_profile(state: &AppState) -> Result<Option<LocalAuthProfile>, String> {
    match state
        .store
        .kv_get("auth", LOCAL_AUTH_PROFILE_KEY)
        .map_err(|e| e.to_string())?
    {
        None => Ok(None),
        Some(value) => serde_json::from_value::<LocalAuthProfile>(value)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

fn save_local_profile(state: &AppState, profile: &LocalAuthProfile) -> Result<(), String> {
    state
        .store
        .kv_set(
            "auth",
            LOCAL_AUTH_PROFILE_KEY,
            &serde_json::to_value(profile).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn create_auth_session(user_id: &str) -> auth::AuthSession {
    auth::AuthSession {
        access_token: uuid::Uuid::new_v4().to_string(),
        refresh_token: Some(uuid::Uuid::new_v4().to_string()),
        user: auth::AuthUser {
            id: user_id.to_string(),
            email: None,
        },
        expires_at: Some((chrono::Utc::now() + chrono::Duration::days(365)).timestamp()),
    }
}

fn load_cached_session(state: &AppState) -> Result<Option<auth::AuthSession>, String> {
    match state
        .store
        .kv_get("auth", LOCAL_SESSION_CACHE_KEY)
        .map_err(|e| e.to_string())?
    {
        None => Ok(None),
        Some(value) => serde_json::from_value::<auth::AuthSession>(value)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

fn persist_active_session(
    state: &AppState,
    session: &auth::AuthSession,
    display_name: Option<&str>,
) -> Result<(), String> {
    state
        .store
        .kv_set(
            "auth",
            LOCAL_SESSION_CACHE_KEY,
            &serde_json::to_value(session).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    *state.session.lock().map_err(|e| e.to_string())? = Some(session.clone());

    let payload = serde_json::json!({
        "userId": session.user.id,
        "displayName": display_name,
    });
    state
        .store
        .kv_set("auth", "current-profile", &payload)
        .map_err(|e| e.to_string())
}

fn ensure_local_workspace_for_user(
    state: &AppState,
    user_id: &str,
    display_name: &str,
) -> Result<(), String> {
    let members = state
        .store
        .list_all_workspace_members()
        .map_err(|e| e.to_string())?;
    if members.iter().any(|m| m.user_id == user_id && m.is_active) {
        return Ok(());
    }

    let now = now_iso();
    let short_user = user_id.chars().take(12).collect::<String>();
    let workspace = crate::domain::WorkspaceSummary {
        id: format!("local-{}", short_user),
        name: format!("{} Workspace", display_name.trim()),
        role: "owner".to_string(),
        permissions: ModulePermissions::default(),
        is_deleted: false,
        created_at: now.clone(),
        updated_at: now,
    };
    let member = crate::domain::WorkspaceMember {
        id: format!("{}:{}", workspace.id, user_id),
        workspace_id: workspace.id.clone(),
        user_id: user_id.to_string(),
        role: "owner".to_string(),
        is_active: true,
        removed_at: None,
    };

    state
        .store
        .put_workspace(&workspace)
        .and_then(|_| state.store.put_workspace_member(&member))
        .and_then(|_| {
            state
                .store
                .upsert_workspace_acl(&workspace.id, user_id, &ModulePermissions::default())
        })
        .map_err(|e| e.to_string())
}

fn maybe_join_invite(
    state: &AppState,
    user_id: &str,
    invite_token: Option<String>,
) -> Result<(), String> {
    let Some(token) = invite_token else {
        return Ok(());
    };
    let token = token.trim();
    if token.is_empty() {
        return Ok(());
    }
    let _ = join_invite_for_user(state, user_id, token)?;
    Ok(())
}

/// Reads the mnemonic from the OS keychain and, if it matches the stored
/// profile hash, derives the identity from the BIP-39 seed and creates a
/// fresh session.  Returns `None` when no mnemonic is in the keychain so
/// the caller can fall back to manual entry.
fn try_unlock_from_keychain(state: &AppState) -> Result<Option<auth::AuthSession>, String> {
    let Some(raw) = keychain::get_secret(&state.config.keychain_service, KEYCHAIN_MNEMONIC_ACCOUNT)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };

    let Some(profile) = load_local_profile(state)? else {
        return Ok(None);
    };

    let (mnemonic, canonical) = parse_mnemonic(&raw)?;

    // Validate the stored mnemonic still matches the profile hash.
    if !verify_secret(&canonical, &profile.mnemonic_hash)? {
        // Stale / wrong mnemonic in keychain — clear it.
        let _ = keychain::delete_secret(&state.config.keychain_service, KEYCHAIN_MNEMONIC_ACCOUNT);
        return Ok(None);
    }

    // Re-derive (or confirm) the cryptographic identity from the BIP-39 seed.
    let seed = mnemonic.to_seed("");
    state
        .acl
        .get_or_create_identity_from_seed(&seed, &state.store)
        .map_err(|e| e.to_string())?;

    let session = create_auth_session(&profile.user_id);
    persist_active_session(state, &session, Some(&profile.display_name))?;
    Ok(Some(session))
}

fn require_session(state: &AppState) -> Result<(), String> {
    if state.session.lock().map_err(|e| e.to_string())?.is_none() {
        return Err("not_authenticated".to_string());
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

/// Returns basic profile info plus whether a PIN / keychain mnemonic exist.
#[tauri::command]
pub async fn auth_get_local_auth_state(
    state: State<'_, AppState>,
) -> Result<LocalAuthStateResponse, String> {
    let Some(profile) = load_local_profile(&state)? else {
        return Ok(LocalAuthStateResponse {
            profile_exists: false,
            display_name: None,
            user_id: None,
            has_pin: false,
            has_keychain_mnemonic: false,
        });
    };

    let has_keychain_mnemonic =
        keychain::get_secret(&state.config.keychain_service, KEYCHAIN_MNEMONIC_ACCOUNT)
            .unwrap_or(None)
            .is_some();

    Ok(LocalAuthStateResponse {
        profile_exists: true,
        display_name: Some(profile.display_name),
        user_id: Some(profile.user_id),
        has_pin: profile.pin_hash.is_some(),
        has_keychain_mnemonic,
    })
}

/// Generates a fresh 12-word BIP-39 mnemonic (standard 2048-word English list,
/// 128 bits of entropy).
#[tauri::command]
pub async fn auth_generate_mnemonic() -> Result<AuthMnemonicResponse, String> {
    let mnemonic = Mnemonic::generate_in_with(&mut rand::thread_rng(), Language::English, 12)
        .map_err(|e| format!("mnemonic_generation_failed: {}", e))?;

    let words: Vec<String> = mnemonic.words().map(|w| w.to_string()).collect();
    let phrase = mnemonic.to_string();
    Ok(AuthMnemonicResponse { words, phrase })
}

/// Creates a new local account from a BIP-39 mnemonic phrase.
///
/// - Validates the phrase against the BIP-39 English word list.
/// - Derives a deterministic ed25519 identity from the BIP-39 seed (same
///   phrase → same `user_id` across installs / after a db wipe).
/// - Stores the mnemonic in the OS keychain for future auto-unlock.
#[tauri::command]
pub async fn auth_register_local_mnemonic(
    state: State<'_, AppState>,
    input: RegisterMnemonicInput,
) -> Result<AuthRegisterResponse, String> {
    if load_local_profile(&state)?.is_some() {
        return Err("Local profile already exists. Unlock with your mnemonic phrase.".to_string());
    }

    let display_name = input.display_name.trim().to_string();
    if display_name.is_empty() {
        return Err("display_name_required".to_string());
    }

    let (mnemonic, canonical) = parse_mnemonic(&input.mnemonic_phrase)?;
    let seed = mnemonic.to_seed("");

    // Derive deterministic identity from the mnemonic seed.
    let identity = state
        .acl
        .get_or_create_identity_from_seed(&seed, &state.store)
        .map_err(|e| e.to_string())?;
    let user_id = identity.device_id;

    let now = now_iso();
    let profile = LocalAuthProfile {
        user_id: user_id.clone(),
        display_name: display_name.clone(),
        mnemonic_hash: hash_secret(&canonical)?,
        pin_hash: None,
        created_at: now.clone(),
        updated_at: now,
    };
    save_local_profile(&state, &profile)?;

    // Cache the mnemonic in the OS keychain for silent auto-unlock on next launch.
    keychain::set_secret(
        &state.config.keychain_service,
        KEYCHAIN_MNEMONIC_ACCOUNT,
        &canonical,
    )
    .map_err(|e| e.to_string())?;

    ensure_local_workspace_for_user(&state, &user_id, &display_name)?;
    maybe_join_invite(&state, &user_id, input.invite_token)?;

    let session = create_auth_session(&user_id);
    persist_active_session(&state, &session, Some(&display_name))?;
    Ok(AuthRegisterResponse { session })
}

/// Unlocks an existing account with the 12-word BIP-39 mnemonic phrase.
///
/// Re-caches the mnemonic in the OS keychain and re-derives the identity,
/// which also handles post-wipe account recovery.
#[tauri::command]
pub async fn auth_unlock_with_mnemonic(
    state: State<'_, AppState>,
    input: UnlockMnemonicInput,
) -> Result<auth::AuthSession, String> {
    let Some(mut profile) = load_local_profile(&state)? else {
        return Err("No local profile found. Create one first.".to_string());
    };

    let (mnemonic, canonical) = parse_mnemonic(&input.mnemonic_phrase)?;

    if !verify_secret(&canonical, &profile.mnemonic_hash)? {
        return Err("Invalid mnemonic phrase".to_string());
    }

    // Re-derive identity (also handles post-wipe recovery).
    let seed = mnemonic.to_seed("");
    state
        .acl
        .get_or_create_identity_from_seed(&seed, &state.store)
        .map_err(|e| e.to_string())?;

    // Refresh keychain cache so the next launch can auto-unlock.
    keychain::set_secret(
        &state.config.keychain_service,
        KEYCHAIN_MNEMONIC_ACCOUNT,
        &canonical,
    )
    .map_err(|e| e.to_string())?;

    maybe_join_invite(&state, &profile.user_id, input.invite_token)?;

    profile.updated_at = now_iso();
    save_local_profile(&state, &profile)?;

    let session = create_auth_session(&profile.user_id);
    persist_active_session(&state, &session, Some(&profile.display_name))?;
    Ok(session)
}

/// Attempts a silent auto-unlock using the mnemonic stored in the OS keychain.
///
/// - If a valid in-memory session already exists, returns it immediately.
/// - Otherwise reads the keychain mnemonic, verifies it, re-derives the
///   identity, and returns a fresh session.
/// - Returns `null` if no mnemonic is in the keychain; the frontend should
///   then show the manual unlock screen.
#[tauri::command]
pub async fn auth_try_auto_unlock(
    state: State<'_, AppState>,
) -> Result<Option<auth::AuthSession>, String> {
    // Fast path: already have a live in-memory session.
    {
        let guard = state.session.lock().map_err(|e| e.to_string())?;
        if let Some(ref session) = *guard {
            let now = chrono::Utc::now().timestamp();
            if session.expires_at.map_or(true, |exp| exp > now) {
                return Ok(Some(session.clone()));
            }
        }
    }

    try_unlock_from_keychain(&state)
}

/// Sets (or replaces) a PIN for fast-unlock.  Requires an active session.
/// The PIN must be at least 4 characters.
#[tauri::command]
pub async fn auth_set_pin(state: State<'_, AppState>, pin: String) -> Result<(), String> {
    require_session(&state)?;

    let pin = pin.trim().to_string();
    if pin.len() < 4 {
        return Err("pin_too_short".to_string());
    }

    let Some(mut profile) = load_local_profile(&state)? else {
        return Err("no_profile".to_string());
    };

    profile.pin_hash = Some(hash_secret(&pin)?);
    profile.updated_at = now_iso();
    save_local_profile(&state, &profile)
}

/// Unlocks using a PIN.  The PIN is verified against the Argon2 hash stored
/// in the profile; internally uses the keychain mnemonic to create the session.
#[tauri::command]
pub async fn auth_unlock_with_pin(
    state: State<'_, AppState>,
    pin: String,
) -> Result<auth::AuthSession, String> {
    let Some(profile) = load_local_profile(&state)? else {
        return Err("no_profile".to_string());
    };

    let Some(ref pin_hash) = profile.pin_hash else {
        return Err("no_pin_configured".to_string());
    };

    if !verify_secret(pin.trim(), pin_hash)? {
        return Err("invalid_pin".to_string());
    }

    // PIN correct — derive session via the keychain mnemonic.
    try_unlock_from_keychain(&state)?.ok_or_else(|| {
        "mnemonic_not_in_keychain: please unlock with your mnemonic phrase first".to_string()
    })
}

/// Removes the PIN.  Requires an active session.
#[tauri::command]
pub async fn auth_remove_pin(state: State<'_, AppState>) -> Result<(), String> {
    require_session(&state)?;

    let Some(mut profile) = load_local_profile(&state)? else {
        return Err("no_profile".to_string());
    };

    profile.pin_hash = None;
    profile.updated_at = now_iso();
    save_local_profile(&state, &profile)
}

#[tauri::command]
pub async fn auth_update_display_name(
    state: State<'_, AppState>,
    input: UpdateDisplayNameInput,
) -> Result<UpdateDisplayNameResponse, String> {
    require_session(&state)?;

    let Some(mut profile) = load_local_profile(&state)? else {
        return Err("no_profile".to_string());
    };

    let next_name = input.display_name.trim().to_string();
    if next_name.is_empty() {
        return Err("display_name_required".to_string());
    }

    profile.display_name = next_name.clone();
    profile.updated_at = now_iso();
    save_local_profile(&state, &profile)?;

    let session_snapshot = {
        let guard = state.session.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    if let Some(session) = session_snapshot {
        persist_active_session(&state, &session, Some(&next_name))?;
    }

    Ok(UpdateDisplayNameResponse {
        display_name: next_name,
    })
}

#[tauri::command]
pub async fn auth_get_stored_mnemonic(state: State<'_, AppState>) -> Result<Option<String>, String> {
    require_session(&state)?;
    keychain::get_secret(&state.config.keychain_service, KEYCHAIN_MNEMONIC_ACCOUNT)
        .map_err(|e| e.to_string())
}

/// Wipes the local DB and all keychain secrets.  After this the user must
/// register again.
#[tauri::command]
pub async fn auth_forgot_reset_local(state: State<'_, AppState>) -> Result<(), String> {
    state.store.wipe_all().map_err(|e| e.to_string())?;

    let svc = &state.config.keychain_service;
    let _ = keychain::delete_secret(svc, "session");
    let _ = keychain::delete_secret(svc, "local_unlock_passkey");
    let _ = keychain::delete_secret(svc, "device_private_key");
    let _ = keychain::delete_secret(svc, KEYCHAIN_MNEMONIC_ACCOUNT);

    *state.session.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Returns the current in-memory session without touching the keychain.
#[tauri::command]
pub async fn auth_refresh_session(
    state: State<'_, AppState>,
) -> Result<Option<auth::AuthSession>, String> {
    Ok(state.session.lock().map_err(|e| e.to_string())?.clone())
}

/// Returns the active session, restoring from the DB cache if needed.
/// Does NOT attempt keychain auto-unlock — use `auth_try_auto_unlock` for that.
#[tauri::command]
pub async fn auth_get_session(
    state: State<'_, AppState>,
) -> Result<Option<auth::AuthSession>, String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = load_cached_session(&state)?;
    }
    Ok(guard.clone())
}

/// Clears the active session (lock-screen behaviour).
/// The mnemonic is kept in the keychain so the next `auth_try_auto_unlock`
/// call will silently restore the session.
/// Use `auth_forgot_reset_local` to wipe everything.
#[tauri::command]
pub async fn auth_sign_out(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.store.kv_remove("auth", LOCAL_SESSION_CACHE_KEY);
    let _ = state.store.kv_remove("auth", "current-profile");
    crate::commands::email::stop_all_idle_workers();
    *state.session.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub async fn auth_get_local_identity(
    state: State<'_, AppState>,
) -> Result<LocalIdentityResponse, String> {
    let identity = state
        .acl
        .get_or_create_identity(&state.store)
        .map_err(|e| e.to_string())?;

    Ok(LocalIdentityResponse {
        device_id: identity.device_id,
        public_key: identity.public_key,
        key_rotated_at: identity.key_rotated_at,
    })
}

#[tauri::command]
pub async fn auth_rotate_device_keys(
    state: State<'_, AppState>,
) -> Result<LocalIdentityResponse, String> {
    let identity = state
        .acl
        .rotate_identity(&state.store)
        .map_err(|e| e.to_string())?;

    Ok(LocalIdentityResponse {
        device_id: identity.device_id,
        public_key: identity.public_key,
        key_rotated_at: identity.key_rotated_at,
    })
}
