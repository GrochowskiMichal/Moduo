use serde::{Deserialize, Serialize};

use crate::{config::AppConfig, keychain};

pub const KEYCHAIN_ACCOUNT: &str = "session";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub user: AuthUser,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub email: Option<String>,
}

pub fn load_session(config: &AppConfig) -> anyhow::Result<Option<AuthSession>> {
    let Some(raw) = keychain::get_secret(&config.keychain_service, KEYCHAIN_ACCOUNT)? else {
        return Ok(None);
    };
    match serde_json::from_str::<AuthSession>(&raw) {
        Ok(session) => Ok(Some(session)),
        Err(_) => {
            let _ = keychain::delete_secret(&config.keychain_service, KEYCHAIN_ACCOUNT);
            Ok(None)
        }
    }
}

pub fn persist_session(config: &AppConfig, session: &AuthSession) -> anyhow::Result<()> {
    let encoded = serde_json::to_string(session)?;
    keychain::set_secret(&config.keychain_service, KEYCHAIN_ACCOUNT, &encoded)
}

pub fn clear_session(config: &AppConfig) -> anyhow::Result<()> {
    keychain::delete_secret(&config.keychain_service, KEYCHAIN_ACCOUNT)
}
