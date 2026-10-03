use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::sidecar::protocol::{parse, Failure, Inbound};

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, Failure>>>>>;

pub type EventSink = Arc<dyn Fn(&str, &str, Value) + Send + Sync>;

pub struct Sidecar {
    name: String,
    stdin: Mutex<ChildStdin>,
    pending: Pending,
    next_id: AtomicU64,
    child: Mutex<Child>,
}

impl Sidecar {
    pub async fn spawn(
        name: &str,
        program: &str,
        args: &[&str],
        cwd: &Path,
        events: EventSink,
    ) -> Result<Arc<Self>, String> {
        let mut child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|cause| format!("could not start {name}: {cause}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("{name} has no stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{name} has no stdout"))?;

        let sidecar = Arc::new(Self {
            name: name.to_string(),
            stdin: Mutex::new(stdin),
            pending: Pending::default(),
            next_id: AtomicU64::new(1),
            child: Mutex::new(child),
        });

        let pending = Arc::clone(&sidecar.pending);
        let label = name.to_string();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match parse(&line) {
                    Inbound::Response { id, result } => {
                        if let Some(waiter) = pending.lock().await.remove(&id) {
                            let _ = waiter.send(result);
                        }
                    }
                    Inbound::Event { name, data } => events(&label, &name, data),
                    Inbound::Malformed { reason } => {
                        events(&label, "sidecar.malformed", json!({ "reason": reason }))
                    }
                }
            }
            for (_, waiter) in pending.lock().await.drain() {
                let _ = waiter.send(Err(Failure {
                    code: "sidecar_closed".into(),
                    message: format!("{label} exited"),
                }));
            }
            events(&label, "sidecar.exited", Value::Null);
        });

        Ok(sidecar)
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, Failure> {
        let id = format!(
            "{}-{}",
            self.name,
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);

        let line = format!(
            "{}\n",
            json!({ "id": &id, "method": method, "params": params })
        );
        if let Err(cause) = self.stdin.lock().await.write_all(line.as_bytes()).await {
            self.pending.lock().await.remove(&id);
            return Err(Failure {
                code: "write_failed".into(),
                message: cause.to_string(),
            });
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(Failure {
                code: "sidecar_closed".into(),
                message: format!("{} dropped the request", self.name),
            }),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(Failure {
                    code: "timeout".into(),
                    message: format!("{} did not answer {method} in time", self.name),
                })
            }
        }
    }

    pub async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
    }
}
