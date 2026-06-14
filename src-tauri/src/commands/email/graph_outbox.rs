use std::sync::atomic::{AtomicBool, Ordering};

use uuid::Uuid;

use super::model::{StoredEnvelope, StoredGraphOutboxEntry};
use super::parsing::{extract_domain, recipients_for_graph};
use super::storage::{get_body_cache_from_store, parse_json_value};
use crate::domain::{GraphEdge, GraphNode};
use crate::email_sync::now_iso;
use crate::AppState;

static GRAPH_FLUSH_RUNNING: AtomicBool = AtomicBool::new(false);

pub(super) fn queue_graph_upsert_for_envelope(
    state: &AppState,
    envelope: &StoredEnvelope,
) -> Result<(), String> {
    let key = format!(
        "{}::{}::{}",
        envelope.account_id, envelope.folder, envelope.uid
    );
    let payload = serde_json::to_value(envelope).map_err(|e| e.to_string())?;
    let entry = StoredGraphOutboxEntry {
        id: key.clone(),
        account_id: envelope.account_id.clone(),
        workspace_id: envelope.workspace_id.clone(),
        payload,
        retry_count: 0,
        next_retry_at: now_iso(),
        last_error: None,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_graph_outbox(
            &key,
            &serde_json::to_value(entry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

async fn flush_graph_outbox(
    store: std::sync::Arc<crate::store_redb::RedbStore>,
    graph: std::sync::Arc<crate::graph_helix::GraphManager>,
    account_filter: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now();
    let entries = store
        .list_email_graph_outbox()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredGraphOutboxEntry>)
        .filter(|entry| {
            account_filter
                .as_deref()
                .map(|account_id| entry.account_id == account_id)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    for mut entry in entries {
        let next_retry = chrono::DateTime::parse_from_rfc3339(&entry.next_retry_at)
            .map(|v| v.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        if next_retry > now {
            continue;
        }

        let Some(envelope) = parse_json_value::<StoredEnvelope>(entry.payload.clone()) else {
            let _ = store.remove_email_graph_outbox(&entry.id);
            continue;
        };

        let email_node_id = format!("email:{}", envelope.message_key);
        let sender_email = envelope.sender_email.trim().to_lowercase();
        let sender_node_id = if sender_email.is_empty() {
            None
        } else {
            Some(format!(
                "person:{}",
                Uuid::new_v5(&Uuid::NAMESPACE_OID, sender_email.as_bytes())
            ))
        };
        let sender_domain = extract_domain(&sender_email).map(|domain| {
            (
                domain.clone(),
                format!(
                    "domain:{}",
                    Uuid::new_v5(&Uuid::NAMESPACE_OID, domain.as_bytes())
                ),
            )
        });
        let recipient_emails = recipients_for_graph(&envelope.to);

        let mut nodes = Vec::<GraphNode>::new();
        let mut edges = Vec::<GraphEdge>::new();

        nodes.push(GraphNode {
            id: email_node_id.clone(),
            node_type: "Email".to_string(),
            workspace_id: envelope.workspace_id.clone(),
            payload: serde_json::json!({
                "accountId": envelope.account_id,
                "folder": envelope.folder,
                "uid": envelope.uid,
                "subject": envelope.subject,
                "sender": envelope.sender,
                "senderEmail": envelope.sender_email,
                "date": envelope.date,
                "messageId": envelope.message_id,
                "threadId": envelope.thread_id,
            }),
        });

        let thread_node_id = format!(
            "thread:{}",
            Uuid::new_v5(&Uuid::NAMESPACE_OID, envelope.thread_id.as_bytes())
        );
        nodes.push(GraphNode {
            id: thread_node_id.clone(),
            node_type: "Thread".to_string(),
            workspace_id: envelope.workspace_id.clone(),
            payload: serde_json::json!({
                "threadId": envelope.thread_id,
                "subject": envelope.subject,
            }),
        });
        edges.push(GraphEdge {
            id: format!("edge:part_of:{}", envelope.message_key),
            edge_type: "PART_OF".to_string(),
            workspace_id: envelope.workspace_id.clone(),
            from_id: email_node_id.clone(),
            to_id: thread_node_id,
            payload: serde_json::json!({}),
        });

        if let Some(sender_node_id) = sender_node_id.clone() {
            nodes.push(GraphNode {
                id: sender_node_id.clone(),
                node_type: "Person".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                payload: serde_json::json!({
                    "email": sender_email,
                    "name": envelope.sender,
                }),
            });
            edges.push(GraphEdge {
                id: format!("edge:sent_by:{}", envelope.message_key),
                edge_type: "SENT_BY".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                from_id: email_node_id.clone(),
                to_id: sender_node_id.clone(),
                payload: serde_json::json!({}),
            });
            if let Some((domain, domain_node_id)) = sender_domain.clone() {
                nodes.push(GraphNode {
                    id: domain_node_id.clone(),
                    node_type: "Domain".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    payload: serde_json::json!({ "domain": domain }),
                });
                edges.push(GraphEdge {
                    id: format!("edge:works_at:{}", sender_node_id),
                    edge_type: "WORKS_AT".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    from_id: sender_node_id,
                    to_id: domain_node_id,
                    payload: serde_json::json!({}),
                });
            }
        }

        for recipient in recipient_emails {
            let recipient_node_id = format!(
                "person:{}",
                Uuid::new_v5(&Uuid::NAMESPACE_OID, recipient.as_bytes())
            );
            nodes.push(GraphNode {
                id: recipient_node_id.clone(),
                node_type: "Person".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                payload: serde_json::json!({ "email": recipient }),
            });
            edges.push(GraphEdge {
                id: format!(
                    "edge:sent_to:{}:{}",
                    envelope.message_key, recipient_node_id
                ),
                edge_type: "SENT_TO".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                from_id: email_node_id.clone(),
                to_id: recipient_node_id.clone(),
                payload: serde_json::json!({}),
            });
            if let Some(domain) = extract_domain(&recipient) {
                let domain_node_id = format!(
                    "domain:{}",
                    Uuid::new_v5(&Uuid::NAMESPACE_OID, domain.as_bytes())
                );
                nodes.push(GraphNode {
                    id: domain_node_id.clone(),
                    node_type: "Domain".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    payload: serde_json::json!({ "domain": domain }),
                });
                edges.push(GraphEdge {
                    id: format!("edge:works_at:{}:{}", recipient_node_id, domain_node_id),
                    edge_type: "WORKS_AT".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    from_id: recipient_node_id,
                    to_id: domain_node_id,
                    payload: serde_json::json!({}),
                });
            }
        }

        if let Some(body_cache) =
            get_body_cache_from_store(&store, &envelope.account_id, &envelope.folder, envelope.uid)
        {
            for index in 0..body_cache.attachment_count {
                let attachment_node_id = format!("attachment:{}:{}", envelope.message_key, index);
                nodes.push(GraphNode {
                    id: attachment_node_id.clone(),
                    node_type: "AttachmentMetadata".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    payload: serde_json::json!({
                        "messageKey": envelope.message_key,
                        "index": index,
                    }),
                });
                edges.push(GraphEdge {
                    id: format!("edge:has_attachment:{}:{}", envelope.message_key, index),
                    edge_type: "HAS_ATTACHMENT".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    from_id: email_node_id.clone(),
                    to_id: attachment_node_id,
                    payload: serde_json::json!({}),
                });
            }
        }

        if let Some(in_reply_to) = envelope.in_reply_to.as_deref().filter(|v| !v.is_empty()) {
            let parent_id = format!(
                "email:reply:{}",
                Uuid::new_v5(&Uuid::NAMESPACE_OID, in_reply_to.as_bytes())
            );
            edges.push(GraphEdge {
                id: format!("edge:in_reply_to:{}", envelope.message_key),
                edge_type: "IN_REPLY_TO".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                from_id: email_node_id,
                to_id: parent_id,
                payload: serde_json::json!({ "inReplyTo": in_reply_to }),
            });
        }

        let request = crate::graph_helix::GraphUpsertRequest {
            workspace_id: envelope.workspace_id.clone(),
            nodes,
            edges,
        };

        match graph.upsert_nodes_edges(&store, request).await {
            Ok(()) => {
                let _ = store.remove_email_graph_outbox(&entry.id);
            }
            Err(error) => {
                entry.retry_count = entry.retry_count.saturating_add(1);
                let jitter = fastrand::u32(..3000) as i64;
                let delay_secs = (2_i64.pow(entry.retry_count.min(6))) + jitter / 1000;
                entry.next_retry_at =
                    (chrono::Utc::now() + chrono::Duration::seconds(delay_secs)).to_rfc3339();
                entry.last_error = Some(error.to_string());
                entry.updated_at = now_iso();
                let _ = store.put_email_graph_outbox(
                    &entry.id,
                    &serde_json::to_value(&entry).map_err(|e| e.to_string())?,
                );
            }
        }
    }

    Ok(())
}

pub(super) fn schedule_graph_outbox_flush(state: &AppState, account_filter: Option<String>) {
    if !state.graph.is_enabled() {
        return;
    }
    if GRAPH_FLUSH_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let store = state.store.clone();
    let graph = state.graph.clone();
    tauri::async_runtime::spawn(async move {
        let _ = flush_graph_outbox(store, graph, account_filter).await;
        GRAPH_FLUSH_RUNNING.store(false, Ordering::SeqCst);
    });
}
