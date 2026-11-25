// Pre-fix shapes: every `@flag` line must be reported.
fn followup_rows(store: &Store) -> StoreResult<Vec<Row>> {
    let mut out = Vec::new();
    for (thread_id, raw) in store.kv_scan(FOLLOWUP)? {
        // @flag
        let Ok(f) = serde_json::from_str::<FollowUp>(&raw) else {
            store.kv_delete(&format!("{FOLLOWUP}{thread_id}"))?;
            continue;
        };
        out.push(f.into());
    }
    Ok(out)
}

fn drafts(store: &Store) -> StoreResult<Vec<Draft>> {
    let mut out = Vec::new();
    for (key, raw) in store.kv_scan(DRAFT)? {
        match serde_json::from_str::<Draft>(&raw) {
            Ok(d) => out.push(d),
            // @flag
            Err(_) => {
                store.kv_delete(&key)?;
            }
        }
    }
    Ok(out)
}
