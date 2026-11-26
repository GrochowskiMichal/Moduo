//! A small blocking Supabase client: GoTrue (email code sign-in, refresh),
//! PostgREST reads and the `*_op_*` RPCs the web app uses for every Tasks
//! write. It speaks as the signed-in person, under their own RLS; there is no
//! service-role path here. Calls block, so run them on the background executor.

use std::sync::{Arc, Mutex};

use anyhow::{anyhow, bail, Result};
use jiff::Timestamp;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::Config;

const KEYCHAIN_SERVICE: &str = "moduo-gpui-spike";
/// PostgREST caps a response at 1000 rows; the web app pages by key the same way.
const PAGE: usize = 1000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    pub user_id: String,
    pub email: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: TokenUser,
}

#[derive(Deserialize)]
struct TokenUser {
    id: String,
    #[serde(default)]
    email: Option<String>,
}

impl From<TokenResponse> for Session {
    fn from(t: TokenResponse) -> Self {
        Session {
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            expires_at: Timestamp::now().as_second() + t.expires_in,
            user_id: t.user.id,
            email: t.user.email.unwrap_or_default(),
        }
    }
}

#[derive(Clone)]
pub struct Api {
    pub config: Config,
    session: Arc<Mutex<Option<Session>>>,
}

impl Api {
    pub fn new(config: Config) -> Self {
        Self { config, session: Arc::new(Mutex::new(None)) }
    }

    pub fn session(&self) -> Option<Session> {
        self.session.lock().unwrap().clone()
    }

    // ── Auth ────────────────────────────────────────────────────────────────

    /// The Keychain entry is per backend, so a local-stack session never
    /// gets replayed against the cloud project.
    fn keychain(&self) -> Option<keyring::Entry> {
        keyring::Entry::new(KEYCHAIN_SERVICE, &self.config.url).ok()
    }

    fn store(&self, session: Option<Session>) {
        if let Some(entry) = self.keychain() {
            match &session {
                Some(s) => {
                    if let Ok(raw) = serde_json::to_string(s) {
                        let _ = entry.set_password(&raw);
                    }
                }
                None => {
                    let _ = entry.delete_credential();
                }
            }
        }
        *self.session.lock().unwrap() = session;
    }

    /// Adopt a session handed in from outside (the smoke test's token).
    pub fn adopt(&self, session: Session) {
        *self.session.lock().unwrap() = Some(session);
    }

    /// Pick up the saved session, refreshing it when it is close to expiry.
    pub fn restore(&self) -> Result<Session> {
        // Local stack only: a token from the environment skips the email code,
        // so the window can be driven in tests. Never honoured for the cloud.
        if self.config.is_local() {
            if let Ok(token) = std::env::var("MODUO_SPIKE_ACCESS_TOKEN") {
                let session = Session {
                    access_token: token,
                    refresh_token: String::new(),
                    expires_at: i64::MAX / 2,
                    user_id: String::new(),
                    email: "local test session".into(),
                };
                self.adopt(session.clone());
                return Ok(session);
            }
        }
        let raw = self
            .keychain()
            .ok_or_else(|| anyhow!("no keychain"))?
            .get_password()
            .map_err(|_| anyhow!("no saved session"))?;
        let saved: Session = serde_json::from_str(&raw)?;
        *self.session.lock().unwrap() = Some(saved);
        self.fresh_token()?;
        self.session().ok_or_else(|| anyhow!("no session"))
    }

    pub fn send_code(&self, email: &str) -> Result<()> {
        // create_user stays false: the spike signs existing people in, it never
        // creates accounts.
        self.auth_post("otp", json!({ "email": email, "create_user": false })).map(|_| ())
    }

    pub fn verify_code(&self, email: &str, code: &str) -> Result<Session> {
        let body = self.auth_post("verify", json!({ "type": "email", "email": email, "token": code }))?;
        let session: Session = serde_json::from_value::<TokenResponse>(body)?.into();
        self.store(Some(session.clone()));
        Ok(session)
    }

    pub fn sign_out(&self) {
        self.store(None);
    }

    fn auth_post(&self, path: &str, body: Value) -> Result<Value> {
        let url = format!("{}/auth/v1/{path}", self.config.url);
        let res = ureq::post(&url)
            .set("apikey", &self.config.publishable_key)
            .set("Content-Type", "application/json")
            .send_json(body);
        read(res)
    }

    /// A token good for at least the next minute.
    fn fresh_token(&self) -> Result<String> {
        let current = self.session().ok_or_else(|| anyhow!("signed out"))?;
        if current.expires_at - Timestamp::now().as_second() > 60 {
            return Ok(current.access_token);
        }
        let body = self.auth_post(
            "token?grant_type=refresh_token",
            json!({ "refresh_token": current.refresh_token }),
        );
        match body {
            Ok(body) => {
                let session: Session = serde_json::from_value::<TokenResponse>(body)?.into();
                let token = session.access_token.clone();
                self.store(Some(session));
                Ok(token)
            }
            Err(err) => {
                // A refused refresh token is dead for good: forget it.
                if err.to_string().contains("HTTP 4") {
                    self.store(None);
                }
                Err(err)
            }
        }
    }

    // ── PostgREST ───────────────────────────────────────────────────────────

    pub fn select<T: DeserializeOwned>(&self, table: &str, query: &[(&str, String)]) -> Result<Vec<T>> {
        let token = self.fresh_token()?;
        let url = format!("{}/rest/v1/{table}", self.config.url);
        let mut req = ureq::get(&url)
            .set("apikey", &self.config.publishable_key)
            .set("Authorization", &format!("Bearer {token}"));
        for (k, v) in query {
            req = req.query(k, v);
        }
        Ok(serde_json::from_value(read(req.call())?)?)
    }

    /// Every row of a workspace table, paged by `id` like the web app's first load.
    pub fn select_all<T: DeserializeOwned + HasId>(
        &self,
        table: &str,
        workspace_id: &str,
        extra: &[(&str, String)],
    ) -> Result<Vec<T>> {
        let mut out: Vec<T> = Vec::new();
        loop {
            let mut query: Vec<(&str, String)> = vec![
                ("select", "*".into()),
                ("workspace_id", format!("eq.{workspace_id}")),
                ("order", "id".into()),
                ("limit", PAGE.to_string()),
            ];
            query.extend(extra.iter().cloned());
            if let Some(last) = out.last() {
                query.push(("id", format!("gt.{}", last.id())));
            }
            let page: Vec<T> = self.select(table, &query)?;
            let done = page.len() < PAGE;
            out.extend(page);
            if done {
                return Ok(out);
            }
        }
    }

    pub fn rpc<T: DeserializeOwned>(&self, function: &str, args: Value) -> Result<T> {
        let token = self.fresh_token()?;
        let url = format!("{}/rest/v1/rpc/{function}", self.config.url);
        let res = ureq::post(&url)
            .set("apikey", &self.config.publishable_key)
            .set("Authorization", &format!("Bearer {token}"))
            .set("Content-Type", "application/json")
            .send_json(args);
        Ok(serde_json::from_value(read(res)?)?)
    }
}

pub trait HasId {
    fn id(&self) -> &str;
}

/// Turn a ureq result into JSON, with the server's own message on failure.
fn read(res: std::result::Result<ureq::Response, ureq::Error>) -> Result<Value> {
    match res {
        Ok(res) => {
            let text = res.into_string()?;
            if text.trim().is_empty() {
                return Ok(Value::Null);
            }
            Ok(serde_json::from_str(&text)?)
        }
        Err(ureq::Error::Status(code, res)) => {
            let text = res.into_string().unwrap_or_default();
            let detail = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| {
                    ["message", "msg", "error_description", "error"]
                        .iter()
                        .find_map(|k| v.get(k).and_then(|m| m.as_str()).map(str::to_string))
                })
                .unwrap_or(text);
            bail!("HTTP {code}: {detail}")
        }
        Err(err) => bail!("network: {err}"),
    }
}
