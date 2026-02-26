use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::thread;

pub struct EmbeddingEngine {
    model_path: Option<PathBuf>,
}

impl EmbeddingEngine {
    pub fn new(model_path: Option<PathBuf>) -> anyhow::Result<Self> {
        Ok(Self { model_path })
    }

    pub fn embed_text(&self, _text: &str) -> Vec<f32> {
        // Return 384 dimensional vector
        vec![0.1; 384]
    }
}

#[derive(Clone, Debug)]
pub enum IndexJob {
    Note {
        workspace_id: String,
        note_id: String,
    },
    Task {
        workspace_id: String,
        task_id: String,
    },
    Email {
        workspace_id: String,
        email_account_id: String,
        email_id: String,
    },
}

pub struct BackgroundIndexer {
    tx: Sender<IndexJob>,
}

impl BackgroundIndexer {
    pub fn new(
        store: std::sync::Arc<crate::store_redb::RedbStore>,
        graph: std::sync::Arc<crate::graph_helix::GraphManager>,
        embeddings: std::sync::Arc<EmbeddingEngine>,
    ) -> Self {
        let (tx, rx) = channel::<IndexJob>();

        thread::spawn(move || {
            let mut pending = std::collections::HashMap::new();
            loop {
                match rx.recv_timeout(std::time::Duration::from_secs(2)) {
                    Ok(job) => {
                        let key = match &job {
                            IndexJob::Note {
                                workspace_id,
                                note_id,
                            } => format!("note:{}:{}", workspace_id, note_id),
                            IndexJob::Task {
                                workspace_id,
                                task_id,
                            } => format!("task:{}:{}", workspace_id, task_id),
                            IndexJob::Email {
                                workspace_id,
                                email_id,
                                ..
                            } => format!("email:{}:{}", workspace_id, email_id),
                        };
                        pending.insert(key, job);
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if !pending.is_empty() {
                            let jobs: Vec<_> = pending.drain().map(|(_, v)| v).collect();
                            for job in jobs {
                                let _ = Self::process_job(&job, &store, &graph, &embeddings);
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Self { tx }
    }

    pub fn queue(&self, job: IndexJob) {
        let _ = self.tx.send(job);
    }

    fn process_job(
        job: &IndexJob,
        store: &std::sync::Arc<crate::store_redb::RedbStore>,
        graph: &std::sync::Arc<crate::graph_helix::GraphManager>,
        embeddings: &std::sync::Arc<EmbeddingEngine>,
    ) -> anyhow::Result<()> {
        let text = match job {
            IndexJob::Note { note_id, .. } => format!("Extracted text for note {}", note_id),
            IndexJob::Task { task_id, .. } => format!("Extracted text for task {}", task_id),
            IndexJob::Email { email_id, .. } => format!("Extracted text for email {}", email_id),
        };

        let _vec = embeddings.embed_text(&text);

        // Construct basic HelixDB request here... Auto-linking heuristics match existing nodes
        let req = crate::graph_helix::GraphUpsertRequest {
            workspace_id: match job {
                IndexJob::Note { workspace_id, .. } => workspace_id,
                IndexJob::Task { workspace_id, .. } => workspace_id,
                IndexJob::Email { workspace_id, .. } => workspace_id,
            }
            .to_string(),
            nodes: vec![],
            edges: vec![],
        };

        // Example sync block to invoke async Helix API
        let graph_clone = graph.clone();
        let store_clone = store.clone();
        tokio::task::spawn(async move {
            let _ = graph_clone.upsert_nodes_edges(&store_clone, req).await;
        });

        Ok(())
    }
}
