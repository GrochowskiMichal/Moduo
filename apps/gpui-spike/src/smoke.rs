//! `--smoke`: the wire protocol end to end, without a window. It signs in with
//! a token from `MODUO_SPIKE_ACCESS_TOKEN`, then creates, edits, completes,
//! reorders, deletes and restores one throwaway task and deletes it again.
//! It refuses to run against anything but the local stack.

use anyhow::{anyhow, ensure, Result};
use serde_json::json;

use crate::api::Api;
use crate::config::Config;
use crate::model::{self, end_position, midpoint, Store};

pub fn run(config: Config) -> i32 {
    match smoke(config) {
        Ok(()) => {
            println!("smoke: ok");
            0
        }
        Err(err) => {
            eprintln!("smoke: FAILED: {err:#}");
            1
        }
    }
}

fn smoke(config: Config) -> Result<()> {
    ensure!(config.is_local(), "the smoke test only runs against the local stack, not {}", config.url);
    let api = Api::new(config);
    api.restore().map_err(|_| anyhow!("set MODUO_SPIKE_ACCESS_TOKEN"))?;

    let workspaces = model::load_workspaces(&api)?;
    let ws = workspaces.first().ok_or_else(|| anyhow!("no workspace"))?.id.clone();
    println!("workspaces: {}", workspaces.len());

    let mut store = Store::default();
    store.set_structure(model::load_structure(&api, &ws)?);
    store.apply(model::load_tasks(&api, &ws)?, true);
    println!(
        "loaded: {} projects, {} sections, {} statuses, {} tasks",
        store.buckets.len(),
        store.sections.len(),
        store.statuses.len(),
        store.tasks.len()
    );
    let inbox = store.inbox().ok_or_else(|| anyhow!("no Inbox"))?.id.clone();

    let id = uuid::Uuid::new_v4().to_string();
    let position = end_position(store.tasks.values().filter(|t| t.bucket_id == inbox).map(|t| t.position.as_str()));
    let created = model::create_task(
        &api,
        &ws,
        json!({
            "id": id, "title": "gpui-spike smoke", "description": "", "bucket_id": inbox, "parent_id": null,
            "due_on": null, "scheduled_at": null, "duration_minutes": null, "recurrence": null,
            "energy_level": null, "priority": null, "status": "todo", "position": position,
        }),
    )?;
    ensure!(created[0].id == id && created[0].title == "gpui-spike smoke", "create returned the wrong row");
    println!("create: #{} at {}", created[0].number, created[0].position);

    let edited = model::update_task(
        &api,
        &ws,
        &id,
        json!({ "title": "gpui-spike smoke (edited)", "description": "notes", "due_on": "2026-12-01", "priority": "high" }),
    )?;
    let row = &edited[0];
    ensure!(row.title.ends_with("(edited)") && row.description == "notes", "title/notes not saved");
    ensure!(row.due_on.as_deref() == Some("2026-12-01") && row.priority.as_deref() == Some("high"), "due/priority not saved");
    println!("edit: title, notes, due {:?}, priority {:?}", row.due_on, row.priority);

    let done = model::set_status(&api, &ws, &id, "done")?;
    ensure!(done.first().map_or(false, |t| t.is_done()), "not done after set_status");
    let reopened = model::set_status(&api, &ws, &id, "todo")?;
    ensure!(reopened.first().map_or(false, |t| !t.is_closed()), "not reopened");
    println!("complete and reopen: ok");

    let before = midpoint("", Some(&position));
    let moved = model::update_task(&api, &ws, &id, json!({ "position": before }))?;
    ensure!(moved[0].position == before && before < position, "reorder key not stored");
    println!("reorder: {position} -> {before}");

    // A delta read from the cursor must see the task, and its soft delete.
    let cursor = store.cursor.unwrap_or(jiff::Timestamp::now());
    ensure!(model::load_delta(&api, &ws, cursor)?.iter().any(|t| t.id == id), "delta missed the new task");
    let deleted = model::update_task(&api, &ws, &id, json!({ "deleted_at": jiff::Timestamp::now().to_string() }))?;
    ensure!(deleted[0].deleted_at.is_some(), "not deleted");
    ensure!(
        model::load_delta(&api, &ws, cursor)?.iter().any(|t| t.id == id && t.deleted_at.is_some()),
        "delta missed the delete"
    );
    let restored = model::update_task(&api, &ws, &id, json!({ "deleted_at": null }))?;
    ensure!(restored[0].deleted_at.is_none(), "not restored");
    println!("delete, delta, undo: ok");

    // Leave nothing behind but a row in the trash.
    model::update_task(&api, &ws, &id, json!({ "deleted_at": jiff::Timestamp::now().to_string() }))?;
    Ok(())
}
