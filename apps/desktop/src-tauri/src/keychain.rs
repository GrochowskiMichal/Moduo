use anyhow::Context;
use keyring::Error as KeyringError;

pub fn get_secret(service: &str, account: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring::Entry::new(service, account)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        // Keychain can be unavailable/locked at app start; treat as "no cached session".
        Err(KeyringError::NoStorageAccess(_)) => Ok(None),
        Err(error) => Err(error).context("failed to read keychain secret"),
    }
}

pub fn get_secret_strict(service: &str, account: &str) -> anyhow::Result<Option<String>> {
    let entry = keyring::Entry::new(service, account)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(KeyringError::NoStorageAccess(message)) => {
            Err(anyhow::anyhow!("no keychain access: {}", message))
        }
        Err(error) => Err(error).context("failed to read keychain secret"),
    }
}

pub fn set_secret(service: &str, account: &str, value: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(service, account)?;
    entry
        .set_password(value)
        .context("failed to write keychain secret")
}

pub fn delete_secret(service: &str, account: &str) -> anyhow::Result<()> {
    let entry = keyring::Entry::new(service, account)?;
    let _ = entry.delete_credential();
    Ok(())
}
