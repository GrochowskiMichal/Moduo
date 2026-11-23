// Fixed shapes: nothing here may be reported.
fn followup_rows(store: &Store) -> StoreResult<Vec<Row>> {
    let mut out = Vec::new();
    for (_thread_id, raw) in store.kv_scan(FOLLOWUP)? {
        // Left as it is: the build that wrote it decides.
        let Ok(f) = serde_json::from_str::<FollowUp>(&raw) else {
            continue;
        };
        out.push(f.into());
    }
    Ok(out)
}

fn clear_followup(store: &Store, thread_id: &str) -> StoreResult<()> {
    // A deliberate delete the person asked for, not a decode failure.
    match store.kv_get(&format!("{FOLLOWUP}{thread_id}"))? {
        Some(_) => store.kv_delete(&format!("{FOLLOWUP}{thread_id}")),
        None => Ok(()),
    }
}

fn read_draft(raw: &str) -> Result<Draft, String> {
    match serde_json::from_str::<Draft>(raw) {
        Ok(d) => Ok(d),
        Err(e) => Err(e.to_string()),
    }
}
