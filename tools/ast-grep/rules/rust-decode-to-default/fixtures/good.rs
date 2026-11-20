// Fixed shapes: nothing here may be reported.
fn read_accounts(store: &Store) -> Result<Vec<Account>, String> {
    match store.kv_get(NS, KEY).map_err(|e| e.to_string())? {
        None => Ok(vec![]),
        Some(value) => serde_json::from_value::<Vec<Account>>(value)
            .map_err(|e| format!("email_accounts_unreadable: {e}")),
    }
}

fn limit(raw: Option<u32>) -> u32 {
    // Not a decode: a plain Option default is fine.
    raw.unwrap_or_default()
}

fn read_settings(raw: Value) -> Result<Settings, String> {
    serde_json::from_value(raw).map_err(|e| e.to_string())
}
