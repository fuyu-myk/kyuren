use std::io::{Read, Write};
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A tool's input can be a whole file; more than this is not worth carrying to a notch.
const MOST_PAYLOAD: u64 = 4 << 20;
/// An answer is a line of JSON.
const MOST_ANSWER: u64 = 64 << 10;
/// The longest a question may hold an agent, whatever its hook asks for.
pub const MOST_WAIT: u64 = 120;

/// One event as handed to Kyuren.
#[derive(Debug)]
pub struct Event<'a> {
    pub harness: &'a str,
    pub event: &'a str,
    /// The process that ran the hook, which is the agent or the shell it ran it in.
    pub parent: u32,
    /// Seconds to wait for an answer, for an event the agent waits on.
    pub wait: Option<u64>,
}

/// What the hook was run with.
#[derive(Debug, PartialEq)]
pub struct Asked {
    pub harness: String,
    pub event: String,
    pub wait: Option<u64>,
    pub socket: Option<PathBuf>,
}

/// A name that can be written into the header as it is: no quote, space or line in it.
pub fn plain(name: &str) -> bool {
    (1..=40).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

pub fn parsed(args: &[String]) -> Option<Asked> {
    let harness = args.first().filter(|one| plain(one))?.clone();
    let event = args.get(1).filter(|one| plain(one))?.clone();
    let after = |flag: &str| args.iter().position(|one| one == flag).and_then(|at| args.get(at + 1));
    let wait = after("--wait").and_then(|seconds| seconds.parse::<u64>().ok()).map(|seconds| seconds.min(MOST_WAIT));
    let socket = after("--socket").map(PathBuf::from);
    Some(Asked { harness, event, wait, socket })
}

fn default_socket() -> Option<PathBuf> {
    let home = std::env::var_os("KYUREN_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".kyuren")))?;
    Some(home.join("hooks").join("kyuren.sock"))
}

/// Hands the event over and, when the agent waits on it, brings back Kyuren's answer. Anything
/// amiss, Kyuren not running above all, is no answer at once, so the agent goes on as without it.
pub fn relay(socket: &Path, event: &Event, payload: &[u8]) -> Option<String> {
    let mut stream = UnixStream::connect(socket).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(1))).ok()?;
    let header = format!(
        "{{\"harness\":\"{}\",\"event\":\"{}\",\"parent\":{},\"wait\":{},\"size\":{}}}\n",
        event.harness,
        event.event,
        event.parent,
        event.wait.unwrap_or(0),
        payload.len()
    );
    stream.write_all(header.as_bytes()).ok()?;
    stream.write_all(payload).ok()?;
    let Some(seconds) = event.wait.filter(|seconds| *seconds > 0) else {
        let _ = stream.shutdown(Shutdown::Both);
        return None;
    };
    // The line stays open while it waits, so Kyuren knows the agent has stopped waiting the moment
    // this process ends.
    stream.set_read_timeout(Some(Duration::from_secs(seconds))).ok()?;
    let mut answer = String::new();
    stream.take(MOST_ANSWER).read_to_string(&mut answer).ok()?;
    Some(answer).filter(|answer| !answer.trim().is_empty())
}

/// Never an error the agent sees: whatever happens, it exits cleanly.
pub fn run() {
    // Arguments that are not text are not ones Kyuren wrote, and are no reason to fail.
    let Some(args) = std::env::args_os().skip(1).map(|one| one.into_string().ok()).collect::<Option<Vec<String>>>() else { return };
    let Some(asked) = parsed(&args) else { return };
    let mut payload = Vec::new();
    let mut input = std::io::stdin().lock();
    if input.by_ref().take(MOST_PAYLOAD).read_to_end(&mut payload).is_err() {
        return;
    }
    // The rest of an oversized input is read and let go, so the agent never writes into a closed pipe.
    let _ = std::io::copy(&mut input, &mut std::io::sink());
    let Some(socket) = asked.socket.clone().or_else(default_socket) else { return };
    let event = Event { harness: &asked.harness, event: &asked.event, parent: std::os::unix::process::parent_id(), wait: asked.wait };
    if let Some(answer) = relay(&socket, &event, &payload) {
        let mut out = std::io::stdout().lock();
        let _ = out.write_all(answer.as_bytes()).and_then(|()| out.flush());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::os::unix::net::UnixListener;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn socket(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kyuren-hook-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("made");
        dir.join("hooks.sock")
    }

    /// Kyuren's side: takes one event, as long as its header says it is, and answers with what it
    /// is given.
    fn kyuren(path: &PathBuf, answer: Option<&'static str>, after: Duration) -> std::thread::JoinHandle<Vec<u8>> {
        let listener = UnixListener::bind(path).expect("bound");
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accepted");
            let mut reader = std::io::BufReader::new(stream);
            let mut header = String::new();
            std::io::BufRead::read_line(&mut reader, &mut header).expect("a header");
            let size: usize = header.split("\"size\":").nth(1).and_then(|rest| rest.trim_end_matches(['}', '\n']).parse().ok()).expect("a size");
            let mut payload = vec![0; size];
            reader.read_exact(&mut payload).expect("the payload");
            let mut heard = header.into_bytes();
            heard.extend(payload);
            let mut stream = reader.into_inner();
            std::thread::sleep(after);
            if let Some(answer) = answer {
                let _ = stream.write_all(answer.as_bytes());
            }
            heard
        })
    }

    #[test]
    fn an_event_is_handed_over_whole_and_nothing_is_said_back_unless_waited_for() {
        let path = socket("event");
        let heard = kyuren(&path, Some("ignored"), Duration::ZERO);
        let said = relay(&path, &Event { harness: "claude", event: "Stop", parent: 7, wait: None }, b"{\"session_id\":\"s\"}");
        assert_eq!(said, None);
        let heard = String::from_utf8(heard.join().expect("joined")).expect("text");
        assert_eq!(heard, "{\"harness\":\"claude\",\"event\":\"Stop\",\"parent\":7,\"wait\":0,\"size\":18}\n{\"session_id\":\"s\"}");
    }

    #[test]
    fn a_question_waits_for_kyurens_answer_and_passes_it_on() {
        let path = socket("answer");
        let heard = kyuren(&path, Some("{\"decision\":\"allow\"}"), Duration::from_millis(50));
        let said = relay(&path, &Event { harness: "claude", event: "PermissionRequest", parent: 7, wait: Some(5) }, b"{}");
        assert_eq!(said.as_deref(), Some("{\"decision\":\"allow\"}"));
        assert!(String::from_utf8(heard.join().expect("joined")).expect("text").contains("\"wait\":5"));
    }

    #[test]
    fn without_kyuren_running_it_says_nothing_at_once() {
        let started = Instant::now();
        let said = relay(&socket("absent"), &Event { harness: "claude", event: "PermissionRequest", parent: 7, wait: Some(30) }, b"{}");
        assert_eq!(said, None);
        assert!(started.elapsed() < Duration::from_millis(200), "the agent is never kept waiting on an absent Kyuren");
    }

    #[test]
    fn an_answer_not_given_in_time_or_given_empty_is_no_answer() {
        let path = socket("late");
        let late = kyuren(&path, Some("too late"), Duration::from_millis(1_500));
        let started = Instant::now();
        assert_eq!(relay(&path, &Event { harness: "claude", event: "PermissionRequest", parent: 7, wait: Some(1) }, b"{}"), None);
        assert!(started.elapsed() < Duration::from_millis(1_400));
        let _ = late.join();

        let path = socket("empty");
        let empty = kyuren(&path, Some(" \n"), Duration::ZERO);
        assert_eq!(relay(&path, &Event { harness: "claude", event: "PermissionRequest", parent: 7, wait: Some(2) }, b"{}"), None);
        let _ = empty.join();
    }

    #[test]
    fn only_plain_names_are_passed_on() {
        assert!(plain("claude") && plain("PermissionRequest") && plain("pre_tool_call") && plain("session.created"));
        for bad in ["", "a\"b", "a b", "a\nb", &"x".repeat(41)] {
            assert!(!plain(bad), "{bad:?}");
        }
    }

    #[test]
    fn its_arguments_are_a_harness_an_event_and_how_long_to_wait() {
        let args = |list: &[&str]| list.iter().map(|one| one.to_string()).collect::<Vec<_>>();
        let asked = parsed(&args(&["claude", "PermissionRequest", "--wait", "45", "--socket", "/tmp/k.sock"])).expect("parsed");
        assert_eq!((asked.harness.as_str(), asked.event.as_str(), asked.wait, asked.socket), ("claude", "PermissionRequest", Some(45), Some(PathBuf::from("/tmp/k.sock"))));
        assert_eq!(parsed(&args(&["claude", "Stop"])).expect("parsed").wait, None);
        assert!(parsed(&args(&["claude"])).is_none());
        assert!(parsed(&args(&["claude", "bad name"])).is_none());
        assert_eq!(parsed(&args(&["claude", "Stop", "--wait", "9999"])).expect("parsed").wait, Some(MOST_WAIT), "never longer than an agent would bear");
    }
}
