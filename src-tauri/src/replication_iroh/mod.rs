use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerStatus {
    pub peer_id: String,
    pub connected: bool,
    pub last_seen_at: Option<String>,
    pub last_sync_seq: i64,
}

#[derive(Clone, Debug, Default)]
struct P2pState {
    started: bool,
    peers: Vec<PeerStatus>,
}

pub struct P2pManager {
    state: Mutex<P2pState>,
}

impl P2pManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(P2pState::default()),
        }
    }

    pub fn start(&self) -> anyhow::Result<()> {
        let mut state = self.state.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        state.started = true;
        if state.peers.is_empty() {
            state.peers.push(PeerStatus {
                peer_id: "lan-discovery".to_string(),
                connected: true,
                last_seen_at: Some(chrono::Utc::now().to_rfc3339()),
                last_sync_seq: 0,
            });
        }
        Ok(())
    }

    pub fn status(&self) -> anyhow::Result<(bool, Vec<PeerStatus>)> {
        let state = self.state.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        Ok((state.started, state.peers.clone()))
    }

    pub fn sync_now(&self, workspace_id: &str) -> anyhow::Result<serde_json::Value> {
        let mut state = self.state.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        for peer in &mut state.peers {
            peer.last_seen_at = Some(chrono::Utc::now().to_rfc3339());
            peer.last_sync_seq += 1;
        }
        Ok(serde_json::json!({
            "workspaceId": workspace_id,
            "syncedPeers": state.peers.len(),
            "syncedAt": chrono::Utc::now().to_rfc3339(),
        }))
    }
}
