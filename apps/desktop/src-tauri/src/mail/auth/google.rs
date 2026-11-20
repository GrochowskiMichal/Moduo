//! Google (personal Gmail and Workspace) OAuth for IMAP/SMTP (decision 15).
//! Workspace reuses the Gmail flow with the personal-only restriction removed;
//! app passwords stay personal-Gmail-only.

use super::AuthError;
use crate::mail::contracts::Provider;

pub const SCOPES: &[&str] = &["https://mail.google.com/", "openid", "email"];
pub const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const IMAP_HOST: &str = "imap.gmail.com";
pub const SMTP_HOST: &str = "smtp.gmail.com";

const PERSONAL_DOMAINS: &[&str] = &["gmail.com", "googlemail.com"];

fn domain(email: &str) -> String {
    email.rsplit('@').next().unwrap_or("").trim().to_lowercase()
}

/// The provider a Google sign-in resolves to: personal Gmail or Workspace.
/// Both are allowed through OAuth (no personal-only gate any more).
pub fn provider_for_oauth(email: &str) -> Provider {
    if PERSONAL_DOMAINS.contains(&domain(email).as_str()) {
        Provider::Gmail
    } else {
        Provider::GoogleWorkspace
    }
}

/// App passwords are accepted only for personal Gmail (I66 / S6).
pub fn app_password_allowed(email: &str) -> bool {
    provider_for_oauth(email) == Provider::Gmail
}

/// Map Google's OAuth errors: admin policy and org denials get the admin copy.
pub fn classify_error(body: &str) -> AuthError {
    for code in ["admin_policy_enforced", "org_internal", "access_denied"] {
        if body.contains(code) {
            return AuthError::AdminConsentRequired { provider_code: code.into() };
        }
    }
    if body.contains("invalid_grant") {
        return AuthError::Reconnect;
    }
    AuthError::Transient(body.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_allowed() {
        assert_eq!(provider_for_oauth("me@gmail.com"), Provider::Gmail);
        assert_eq!(provider_for_oauth("Me@GoogleMail.com"), Provider::Gmail);
        assert_eq!(provider_for_oauth("anna@acme.io"), Provider::GoogleWorkspace);
        assert!(app_password_allowed("me@gmail.com"));
        assert!(!app_password_allowed("anna@acme.io"));
    }

    #[test]
    fn scopes_carry_full_mail_access() {
        assert!(SCOPES.contains(&"https://mail.google.com/"));
    }

    #[test]
    fn admin_errors_map_to_admin_copy() {
        assert_eq!(
            classify_error(r#"{"error":"admin_policy_enforced"}"#),
            AuthError::AdminConsentRequired { provider_code: "admin_policy_enforced".into() }
        );
        assert_eq!(classify_error(r#"{"error":"invalid_grant"}"#), AuthError::Reconnect);
        assert!(!classify_error("502").is_terminal());
    }
}
