use std::{path::PathBuf, process::{Child, Command}, sync::Mutex};

use helix_rs::{HelixDB, HelixDBClient};
use serde::{Deserialize, Serialize};

use crate::domain::{GraphEdge, GraphHybridQuery, GraphHybridResult, GraphNode};
use crate::store_redb::RedbStore;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphUpsertRequest {
    pub workspace_id: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Serialize)]
pub struct HqlQuery {
    pub query: String,
}

pub struct GraphManager {
    sidecar: Mutex<Option<Child>>,
    sidecar_path: Option<PathBuf>,
    data_dir: Option<PathBuf>,
}

impl GraphManager {
    pub fn new(sidecar_path: Option<PathBuf>, data_dir: Option<PathBuf>) -> Self {
        Self {
            sidecar: Mutex::new(None),
            sidecar_path,
            data_dir,
        }
    }

    pub fn ensure_sidecar_started(&self) -> anyhow::Result<()> {
        let Some(path) = &self.sidecar_path else {
            return Ok(());
        };

        let mut guard = self.sidecar.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        if guard.is_some() {
            return Ok(());
        }

        if !path.exists() {
            return Ok(());
        }

        let mut cmd = Command::new(path);
        cmd.arg("--mode").arg("local");
        cmd.arg("--port").arg("8000");

        if let Some(data_dir) = &self.data_dir {
            cmd.arg("--data-dir").arg(data_dir.join("helixdb"));
            cmd.arg("--schema").arg("schema.hx");
        }
        
        let child = cmd.spawn()?;
        *guard = Some(child);
        Ok(())
    }

    fn client(&self) -> HelixDB {
        HelixDB::new(Some("http://localhost"), Some(8000), None)
    }

    pub async fn upsert_nodes_edges(&self, _store: &RedbStore, request: GraphUpsertRequest) -> anyhow::Result<()> {
        self.ensure_sidecar_started()?;
        let client = self.client();
        let _res: serde_json::Value = client.query("upsert", &request).await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        Ok(())
    }

    pub async fn query_related(
        &self,
        _store: &RedbStore,
        _workspace_id: &str,
        node_id: &str,
        limit: usize,
    ) -> anyhow::Result<serde_json::Value> {
        self.ensure_sidecar_started()?;

        let query = HqlQuery {
            query: format!("MATCH (n)-[e]->(m) WHERE n.id = '{}' RETURN n, e, m LIMIT {}", node_id, limit),
        };

        let client = self.client();
        let res: serde_json::Value = client.query("query", &query).await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        Ok(res)
    }

    pub async fn query_hybrid(
        &self,
        _store: &RedbStore,
        query: GraphHybridQuery,
    ) -> anyhow::Result<Vec<GraphHybridResult>> {
        self.ensure_sidecar_started()?;

        let client = self.client();
        let type_filter = if query.node_types.is_empty() {
            "".to_string()
        } else {
            let types = query.node_types.iter()
                .map(|t| format!("'{}'", t))
                .collect::<Vec<_>>()
                .join(", ");
            format!("AND type IN [{}]", types)
        };

        let hql = HqlQuery {
            query: format!("HYBRID SEARCH '{}' {} LIMIT {}", query.query, type_filter, query.limit),
        };

        let res: serde_json::Value = client.query("query", &hql).await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;

        let mut results = Vec::new();
        if let Some(arr) = res.as_array() {
            for item in arr {
                results.push(GraphHybridResult {
                    node_id: item["id"].as_str().unwrap_or_default().to_string(),
                    score: item["score"].as_f64().unwrap_or(0.0) as f32,
                    payload: item.clone(),
                });
            }
        }

        Ok(results)
    }

    pub async fn get_full_graph(&self, workspace_id: &str) -> anyhow::Result<serde_json::Value> {
        self.ensure_sidecar_started()?;
        let query = HqlQuery {
            query: format!("MATCH (n)-[e]->(m) WHERE n.workspace_id = '{}' RETURN n, e, m", workspace_id),
        };
        let client = self.client();
        let res: serde_json::Value = client.query("query", &query).await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        Ok(res)
    }
}
