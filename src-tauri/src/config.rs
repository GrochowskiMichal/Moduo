#[derive(Clone, Debug)]
pub struct AppConfig {
    pub keychain_service: String,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            keychain_service: std::env::var("MODUO_KEYCHAIN_SERVICE")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "com.moduo.desktop.auth".to_string()),
        }
    }
}
