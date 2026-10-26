// Pre-fix shapes: every `@flag` line must be reported.
fn read_accounts(store: &Store) -> Result<Vec<Account>, String> {
    match store.kv_get(NS, KEY).map_err(|e| e.to_string())? {
        None => Ok(vec![]),
        // @flag
        Some(value) => Ok(serde_json::from_value::<Vec<Account>>(value).unwrap_or_else(|_| vec![])),
    }
}

fn read_settings(raw: Value) -> Result<Settings, String> {
    // @flag
    Ok(serde_json::from_value(raw).unwrap_or_default())
}

fn read_list(text: &str) -> Vec<String> {
    // @flag
    serde_json::from_str(text).unwrap_or(Vec::new())
}

fn read_bytes(bytes: &[u8]) -> Vec<Row> {
    // @flag
    bincode::deserialize(bytes).ok().unwrap_or_default()
}
