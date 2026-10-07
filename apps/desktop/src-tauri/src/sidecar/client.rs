use std::collections::HashMap;
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};

use crate::sidecar::protocol::{parse, Failure, Inbound};

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, Failure>>>>>;
type Answer = oneshot::Receiver<Result<Value, Failure>>;

pub type EventSink = Arc<dyn Fn(&str, &str, Value) + Send + Sync>;

/// A process that exits is started again after a pause that doubles while it keeps dying young,
/// so one that cannot run costs a try a minute rather than a loop of them.
const FIRST_PAUSE: Duration = Duration::from_secs(1);
const LONGEST_PAUSE: Duration = Duration::from_secs(60);
const STEADY: Duration = Duration::from_secs(60);
const LINE_KEPT: usize = 2_000;
const LINE_READ: u64 = 16 * 1024;

pub struct Sidecar {
    name: String,
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    events: EventSink,
    /// Empty while the process is down, so a request is refused at once rather than written into
    /// a pipe nobody reads.
    stdin: Mutex<Option<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
    child: Mutex<Option<Child>>,
    stopping: AtomicBool,
}

impl Sidecar {
    pub async fn spawn(
        name: &str,
        program: &str,
        args: &[&str],
        cwd: &Path,
        events: EventSink,
    ) -> Result<Arc<Self>, String> {
        let sidecar = Arc::new(Self {
            name: name.to_string(),
            program: program.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            cwd: cwd.to_path_buf(),
            events,
            stdin: Mutex::new(None),
            pending: Pending::default(),
            next_id: AtomicU64::new(1),
            child: Mutex::new(None),
            stopping: AtomicBool::new(false),
        });
        let streams = sidecar.launch().await?;
        tauri::async_runtime::spawn(supervise(Arc::downgrade(&sidecar), streams));
        Ok(sidecar)
    }

    /// Under the child's lock, so a shutdown either comes first and nothing is started, or comes
    /// after and finds the process to stop.
    async fn launch(&self) -> Result<(ChildStdout, ChildStderr), String> {
        let mut held = self.child.lock().await;
        if self.stopping.load(Ordering::Relaxed) {
            return Err(format!("{} is shutting down", self.name));
        }
        let mut child = Command::new(&self.program)
            .args(&self.args)
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|cause| format!("could not start {}: {cause}", self.name))?;

        let stdin = child.stdin.take().ok_or_else(|| format!("{} has no stdin", self.name))?;
        let stdout = child.stdout.take().ok_or_else(|| format!("{} has no stdout", self.name))?;
        let stderr = child.stderr.take().ok_or_else(|| format!("{} has no stderr", self.name))?;
        *self.stdin.lock().await = Some(stdin);
        *held = Some(child);
        Ok((stdout, stderr))
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
        let line = format!(
            "{}\n",
            json!({ "id": &id, "method": method, "params": params })
        );
        // Waited for only while the way in is held, so a request is never waited for by one process
        // and written to the next.
        let mut stdin = self.stdin.lock().await;
        let Some(pipe) = stdin.as_mut() else {
            return Err(self.down());
        };
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), tx);
        if pipe.write_all(line.as_bytes()).await.is_err() {
            self.pending.lock().await.remove(&id);
            return Err(self.down());
        }
        Ok((id, rx))
    }

    fn down(&self) -> Failure {
        Failure {
            code: "sidecar_down".into(),
            message: format!("Kyuren's {} process has stopped and is being started again; try again in a moment", self.name),
        }
    }

    fn received(&self, arrived: Result<Result<Value, Failure>, oneshot::error::RecvError>) -> Result<Value, Failure> {
        arrived.unwrap_or_else(|_| {
            Err(Failure {
                code: "sidecar_closed".into(),
                message: format!("{} dropped the request", self.name),
            })
        })
    }

    /// Called once its output has ended. The process is gone first, since a writer blocked on a full
    /// pipe holds the way in until it is; then the way in is closed before the open requests are
    /// failed, so a request either reaches the drain or is refused, and none is left waiting.
    async fn ended(&self) -> Value {
        let status = self.reaped().await;
        *self.stdin.lock().await = None;
        for (_, waiter) in self.pending.lock().await.drain() {
            let _ = waiter.send(Err(Failure {
                code: "sidecar_closed".into(),
                message: format!("Kyuren's {} process stopped before it answered", self.name),
            }));
        }
        status
    }

    async fn reaped(&self) -> Value {
        let Some(mut child) = self.child.lock().await.take() else {
            return Value::Null;
        };
        // Output can end before the process does; it must be gone before another is started.
        let status = match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
            Ok(status) => status,
            Err(_) => {
                let _ = child.kill().await;
                child.wait().await
            }
        };
        match status {
            Ok(status) => json!({ "code": status.code(), "signal": status.signal() }),
            Err(failure) => json!({ "unknown": failure.to_string() }),
        }
    }

    pub async fn shutdown(&self) {
        let mut held = self.child.lock().await;
        self.stopping.store(true, Ordering::Relaxed);
        if let Some(child) = held.as_mut() {
            let _ = child.kill().await;
        }
    }
}

/// Reads what the process says until it exits, then starts it again, for as long as anything
/// still holds the sidecar and it has not been shut down.
async fn supervise(sidecar: Weak<Sidecar>, mut streams: (ChildStdout, ChildStderr)) {
    let mut pause = Duration::ZERO;
    loop {
        let began = Instant::now();
        let Some((name, pending, events)) = sidecar
            .upgrade()
            .map(|held| (held.name.clone(), Arc::clone(&held.pending), Arc::clone(&held.events)))
        else {
            return;
        };
        let (stdout, stderr) = streams;
        let relayed = tauri::async_runtime::spawn(relay(name.clone(), stderr, Arc::clone(&events)));
        answer(&name, stdout, &pending, &events).await;

        let Some(held) = sidecar.upgrade() else { return };
        let status = held.ended().await;
        // The last words before an exit belong before the exit in the log.
        let _ = tokio::time::timeout(Duration::from_secs(1), relayed).await;
        events(&name, "sidecar.exited", status);
        if held.stopping.load(Ordering::Relaxed) {
            return;
        }
        drop(held);

        pause = if pause.is_zero() || began.elapsed() >= STEADY { FIRST_PAUSE } else { (pause * 2).min(LONGEST_PAUSE) };
        streams = loop {
            tokio::time::sleep(pause).await;
            let Some(held) = sidecar.upgrade() else { return };
            if held.stopping.load(Ordering::Relaxed) {
                return;
            }
            match held.launch().await {
                Ok(streams) => {
                    events(&name, "sidecar.restarted", Value::Null);
                    break streams;
                }
                Err(_) if held.stopping.load(Ordering::Relaxed) => return,
                Err(reason) => {
                    events(&name, "sidecar.restart_failed", json!({ "reason": reason }));
                    pause = (pause * 2).min(LONGEST_PAUSE);
                }
            }
        };
    }
}

async fn answer(name: &str, stdout: ChildStdout, pending: &Pending, events: &EventSink) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        match parse(&line) {
            Inbound::Response { id, result } => {
                if let Some(waiter) = pending.lock().await.remove(&id) {
                    let _ = waiter.send(result);
                }
            }
            Inbound::Event { name: event, data } => events(name, &event, data),
            Inbound::Malformed { reason } => events(name, "sidecar.malformed", json!({ "reason": reason })),
        }
    }
}

/// What the process writes to stderr, a line at a time, which is where a crash says why. Read to
/// its end whatever it holds, since a pipe left full would stall the process writing to it.
async fn relay(name: String, stderr: ChildStderr, events: EventSink) {
    let mut reader = BufReader::new(stderr);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        // Bounded, so output that never ends a line is passed on in pieces rather than held whole.
        match (&mut reader).take(LINE_READ).read_until(b'\n', &mut bytes).await {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                let line: String = String::from_utf8_lossy(&bytes).trim_end().chars().take(LINE_KEPT).collect();
                if !line.is_empty() {
                    events(&name, "sidecar.stderr", json!({ "line": line }));
                }
            }
        }
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

    /// Every event a sidecar sends, handed on as it comes.
    fn heard() -> (EventSink, tokio::sync::mpsc::UnboundedReceiver<(String, Value)>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (Arc::new(move |_, name, data| { let _ = tx.send((name.to_string(), data)); }), rx)
    }

    /// The events up to and including the first called `name`.
    async fn until(rx: &mut tokio::sync::mpsc::UnboundedReceiver<(String, Value)>, name: &str) -> Vec<(String, Value)> {
        let mut seen = Vec::new();
        loop {
            let next = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("the event came").expect("the sink is open");
            let last = next.0 == name;
            seen.push(next);
            if last {
                return seen;
            }
        }
    }

    /// Answers one request with the id of the process that answered, then exits.
    const ONCE: &str = r#"read line
id=$(printf '%s' "$line" | sed 's/.*"id":"\([^"]*\)".*/\1/')
printf '{"id":"%s","ok":true,"result":"%s"}\n' "$id" "$$"
exit 0"#;

    #[test]
    fn a_sidecar_that_exits_is_refused_to_at_once_then_started_again() {
        runtime().block_on(async {
            let (sink, mut rx) = heard();
            let sidecar = Sidecar::spawn("core", "/bin/sh", &["-c", ONCE], &std::env::temp_dir(), sink).await.expect("it starts");
            let first = sidecar.request("ping", json!({}), Duration::from_secs(5)).await.expect("the first answers");

            let exited = until(&mut rx, "sidecar.exited").await;
            assert_eq!(exited.last().map(|(_, data)| data["code"].clone()), Some(json!(0)));
            let refused = sidecar.request("ping", json!({}), Duration::from_secs(5)).await.expect_err("nobody is there");
            assert_eq!(refused.code, "sidecar_down");
            assert!(refused.message.contains("started again"), "said plainly, not as a broken pipe: {}", refused.message);

            until(&mut rx, "sidecar.restarted").await;
            let second = sidecar.request("ping", json!({}), Duration::from_secs(5)).await.expect("the next one answers");
            assert_ne!(first, second, "answered by a process of its own");
            sidecar.shutdown().await;
        });
    }

    #[test]
    fn what_a_sidecar_says_as_it_dies_is_passed_on_before_its_exit() {
        runtime().block_on(async {
            let (sink, mut rx) = heard();
            let sidecar = Sidecar::spawn("core", "/bin/sh", &["-c", "echo 'TypeError: boom' >&2; exit 3"], &std::env::temp_dir(), sink).await.expect("it starts");
            let seen = until(&mut rx, "sidecar.exited").await;
            sidecar.shutdown().await;
            let said = seen.iter().position(|(name, data)| name == "sidecar.stderr" && data["line"] == "TypeError: boom");
            assert!(said.is_some(), "its last words are kept: {seen:?}");
            assert_eq!(seen.last().map(|(_, data)| data["code"].clone()), Some(json!(3)));
        });
    }

    #[test]
    fn a_sidecar_shut_down_is_not_started_again() {
        runtime().block_on(async {
            let (sink, mut rx) = heard();
            let sidecar = Sidecar::spawn("core", "/bin/sh", &["-c", "while read line; do :; done"], &std::env::temp_dir(), sink).await.expect("it starts");
            sidecar.shutdown().await;
            until(&mut rx, "sidecar.exited").await;
            tokio::time::sleep(FIRST_PAUSE * 2).await;
            let after: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok()).map(|(name, _)| name).collect();
            assert!(!after.iter().any(|name| name == "sidecar.restarted"), "it stays down: {after:?}");
        });
    }
}
