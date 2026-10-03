use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::{Duration, Instant};

use base64::Engine;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

use crate::nearby::{nearby_among, nearby_host, networks};

/// How much of a request's head is read before it is taken for something other than a request.
const HEAD_MOST: usize = 16 * 1024;

/// How long a client is given to ask, a name to be looked up, and each address to take the
/// connection, and how many of its addresses are tried.
const ASKING: Duration = Duration::from_secs(15);
const LOOKING: Duration = Duration::from_secs(10);
const CONNECTING: Duration = Duration::from_secs(5);
const ADDRESSES_MOST: usize = 4;

/// How many tunnels may be open at once, more than a page needs and far fewer than the descriptors
/// the app may hold, and how long one may pass nothing either way before it is closed.
const TUNNELS_MOST: usize = 64;
const IDLE: Duration = Duration::from_secs(15);

/// How many longer a tunnel is kept quiet while an answer is still owed on it than once one has come.
const WAITING: u32 = 4;

/// How many may be asking at once, not yet proved: few, and apart from the tunnels' places, so a
/// stranger can neither take a tunnel's place nor make one close.
const DOOR_MOST: usize = 16;

/// The name the reader gives the proxy, with a password made for this launch alone.
const USER: &str = "kyuren";

const ESTABLISHED: &[u8] = b"HTTP/1.1 200 Connection Established\r\n\r\n";
const UNPROVEN: &[u8] =
    b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"kyuren\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const FORBIDDEN: &[u8] = b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const NOT_ALLOWED: &[u8] = b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const UNREACHED: &[u8] = b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// How many times something was refused for being nearby, so a read that timed out can say it tried.
static REFUSED: AtomicU64 = AtomicU64::new(0);

pub fn refusals() -> u64 {
    REFUSED.load(Ordering::Relaxed)
}

/// The proxy as the reader needs to know it: where it listens, and how to prove itself to it.
pub struct Proxy {
    pub port: u16,
    pub user: &'static str,
    pub password: String,
}

/// What the proxy is held to: how long a tunnel may sit quiet, how many may be open at once, and the
/// credentials a client must show, as they arrive.
#[derive(Clone)]
struct Terms {
    idle: Duration,
    most: usize,
    expected: Arc<str>,
}

fn expected_for(password: &str) -> String {
    format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{USER}:{password}")))
}

/// A password for this launch alone, so the proxy is the reader's, not any process's on the machine.
fn password() -> String {
    let mut made = [0u8; 16];
    // SAFETY: the buffer is the length given, which the call fills.
    unsafe { libc::arc4random_buf(made.as_mut_ptr().cast(), made.len()) };
    made.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Whether a request's head shows the credentials expected, compared in time that does not depend on
/// how much of them is right.
fn proves(head: &str, expected: &str) -> bool {
    head.lines().skip(1).filter_map(|line| line.split_once(':')).any(|(name, value)| {
        let value = value.trim().as_bytes();
        name.trim().eq_ignore_ascii_case("proxy-authorization")
            && value.len() == expected.len()
            && value.iter().zip(expected.as_bytes()).fold(0u8, |differs, (one, other)| differs | (one ^ other)) == 0
    })
}

/// Where the reader may connect for a host: every address the host is found at, unless its name,
/// or any of those addresses, is on this machine or a network it is on. Looked up here, so the
/// address connected to is the one checked, and a name cannot answer one way for the check and
/// another for the connection.
pub async fn public(host: String, port: u16) -> Option<Vec<SocketAddr>> {
    if nearby_host(&host) {
        return None;
    }
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    let found: Vec<SocketAddr> = match bare.parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => tokio::time::timeout(LOOKING, tokio::net::lookup_host((bare, port))).await.ok()?.ok()?.collect(),
    };
    let near = networks();
    (!found.is_empty() && !found.iter().any(|at| nearby_among(at.ip(), &near))).then_some(found)
}

/// The host and port a request asks to be tunnelled to, if it asks for a tunnel.
fn asked(head: &str) -> Option<(String, u16)> {
    let mut words = head.lines().next()?.split_whitespace();
    if !words.next()?.eq_ignore_ascii_case("CONNECT") {
        return None;
    }
    let (host, port) = words.next()?.rsplit_once(':')?;
    Some((host.to_string(), port.parse().ok()?))
}

/// A request's head, and whatever the client sent after it, within one deadline for the whole.
async fn head_of(client: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    let reading = async {
        let mut read = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let got = client.read(&mut chunk).await.ok()?;
            if got == 0 {
                return None;
            }
            read.extend_from_slice(&chunk[..got]);
            if let Some(end) = read.windows(4).position(|four| four == b"\r\n\r\n") {
                let after = read.split_off(end + 4);
                return Some((String::from_utf8_lossy(&read).into_owned(), after));
            }
            if read.len() > HEAD_MOST {
                return None;
            }
        }
    };
    tokio::time::timeout(ASKING, reading).await.ok()?
}

/// A few of the addresses, the families taken in turn, so one that never answers costs a little
/// before the other is tried.
fn in_turn(addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let (v6, v4): (Vec<_>, Vec<_>) = addresses.into_iter().partition(SocketAddr::is_ipv6);
    let mut turned = Vec::new();
    for at in 0..v6.len().max(v4.len()) {
        turned.extend(v6.get(at).copied());
        turned.extend(v4.get(at).copied());
    }
    turned.truncate(ADDRESSES_MOST);
    turned
}

/// An open tunnel as the proxy sees it: when it last carried anything, whether the server spoke last,
/// and a way to close it to make room for another.
struct Open {
    last: AtomicU64,
    answered: AtomicBool,
    closing: Notify,
}

type Tunnels = Arc<Mutex<Vec<Weak<Open>>>>;

/// The tunnel that has carried nothing for longest since its server last spoke, as a browser keeps
/// tunnels open in case it needs them again, which it can open again if it does. One still owed an
/// answer is never it.
fn quietest(tunnels: &Tunnels) -> Option<Arc<Open>> {
    let mut all = tunnels.lock().unwrap_or_else(PoisonError::into_inner);
    all.retain(|one| one.strong_count() > 0);
    all.iter()
        .filter_map(Weak::upgrade)
        .filter(|one| one.answered.load(Ordering::Relaxed))
        .min_by_key(|one| one.last.load(Ordering::Relaxed))
}

fn now(epoch: Instant) -> u64 {
    u64::try_from(epoch.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Copies one way until the side it reads from ends, or nothing has passed either way for a while: a
/// while longer when an answer is still owed.
async fn pump<R, W>(from: &mut R, to: &mut W, open: &Open, toward_client: bool, epoch: Instant, idle: Duration)
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = vec![0u8; 16 * 1024];
    let idle_ms = u64::try_from(idle.as_millis()).unwrap_or(u64::MAX);
    loop {
        match tokio::time::timeout(idle, from.read(&mut buffer)).await {
            Ok(Ok(got)) if got > 0 => {
                open.last.store(now(epoch), Ordering::Relaxed);
                open.answered.store(toward_client, Ordering::Relaxed);
                if !matches!(tokio::time::timeout(idle, to.write_all(&buffer[..got])).await, Ok(Ok(()))) {
                    return;
                }
            }
            Ok(_) => return,
            // Quiet this way only: the tunnel stays open while the other way is busy.
            Err(_) => {
                let owed = !open.answered.load(Ordering::Relaxed);
                let limit = if owed { idle_ms.saturating_mul(u64::from(WAITING)) } else { idle_ms };
                if now(epoch).saturating_sub(open.last.load(Ordering::Relaxed)) >= limit {
                    return;
                }
            }
        }
    }
}

/// Carries bytes both ways until either side leaves, both fall quiet, or the tunnel is closed to make
/// room, then closes both: a server left talking to nobody holds nothing.
async fn tunnel(client: TcpStream, upstream: TcpStream, open: &Open, epoch: Instant, idle: Duration) {
    let (mut client_in, mut client_out) = client.into_split();
    let (mut upstream_in, mut upstream_out) = upstream.into_split();
    let mut up = std::pin::pin!(pump(&mut client_in, &mut upstream_out, open, false, epoch, idle));
    let mut down = std::pin::pin!(pump(&mut upstream_in, &mut client_out, open, true, epoch, idle));
    let mut closed = std::pin::pin!(open.closing.notified());
    std::future::poll_fn(|context| {
        if up.as_mut().poll(context).is_ready() || down.as_mut().poll(context).is_ready() || closed.as_mut().poll(context).is_ready() {
            std::task::Poll::Ready(())
        } else {
            std::task::Poll::Pending
        }
    })
    .await;
}

/// What every connection shares: the terms, the tunnels' places and the tunnels themselves.
#[derive(Clone)]
struct Shared {
    terms: Terms,
    room: Arc<Semaphore>,
    tunnels: Tunnels,
    epoch: Instant,
}

/// A tunnel's place for a reader that proved itself: at the cap, the quietest tunnel no answer is
/// owed on makes room rather than the new one waiting on it.
async fn place_for(shared: &Shared) -> Option<OwnedSemaphorePermit> {
    if let Ok(place) = Arc::clone(&shared.room).try_acquire_owned() {
        return Some(place);
    }
    if let Some(quiet) = quietest(&shared.tunnels) {
        quiet.closing.notify_one();
    }
    tokio::time::timeout(ASKING, Arc::clone(&shared.room).acquire_owned()).await.ok()?.ok()
}

/// One connection from the reader: proved at the door, then tunnelled to a public address of what it
/// asked for, or refused.
async fn serve<J, F>(mut client: TcpStream, judge: J, at_door: OwnedSemaphorePermit, shared: Shared)
where
    J: Fn(String, u16) -> F,
    F: Future<Output = Option<Vec<SocketAddr>>>,
{
    let Some((head, early)) = head_of(&mut client).await else { return };
    let Some((host, port)) = asked(&head) else {
        let _ = client.write_all(NOT_ALLOWED).await;
        return;
    };
    if !proves(&head, &shared.terms.expected) {
        let _ = client.write_all(UNPROVEN).await;
        return;
    }
    drop(at_door);
    let Some(_place) = place_for(&shared).await else { return };
    let Some(addresses) = judge(host, port).await else {
        REFUSED.fetch_add(1, Ordering::Relaxed);
        let _ = client.write_all(FORBIDDEN).await;
        return;
    };
    let mut upstream = None;
    for at in in_turn(addresses) {
        if let Ok(Ok(stream)) = tokio::time::timeout(CONNECTING, TcpStream::connect(at)).await {
            upstream = Some(stream);
            break;
        }
    }
    let Some(mut upstream) = upstream else {
        let _ = client.write_all(UNREACHED).await;
        return;
    };
    if client.write_all(ESTABLISHED).await.is_err() || (!early.is_empty() && upstream.write_all(&early).await.is_err()) {
        return;
    }
    let open = Arc::new(Open { last: AtomicU64::new(now(shared.epoch)), answered: AtomicBool::new(true), closing: Notify::new() });
    shared.tunnels.lock().unwrap_or_else(PoisonError::into_inner).push(Arc::downgrade(&open));
    tunnel(client, upstream, &open, shared.epoch, shared.terms.idle).await;
}

async fn accept_with<J, F>(listener: TcpListener, judge: J, terms: Terms)
where
    J: Fn(String, u16) -> F + Clone + Send + 'static,
    F: Future<Output = Option<Vec<SocketAddr>>> + Send + 'static,
{
    let door = Arc::new(Semaphore::new(DOOR_MOST));
    let shared = Shared { room: Arc::new(Semaphore::new(terms.most)), terms, tunnels: Arc::default(), epoch: Instant::now() };
    let said = AtomicBool::new(false);
    loop {
        let client = match listener.accept().await {
            Ok((client, _)) => client,
            Err(failure) => {
                if !said.swap(true, Ordering::Relaxed) {
                    eprintln!("kyuren reader proxy: a connection could not be taken: {failure}");
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let Ok(at_door) = Arc::clone(&door).try_acquire_owned() else { continue };
        tokio::spawn(serve(client, judge.clone(), at_door, shared.clone()));
    }
}

/// Starts the proxy the reader goes through, on a port of this machine's own, and says where it is
/// and how to prove oneself to it. Called inside the app's runtime, which the proxy then runs on.
pub async fn start() -> std::io::Result<Proxy> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let password = password();
    let terms = Terms { idle: IDLE, most: TUNNELS_MOST, expected: Arc::from(expected_for(&password)) };
    tokio::spawn(accept_with(listener, public, terms));
    Ok(Proxy { port, user: USER, password })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "test-password";

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime")
    }

    fn terms(idle: Duration, most: usize) -> Terms {
        Terms { idle, most, expected: Arc::from(expected_for(PASSWORD)) }
    }

    fn asking(host: &str) -> Vec<u8> {
        format!("CONNECT {host} HTTP/1.1\r\nHost: {host}\r\nProxy-Authorization: {}\r\n\r\n", expected_for(PASSWORD)).into_bytes()
    }

    /// What a client is told when it asks the proxy for somewhere.
    async fn answered(proxy: SocketAddr, asking: &[u8]) -> String {
        let mut client = TcpStream::connect(proxy).await.expect("connected");
        client.write_all(asking).await.expect("asked");
        let mut answer = vec![0u8; 256];
        let got = client.read(&mut answer).await.expect("answered");
        String::from_utf8_lossy(&answer[..got]).into_owned()
    }

    /// A server that takes connections, says nothing whatever it is sent, and tells when one is let go.
    async fn silent() -> (SocketAddr, tokio::sync::mpsc::UnboundedReceiver<()>) {
        let server = TcpListener::bind(("127.0.0.1", 0)).await.expect("bound");
        let at = server.local_addr().expect("an address");
        let (told, closed) = tokio::sync::mpsc::unbounded_channel::<()>();
        tokio::spawn(async move {
            loop {
                let (mut stream, _) = server.accept().await.expect("accepted");
                let told = told.clone();
                tokio::spawn(async move {
                    let mut heard = [0u8; 64];
                    while matches!(stream.read(&mut heard).await, Ok(got) if got > 0) {}
                    let _ = told.send(());
                });
            }
        });
        (at, closed)
    }

    async fn proxy_to(server: SocketAddr, terms: Terms) -> SocketAddr {
        let judge = move |host: String, _port: u16| async move { (host != "localtest.me").then(|| vec![server]) };
        let proxy = TcpListener::bind(("127.0.0.1", 0)).await.expect("bound");
        let at = proxy.local_addr().expect("an address");
        tokio::spawn(accept_with(proxy, judge, terms));
        at
    }

    #[test]
    fn a_name_nearby_by_itself_or_by_where_it_is_found_is_never_public() {
        runtime().block_on(async {
            for host in ["localhost", "router", "printer.local", "127.0.0.1", "[::1]", "127.1", "10.0.0.5"] {
                assert!(public(host.to_string(), 80).await.is_none(), "{host} was let through");
            }
            assert_eq!(public("93.184.216.34".into(), 443).await, Some(vec!["93.184.216.34:443".parse().expect("an address")]));
        });
    }

    #[test]
    fn only_the_reader_with_this_launchs_password_is_let_through() {
        runtime().block_on(async {
            let (server, _closed) = silent().await;
            let proxy = proxy_to(server, terms(IDLE, TUNNELS_MOST)).await;
            let challenged = answered(proxy, b"CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n").await;
            assert!(challenged.starts_with("HTTP/1.1 407") && challenged.contains("Proxy-Authenticate: Basic"), "{challenged}");
            let wrong = format!("CONNECT public.example:443 HTTP/1.1\r\nProxy-Authorization: {}\r\n\r\n", expected_for("guessed"));
            assert!(answered(proxy, wrong.as_bytes()).await.starts_with("HTTP/1.1 407"));
            assert!(answered(proxy, &asking("public.example:443")).await.starts_with("HTTP/1.1 200"));
        });
    }

    #[test]
    fn the_reader_is_tunnelled_to_the_address_checked_and_refused_anywhere_nearby() {
        runtime().block_on(async {
            // A server standing in for one on the public web, which echoes what it is sent.
            let server = TcpListener::bind(("127.0.0.1", 0)).await.expect("bound");
            let server_at = server.local_addr().expect("an address");
            tokio::spawn(async move {
                let (mut stream, _) = server.accept().await.expect("accepted");
                let mut said = [0u8; 5];
                stream.read_exact(&mut said).await.expect("read");
                stream.write_all(&said).await.expect("written");
            });
            let proxy = proxy_to(server_at, terms(IDLE, TUNNELS_MOST)).await;

            assert!(answered(proxy, &asking("localtest.me:80")).await.starts_with("HTTP/1.1 403"));
            assert!(answered(proxy, b"GET http://public.example/ HTTP/1.1\r\n\r\n").await.starts_with("HTTP/1.1 405"), "only a tunnel is offered");

            let mut client = TcpStream::connect(proxy).await.expect("connected");
            client.write_all(&asking("public.example:443")).await.expect("asked");
            let mut head = vec![0u8; ESTABLISHED.len()];
            client.read_exact(&mut head).await.expect("answered");
            assert_eq!(head, ESTABLISHED);
            client.write_all(b"hello").await.expect("sent");
            let mut echoed = [0u8; 5];
            client.read_exact(&mut echoed).await.expect("echoed");
            assert_eq!(&echoed, b"hello");
        });
    }

    #[test]
    fn a_tunnel_ends_when_either_side_leaves_or_both_fall_quiet() {
        runtime().block_on(async {
            let (server, mut closed) = silent().await;
            let proxy = proxy_to(server, terms(Duration::from_millis(300), TUNNELS_MOST)).await;
            let mut head = vec![0u8; ESTABLISHED.len()];

            let mut leaving = TcpStream::connect(proxy).await.expect("connected");
            leaving.write_all(&asking("silent.example:443")).await.expect("asked");
            leaving.read_exact(&mut head).await.expect("answered");
            drop(leaving);
            assert!(tokio::time::timeout(Duration::from_secs(2), closed.recv()).await.is_ok(), "the silent server is let go when the reader leaves");

            let mut staying = TcpStream::connect(proxy).await.expect("connected");
            staying.write_all(&asking("silent.example:443")).await.expect("asked");
            staying.read_exact(&mut head).await.expect("answered");
            assert!(tokio::time::timeout(Duration::from_secs(2), closed.recv()).await.is_ok(), "and when nothing passes either way");
            drop(staying);
        });
    }

    /// Opens a tunnel through the proxy, as the reader would.
    async fn tunnelled(proxy: SocketAddr) -> TcpStream {
        let mut client = TcpStream::connect(proxy).await.expect("connected");
        client.write_all(&asking("silent.example:443")).await.expect("asked");
        let mut head = vec![0u8; ESTABLISHED.len()];
        client.read_exact(&mut head).await.expect("answered");
        client
    }

    #[test]
    fn a_stranger_at_the_door_takes_no_tunnels_place() {
        runtime().block_on(async {
            let (server, mut closed) = silent().await;
            let proxy = proxy_to(server, terms(IDLE, 1)).await;
            let _kept = tunnelled(proxy).await;
            for _ in 0..3 {
                assert!(answered(proxy, b"CONNECT silent.example:443 HTTP/1.1\r\n\r\n").await.starts_with("HTTP/1.1 407"));
            }
            assert!(tokio::time::timeout(Duration::from_millis(500), closed.recv()).await.is_err(), "the reader's tunnel is left alone");
        });
    }

    #[test]
    fn a_tunnel_waiting_on_its_answer_is_not_closed_to_make_room() {
        runtime().block_on(async {
            let (server, mut closed) = silent().await;
            let proxy = proxy_to(server, terms(IDLE, 1)).await;
            let mut waiting = tunnelled(proxy).await;
            waiting.write_all(b"GET / HTTP/1.1\r\n\r\n").await.expect("asked");
            let mut second = TcpStream::connect(proxy).await.expect("connected");
            second.write_all(&asking("silent.example:443")).await.expect("asked");
            assert!(tokio::time::timeout(Duration::from_millis(500), closed.recv()).await.is_err(), "it is still waiting on its answer");
        });
    }

    #[test]
    fn an_answer_slow_to_come_is_waited_for_longer_than_a_quiet_tunnel() {
        runtime().block_on(async {
            // A server that answers a request only after a while longer than a quiet tunnel is kept.
            let server = TcpListener::bind(("127.0.0.1", 0)).await.expect("bound");
            let server_at = server.local_addr().expect("an address");
            tokio::spawn(async move {
                let (mut stream, _) = server.accept().await.expect("accepted");
                let mut asked = [0u8; 4];
                stream.read_exact(&mut asked).await.expect("read");
                tokio::time::sleep(Duration::from_millis(700)).await;
                stream.write_all(b"done").await.expect("written");
            });
            let proxy = proxy_to(server_at, terms(Duration::from_millis(300), TUNNELS_MOST)).await;
            let mut client = tunnelled(proxy).await;
            client.write_all(b"ask?").await.expect("asked");
            let mut answer = [0u8; 4];
            client.read_exact(&mut answer).await.expect("the answer came");
            assert_eq!(&answer, b"done");
        });
    }

    #[test]
    fn at_the_cap_the_quietest_tunnel_makes_room_for_a_new_one() {
        runtime().block_on(async {
            let (server, mut closed) = silent().await;
            let proxy = proxy_to(server, terms(IDLE, 1)).await;
            let mut head = vec![0u8; ESTABLISHED.len()];
            let mut first = TcpStream::connect(proxy).await.expect("connected");
            first.write_all(&asking("silent.example:443")).await.expect("asked");
            first.read_exact(&mut head).await.expect("answered");
            let mut second = TcpStream::connect(proxy).await.expect("connected");
            second.write_all(&asking("silent.example:443")).await.expect("asked");
            let made = tokio::time::timeout(Duration::from_secs(2), second.read_exact(&mut head)).await;
            assert!(made.is_ok(), "the new tunnel is not kept waiting");
            assert!(tokio::time::timeout(Duration::from_secs(2), closed.recv()).await.is_ok(), "the quiet one was closed for it");
        });
    }
}
