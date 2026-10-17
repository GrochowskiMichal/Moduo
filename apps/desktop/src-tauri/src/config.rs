/// Keychain service for signed release builds (staging + prod share it: same
/// Developer ID, same designated requirement, so macOS never re-prompts).
const RELEASE_KEYCHAIN_SERVICE: &str = "com.moduo.desktop.auth";

/// Unsigned local/dev builds get their own service. macOS ties each keychain
/// entry's access list to the app that created it, so a dev build and the signed
/// `.dmg` app sharing one service makes the signed app prompt for the login
/// password on every read of an entry the dev build wrote.
const DEV_KEYCHAIN_SERVICE: &str = "com.moduo.desktop.dev.auth";

fn default_keychain_service() -> &'static str {
    if cfg!(debug_assertions) {
        DEV_KEYCHAIN_SERVICE
    } else {
        RELEASE_KEYCHAIN_SERVICE
    }
}

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub keychain_service: String,
    pub calendar_google_client_id: Option<String>,
    pub calendar_google_client_secret: Option<String>,
    /// Gmail (email module) OAuth app. Falls back to the calendar Google app when
    /// unset — one Google Cloud OAuth client can carry both the calendar and the
    /// `https://mail.google.com/` scopes (EM-2).
    pub email_google_client_id: Option<String>,
    pub email_google_client_secret: Option<String>,
    pub calendar_microsoft_client_id: Option<String>,
    pub zoom_client_id: Option<String>,
    pub zoom_client_secret: Option<String>,
    pub google_meet_client_id: Option<String>,
    pub google_meet_client_secret: Option<String>,
    pub token_encryption_secret: Option<String>,
    pub supabase_url: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            keychain_service: std::env::var("MODUO_KEYCHAIN_SERVICE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| default_keychain_service().to_string()),
            calendar_google_client_id: std::env::var("MODUO_CALENDAR_GOOGLE_CLIENT_ID")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            calendar_google_client_secret: std::env::var("MODUO_CALENDAR_GOOGLE_CLIENT_SECRET")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            email_google_client_id: std::env::var("MODUO_EMAIL_GOOGLE_CLIENT_ID")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            email_google_client_secret: std::env::var("MODUO_EMAIL_GOOGLE_CLIENT_SECRET")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            calendar_microsoft_client_id: std::env::var("MODUO_CALENDAR_MICROSOFT_CLIENT_ID")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            zoom_client_id: std::env::var("MODUO_ZOOM_CLIENT_ID")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            zoom_client_secret: std::env::var("MODUO_ZOOM_CLIENT_SECRET")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            google_meet_client_id: std::env::var("MODUO_GOOGLE_MEET_CLIENT_ID")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            google_meet_client_secret: std::env::var("MODUO_GOOGLE_MEET_CLIENT_SECRET")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            token_encryption_secret: std::env::var("MODUO_TOKEN_ENCRYPTION_SECRET")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            supabase_url: std::env::var("MODUO_SUPABASE_URL")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| "https://wtoonrvuqumihpkbvwvs.supabase.co".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_and_release_builds_never_share_a_keychain_service() {
        assert_ne!(DEV_KEYCHAIN_SERVICE, RELEASE_KEYCHAIN_SERVICE);
        // `cargo test` is a debug build, so it must land on the dev service.
        assert_eq!(default_keychain_service(), DEV_KEYCHAIN_SERVICE);
    }
}
