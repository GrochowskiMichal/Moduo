//! Microsoft (Outlook.com and M365) OAuth for IMAP/SMTP (decision 14).
//! A separate token from calendar's Graph token: one token covers one resource.

use super::AuthError;

pub const SCOPES: &[&str] = &[
    "offline_access",
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
];
/// Requested incrementally only when SMTP AUTH is off for the tenant (MR-6).
pub const GRAPH_SEND_SCOPES: &[&str] = &["offline_access", "https://graph.microsoft.com/Mail.Send"];
pub const AUTH_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
pub const IMAP_HOST: &str = "outlook.office365.com";
pub const SMTP_HOST: &str = "smtp.office365.com";
pub const SMTP_PORT: u16 = 587;

/// `MODUO_EMAIL_MICROSOFT_CLIENT_ID`, falling back to the calendar app's id.
pub fn client_id(calendar_fallback: Option<&str>) -> Option<String> {
    std::env::var("MODUO_EMAIL_MICROSOFT_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("MODUO_EMAIL_MICROSOFT_CLIENT_ID").map(str::to_string))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| calendar_fallback.map(str::to_string))
}

/// Microsoft's refresh grant names the scopes again.
pub fn refresh_scope() -> String {
    SCOPES.join(" ")
}

/// `535 5.7.139`: SMTP AUTH disabled for the tenant, so send goes through Graph.
pub fn is_smtp_auth_disabled(smtp_error: &str) -> bool {
    smtp_error.contains("5.7.139")
}

pub fn classify_error(body: &str) -> AuthError {
    for code in ["AADSTS65001", "AADSTS90094", "AADSTS90095"] {
        if body.contains(code) {
            return AuthError::AdminConsentRequired { provider_code: code.into() };
        }
    }
    if body.contains("invalid_grant") || body.contains("AADSTS70008") || body.contains("AADSTS50173") {
        return AuthError::Reconnect;
    }
    AuthError::Transient(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes() {
        assert_eq!(
            SCOPES,
            &[
                "offline_access",
                "https://outlook.office.com/IMAP.AccessAsUser.All",
                "https://outlook.office.com/SMTP.Send"
            ]
        );
        assert!(!SCOPES.iter().any(|s| s.contains("graph.microsoft.com")));
        assert!(GRAPH_SEND_SCOPES.contains(&"https://graph.microsoft.com/Mail.Send"));
        assert!(TOKEN_ENDPOINT.contains("/common/"));
        assert_eq!(refresh_scope().split(' ').count(), 3);
    }

    #[test]
    fn admin_consent_and_reconnect_mapping() {
        assert_eq!(
            classify_error("error=consent_required AADSTS65001: The user or administrator has not consented"),
            AuthError::AdminConsentRequired { provider_code: "AADSTS65001".into() }
        );
        assert_eq!(classify_error(r#"{"error":"invalid_grant"}"#), AuthError::Reconnect);
        assert!(is_smtp_auth_disabled("535 5.7.139 Authentication unsuccessful"));
        assert!(!is_smtp_auth_disabled("535 5.7.8 bad creds"));
    }
}
