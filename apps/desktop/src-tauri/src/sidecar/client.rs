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
type Answer = oneshot::Receiver<Result<Value, Failure>>;

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
        let (id, answer) = self.sent(method, params).await?;
        match tokio::time::timeout(timeout, answer).await {
            Ok(arrived) => self.received(arrived),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(Failure {
                    code: "timeout".into(),
                    message: format!("{} did not answer {method} in time", self.name),
                })
            }
        }
    }

    /// A request answered when its work is done, however long that takes: a turn ends when the
    /// sidecar answers it, which a stopped turn is too, or when the sidecar exits.
    pub async fn request_untimed(&self, method: &str, params: Value) -> Result<Value, Failure> {
        let (_, answer) = self.sent(method, params).await?;
        self.received(answer.await)
    }

    async fn sent(&self, method: &str, params: Value) -> Result<(String, Answer), Failure> {
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
        Ok((id, rx))
    }

    fn received(&self, arrived: Result<Result<Value, Failure>, oneshot::error::RecvError>) -> Result<Value, Failure> {
        arrived.unwrap_or_else(|_| {
            Err(Failure {
                code: "sidecar_closed".into(),
                message: format!("{} dropped the request", self.name),
            })
        })
    }

    pub async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime")
    }

    /// A sidecar written in shell that answers every request a second after it is asked.
    const SLOW: &str = r#"while read line; do
  id=$(printf '%s' "$line" | sed 's/.*"id":"\([^"]*\)".*/\1/')
  sleep 1
  printf '{"id":"%s","ok":true,"result":"late"}\n' "$id"
done"#;

    async fn scripted(script: &str) -> Arc<Sidecar> {
        Sidecar::spawn("scripted", "/bin/sh", &["-c", script], &std::env::temp_dir(), Arc::new(|_, _, _| {}))
            .await
            .expect("the scripted sidecar starts")
    }

    #[test]
    fn a_turn_is_waited_for_until_it_is_answered_where_a_timed_request_gives_up() {
        runtime().block_on(async {
            let sidecar = scripted(SLOW).await;
            let timed = sidecar.request("agent.run", json!({}), Duration::from_millis(300)).await;
            assert_eq!(timed.expect_err("gave up").code, "timeout");
            let untimed = sidecar.request_untimed("agent.run", json!({})).await;
            assert_eq!(untimed.expect("answered"), json!("late"));
        });
    }

    #[test]
    fn a_turn_whose_sidecar_exits_is_failed_at_once_rather_than_waited_for() {
        runtime().block_on(async {
            let sidecar = scripted("read line; exit 0").await;
            let failed = tokio::time::timeout(Duration::from_secs(5), sidecar.request_untimed("agent.run", json!({})))
                .await
                .expect("not left waiting");
            assert_eq!(failed.expect_err("the sidecar left").code, "sidecar_closed");
        });
    }
}
