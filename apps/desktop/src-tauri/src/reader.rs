use std::borrow::Cow;
use std::collections::VecDeque;
use std::error::Error;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::http::{Request, Response};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, UriSchemeContext, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_nspanel::{tauri_panel, StyleMask, WebviewWindowExt};

use crate::nearby::nearby;
use crate::state::{Sidecars, PING_TIMEOUT};

/// The one window pages are read in. Built once at startup, hidden, and made a panel that can
/// never become key, as the overlay is; from then on it is only ever navigated.
pub const LABEL: &str = "reader";

/// The scheme a page's answer travels back on. Registered by the app, so a page can reach it and
/// nothing else in Kyuren: the reader window is given no command bridge at all.
pub const SCHEME: &str = "kyuren-reader";

/// The reader keeps its own cookies and its own way out, apart from the app's windows.
const READER_STORE: [u8; 16] = *b"kyuren.reader.v1";

/// The proxy everything the reader fetches goes through, a PDF's download included.
static PROXY: OnceLock<crate::reader_proxy::Proxy> = OnceLock::new();

/// How long a page is given to load and answer before the read is failed and the next begins.
const PATIENCE: Duration = Duration::from_secs(40);

/// How long the perception sidecar is given to download a PDF and read it.
const PDF_PATIENCE: Duration = Duration::from_secs(40);

/// How much of a page is handed back.
const MOST: usize = 8000;

// The same kind of window the overlay is: one that can never become key, so a page loading in
// it takes nothing from whatever the user is doing.
tauri_panel! {
    panel!(ReaderPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

#[derive(Clone, Debug)]
struct Job {
    id: String,
    url: String,
    kind: String,
    /// For a PDF, the page to start reading from.
    from: Option<u64>,
    /// Whether the page tried to go somewhere nearby and was turned back.
    turned_back: bool,
    /// Where the page ended up, as the reader saw it finish loading.
    landed: Option<String>,
}

struct Desk {
    waiting: VecDeque<Job>,
    current: Option<Job>,
}

fn desk() -> &'static Mutex<Desk> {
    static DESK: OnceLock<Mutex<Desk>> = OnceLock::new();
    DESK.get_or_init(|| Mutex::new(Desk { waiting: VecDeque::new(), current: None }))
}

/// Builds the reader window once, at startup and on the main thread, with the two ways a page's
/// answer comes back: a post to the app's scheme, and failing that a navigation to it, which is
/// intercepted here and never made. Then it becomes a panel that cannot take focus, and hides.
pub fn install(app: &AppHandle) -> Result<(), Box<dyn Error>> {
    let blank = Url::parse("about:blank")?;
    let proxy = tauri::async_runtime::block_on(crate::reader_proxy::start())?;
    let (port, user, password) = (proxy.port, proxy.user, proxy.password.clone());
    let _ = PROXY.set(proxy);
    let nav_app = app.clone();
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(blank))
        .data_store_identifier(READER_STORE)
        .title("Kyuren is reading")
        .visible(false)
        .focused(false)
        .decorations(false)
        .skip_taskbar(true)
        .inner_size(480.0, 320.0)
        .on_navigation(move |url| {
            if url.scheme() == SCHEME {
                if let Some(fragment) = url.fragment() {
                    if let Ok(decoded) = percent_encoding::percent_decode_str(fragment).decode_utf8() {
                        if let Ok(payload) = serde_json::from_str::<Value>(&decoded) {
                            if let Some(id) = payload.get("id").and_then(Value::as_str).map(str::to_string) {
                                finish(&nav_app, &id, payload);
                            }
                        }
                    }
                }
                return false;
            }
            if url.as_str() == "about:blank" {
                return true;
            }
            if url.scheme() != "http" && url.scheme() != "https" {
                return false;
            }
            if !nearby(url) {
                return true;
            }
            // Frames come through here as well as the page, so a turn home is refused and noted
            // rather than failing the read: a page that only framed one still answers.
            if let Some(job) = desk().lock().ok().as_mut().and_then(|held| held.current.as_mut()) {
                job.turned_back = true;
            }
            false
        })
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if payload.url().scheme() != "http" && payload.url().scheme() != "https" {
                return;
            }
            let Some(job) = desk().lock().ok().and_then(|mut held| {
                let job = held.current.as_mut()?;
                job.landed = Some(payload.url().to_string());
                Some(job.clone())
            }) else {
                return;
            };
            let script = if job.kind == "search" { search_script(&job.id) } else { page_script(&job.id) };
            let _ = webview.eval(&script);
        })
        .build()?;
    crate::reader_ui::guard(&window, port, user, password)?;
    let panel = window.to_panel::<ReaderPanel>()?;
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    panel.hide();
    Ok(())
}

/// What a page said, with where it ended up as the reader saw it load in place of whatever the
/// page's own script claimed: a page can rewrite what it posts, not where it was loaded.
fn landed_at(mut payload: Value, landed: Option<&str>) -> Value {
    if let Some(fields) = payload.as_object_mut() {
        match landed {
            Some(at) => {
                fields.insert("url".into(), Value::String(at.to_string()));
            }
            None => {
                fields.remove("url");
            }
        }
    }
    payload
}

/// Ported from the reader of an earlier browser project of the author's: the element with the most text among
/// the containers a page names, or the densest run of paragraphs, tightened to an article body
/// where there is one.
const MAIN_CONTENT_FINDER: &str = r#"
function __kyurenMain() {
  function textLen(el) { return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim().length; }
  var best = null, bestScore = 0;
  var named = document.querySelectorAll('article, main, [role=main], [itemprop=articleBody], .post, .article, .entry-content, .post-content, #content, .content');
  Array.prototype.slice.call(named).forEach(function (c) { var s = textLen(c); if (s > bestScore) { bestScore = s; best = c; } });
  if (!best || bestScore < 200) {
    Array.prototype.slice.call(document.querySelectorAll('div, section')).forEach(function (c) {
      var ps = c.querySelectorAll('p'); if (ps.length < 2) return;
      var s = 0; for (var i = 0; i < ps.length; i++) s += textLen(ps[i]);
      if (s > bestScore) { bestScore = s; best = c; }
    });
  }
  if (!best) best = document.body;
  var tight = best.querySelector('#mw-content-text, [itemprop=articleBody]');
  if (tight && textLen(tight) > bestScore * 0.5) { best = tight; }
  return best;
}
"#;

/// What every script ends with: the answer posted to the app's scheme, or failing that, carried
/// in a navigation the app intercepts. Both are tried, since which one a page is allowed to make
/// depends on the page.
fn post(id: &str) -> String {
    format!(
        r#"function __kyurenPost(payload) {{
  payload.id = {id};
  var text = JSON.stringify(payload);
  var byLink = function () {{ try {{ location.href = '{scheme}://done#' + encodeURIComponent(text); }} catch (e) {{}} }};
  try {{
    fetch('{scheme}://done', {{ method: 'POST', mode: 'cors', body: text }}).then(function (r) {{ if (!r || !r.ok) byLink(); }}, byLink);
    setTimeout(byLink, 1500);
  }} catch (e) {{ byLink(); }}
}}"#,
        id = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".into()),
        scheme = SCHEME,
    )
}

fn page_script(id: &str) -> String {
    format!(
        "{}\n{}\n{}",
        MAIN_CONTENT_FINDER,
        post(id),
        r#"(function () {
  try {
    // The window can show a PDF but has no text to give for one, so it hands the address back.
    if ((document.contentType || '').indexOf('pdf') !== -1) { __kyurenPost({ ok: false, pdf: true, reason: 'a PDF' }); return; }
    var best = __kyurenMain();
    var text = ((best && (best.innerText || best.textContent)) || '').replace(/\s+/g, ' ').trim();
    if (text.length > 8000) text = text.slice(0, 8000);
    __kyurenPost({ ok: true, url: location.href, title: (document.title || '').trim().slice(0, 300), text: text });
  } catch (e) { __kyurenPost({ ok: false, reason: String(e) }); }
})();"#
    )
}

/// The results page without scripts, read the way wis reads it: each result row's link and
/// snippet, advertisements skipped, redirect wrappers unwrapped.
fn search_script(id: &str) -> String {
    format!(
        "{}\n{}",
        post(id),
        r#"(function () {
  var words = function (el) { return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); };
  var refused = function () {
    var page = (document.documentElement && document.documentElement.innerHTML) || '';
    return /anomaly|challenge-form|captcha|unusual traffic|not a robot|verify you are a human/i.test(page);
  };
  var unwrapped = function (href) {
    var m = href.match(/[?&]u=a1([^&]+)/);
    if (!m) return href;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var raw = atob(b);
      var bytes = new Uint8Array(raw.length);
      for (var k = 0; k < raw.length; k++) bytes[k] = raw.charCodeAt(k);
      return new TextDecoder().decode(bytes);
    } catch (e) { return href; }
  };
  try {
    var out = [];
    if ((location.hostname || '').indexOf('bing.') !== -1) {
      var items = document.querySelectorAll('li.b_algo');
      for (var i = 0; i < items.length && out.length < 6; i++) {
        var link = items[i].querySelector('h2 a');
        if (!link) continue;
        var to = unwrapped(link.getAttribute('href') || '');
        if (!/^https?:\/\//.test(to)) continue;
        out.push({ title: words(link).slice(0, 300), url: to.slice(0, 2000), snippet: words(items[i].querySelector('.b_caption p, p')).slice(0, 500) });
      }
    } else {
      var rows = document.querySelectorAll('.result');
      for (var j = 0; j < rows.length && out.length < 6; j++) {
        var row = rows[j];
        if (row.className.indexOf('result--ad') !== -1) continue;
        var a = row.querySelector('.result__a');
        if (!a) continue;
        var href = a.getAttribute('href') || '';
        var m = href.match(/[?&]uddg=([^&]+)/);
        if (m) { try { href = decodeURIComponent(m[1]); } catch (e) {} }
        else if (href.slice(0, 2) === '//') { href = 'https:' + href; }
        out.push({ title: words(a).slice(0, 300), url: href.slice(0, 2000), snippet: words(row.querySelector('.result__snippet')).slice(0, 500) });
      }
    }
    // A page with no results that asks for a challenge is a refusal, not an empty search, so the
    // core knows to ask the next engine rather than report that nothing was found.
    if (out.length === 0 && refused()) { __kyurenPost({ ok: false, reason: 'the engine asked for a challenge' }); return; }
    __kyurenPost({ ok: true, text: JSON.stringify(out) });
  } catch (e) { __kyurenPost({ ok: false, reason: String(e) }); }
})();"#
    )
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Sends the reader to the next page waiting, if it is free.
/// Whether an address is a PDF before it is loaded: by its name, or by the one large source of
/// papers that serves them without one. Anything else is found out when it loads.
fn looks_like_pdf(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else { return false };
    let path = parsed.path().to_ascii_lowercase();
    let arxiv = parsed.host_str().is_some_and(|host| host == "arxiv.org" || host.ends_with(".arxiv.org"));
    path.ends_with(".pdf") || (arxiv && path.starts_with("/pdf/"))
}

/// Asks the perception sidecar to download a PDF and read it with PDFKit, and answers the core
/// with what it gave. The reader window is not involved, so it is free for the next page.
fn read_pdf(app: &AppHandle, id: String, url: String, from: Option<u64>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let perception = handle.try_state::<Sidecars>().map(|state| Arc::clone(&state.perception));
        let answer = match (perception, PROXY.get()) {
            (None, _) => json!({ "id": id, "ok": false, "reason": "perception is not running to read the PDF" }),
            (_, None) => json!({ "id": id, "ok": false, "reason": "the reader's way out is not in place" }),
            (Some(perception), Some(proxy)) => match perception
                .request(
                    "pdf.read",
                    json!({ "url": url, "from": from, "proxy": proxy.port, "proxyUser": proxy.user, "proxyPassword": proxy.password }),
                    PDF_PATIENCE,
                )
                .await
            {
                // The address asked for: the download itself is never followed anywhere nearby.
                Ok(read) => json!({
                    "id": id,
                    "ok": true,
                    "url": url,
                    "title": read.get("title").cloned().unwrap_or(Value::Null),
                    "text": read.get("text").cloned().unwrap_or(Value::Null),
                }),
                Err(failure) => json!({ "id": id, "ok": false, "reason": format!("the PDF could not be read: {failure}") }),
            },
        };
        tell_core(&handle, answer);
    });
}

/// Hands a read back to the core, cut to what a read may be.
fn tell_core(app: &AppHandle, mut payload: Value) {
    if let Some(text) = payload.get("text").and_then(Value::as_str) {
        if text.chars().count() > MOST * 4 {
            let cut: String = text.chars().take(MOST * 4).collect();
            payload["text"] = Value::String(cut);
        }
    }
    if let Some(core) = app.try_state::<Sidecars>().map(|state| Arc::clone(&state.core)) {
        tauri::async_runtime::spawn(async move {
            if let Err(failure) = core.request("web.read.answer", payload, PING_TIMEOUT).await {
                eprintln!("kyuren reader: could not answer the core: {failure}");
            }
        });
    }
}

fn pump(app: &AppHandle) {
    loop {
        let (next, pdf) = {
            let Ok(mut held) = desk().lock() else { return };
            if held.current.is_some() {
                return;
            }
            let Some(job) = held.waiting.pop_front() else { return };
            // A PDF is read by the sidecar and never loaded here, so it does not hold the reader.
            let pdf = job.kind == "page" && looks_like_pdf(&job.url);
            if !pdf {
                held.current = Some(job.clone());
            }
            (job, pdf)
        };
        if pdf {
            read_pdf(app, next.id, next.url, next.from);
            continue;
        }
        load(app, next);
        return;
    }
}

/// Sends the reader window to a page, with a limit on how long it may take to answer.
fn load(app: &AppHandle, next: Job) {
    if !crate::reader_ui::guarded() {
        finish(app, &next.id, json!({ "id": next.id, "ok": false, "reason": "the reader's guards against the camera, the microphone and this network are not in place" }));
        return;
    }
    let parsed = match Url::parse(&next.url) {
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => parsed,
        _ => {
            finish(app, &next.id, json!({ "id": next.id, "ok": false, "reason": "not a web address" }));
            return;
        }
    };
    let Some(reader) = window(app) else {
        finish(app, &next.id, json!({ "id": next.id, "ok": false, "reason": "the reader window is not there" }));
        return;
    };
    let refused_before = crate::reader_proxy::refusals();
    if let Err(failure) = reader.navigate(parsed) {
        finish(app, &next.id, json!({ "id": next.id, "ok": false, "reason": format!("the reader could not go there: {failure}") }));
        return;
    }

    let later = app.clone();
    let id = next.id.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(PATIENCE).await;
        let waiting = desk().lock().ok().and_then(|held| held.current.as_ref().filter(|job| job.id == id).map(|job| job.turned_back));
        if let Some(turned_back) = waiting {
            // A name the proxy found nearby fails the page as a timeout would, so it is said here.
            let reason = if turned_back || crate::reader_proxy::refusals() > refused_before {
                "the page did not answer in time, after it tried to reach this machine or its network"
            } else {
                "the page did not answer in time"
            };
            finish(&later, &id, json!({ "id": id, "ok": false, "reason": reason }));
        }
    });
}

/// Answers the core for the page being read, if this answer is for it, and moves on.
fn finish(app: &AppHandle, id: &str, payload: Value) {
    let job = {
        let Ok(mut held) = desk().lock() else { return };
        if held.current.as_ref().is_none_or(|job| job.id != id) {
            return;
        }
        held.current.take()
    };
    if let Some(reader) = window(app) {
        // Off the page, so its scripts stop and it holds nothing while the reader waits.
        if let Ok(blank) = Url::parse("about:blank") {
            let _ = reader.navigate(blank);
        }
    }
    // A page that turned out to be a PDF is read by the sidecar instead.
    match job {
        Some(job) if payload.get("pdf").and_then(Value::as_bool) == Some(true) => read_pdf(app, job.id, job.url, job.from),
        Some(job) => tell_core(app, landed_at(payload, job.landed.as_deref())),
        None => tell_core(app, payload),
    }
    pump(app);
}

/// A page's answer, posted to the app's own scheme. Any origin may post, since the page is
/// whatever the read pointed at; an answer counts only for the page being read.
pub fn answered(ctx: UriSchemeContext<'_, tauri::Wry>, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    if let Ok(payload) = serde_json::from_slice::<Value>(request.body()) {
        if let Some(id) = payload.get("id").and_then(Value::as_str).map(str::to_string) {
            finish(ctx.app_handle(), &id, payload);
        }
    }
    Response::builder()
        .status(200)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Content-Type", "text/plain")
        .body(Cow::Borrowed(b"ok" as &[u8]))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"" as &[u8])))
}

/// The core asked for a page. It joins the queue, and the reader takes it when it is free.
pub fn on_request(app: &AppHandle, data: &Value) {
    let id = data.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let url = data.get("url").and_then(Value::as_str).unwrap_or("").to_string();
    let kind = data.get("kind").and_then(Value::as_str).unwrap_or("page").to_string();
    let from = data.get("from").and_then(Value::as_u64).filter(|page| *page >= 1);
    if id.is_empty() {
        return;
    }
    if let Ok(mut held) = desk().lock() {
        held.waiting.push_back(Job { id, url, kind, from, turned_back: false, landed: None });
    }
    pump(app);
}

#[cfg(test)]
mod tests {
    use super::{landed_at, looks_like_pdf};
    use serde_json::json;

    #[test]
    fn where_a_page_ended_up_is_the_readers_to_say_not_the_pages() {
        let claimed = json!({ "id": "j1", "ok": true, "url": "https://example.com/", "text": "admin" });
        assert_eq!(landed_at(claimed.clone(), Some("http://192.168.1.1/admin"))["url"], "http://192.168.1.1/admin");
        assert!(landed_at(claimed, None).get("url").is_none(), "a page that never finished loading says nowhere");
    }

    #[test]
    fn a_pdf_is_known_by_its_name_or_by_where_papers_are_served() {
        assert!(looks_like_pdf("https://example.org/papers/survey.PDF"));
        assert!(looks_like_pdf("https://arxiv.org/pdf/2508.10875"));
        assert!(looks_like_pdf("https://export.arxiv.org/pdf/2508.10875v3"));
        assert!(!looks_like_pdf("https://arxiv.org/abs/2508.10875"));
        assert!(!looks_like_pdf("https://example.org/pdf-tools"));
        assert!(!looks_like_pdf("not an address"));
    }
}
