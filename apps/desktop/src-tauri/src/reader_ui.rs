use std::ffi::{c_char, CString};
use std::sync::atomic::{AtomicBool, Ordering};

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{NSArray, NSError, NSObjectProtocol, NSString};
use objc2_web_kit::{
    WKContentRuleList, WKContentRuleListStore, WKFrameInfo, WKMediaCaptureType, WKPermissionDecision, WKSecurityOrigin, WKUIDelegate,
    WKWebView, WKWebsiteDataStore,
};
use serde_json::{json, Value};

#[link(name = "Network", kind = "framework")]
extern "C" {
    fn nw_endpoint_create_host(hostname: *const c_char, port: *const c_char) -> *mut AnyObject;
    fn nw_proxy_config_create_http_connect(proxy_endpoint: *mut AnyObject, proxy_tls_options: *mut AnyObject) -> *mut AnyObject;
    fn nw_proxy_config_set_username_and_password(proxy_config: *mut AnyObject, username: *const c_char, password: *const c_char);
}
use tauri::WebviewWindow;

/// What a page in the reader may not fetch for itself, its images, scripts and requests included:
/// anything on this machine or the network it sits on.
const NEARBY: &str = include_str!("reader_rules.json");


define_class!(
    // SAFETY: NSObject has no requirements of a subclass, and this one has no Drop and no state.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "KyurenReaderUIDelegate"]
    struct ReaderUIDelegate;

    unsafe impl NSObjectProtocol for ReaderUIDelegate {}

    unsafe impl WKUIDelegate for ReaderUIDelegate {
        #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
        fn media_capture(
            &self,
            _view: &WKWebView,
            _origin: &WKSecurityOrigin,
            _frame: &WKFrameInfo,
            _kind: WKMediaCaptureType,
            decide: &DynBlock<dyn Fn(WKPermissionDecision)>,
        ) {
            decide.call((WKPermissionDecision::Deny,));
        }
    }
);

impl ReaderUIDelegate {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        // SAFETY: NSObject's own init, on an instance just allocated.
        unsafe { msg_send![super(this), init] }
    }
}

/// Whether the reader's own delegate, its rules, its way out and its silence are in place: until
/// all are, no page is loaded in the reader.
static GUARDED: AtomicBool = AtomicBool::new(false);
static FENCED: AtomicBool = AtomicBool::new(false);
static PROXIED: AtomicBool = AtomicBool::new(false);
static SILENCED: AtomicBool = AtomicBool::new(false);

pub fn guarded() -> bool {
    [&GUARDED, &FENCED, &PROXIED, &SILENCED].iter().all(|one| one.load(Ordering::Acquire))
}

/// Sends everything the reader loads through the host's own proxy, which looks each name up and
/// connects only to a public address it found: a name that leads home is refused for a page's every
/// request, not only for those whose address gives it away.
fn proxy_through(store: &WKWebsiteDataStore, port: u16, user: &str, password: &str) -> bool {
    if !store.respondsToSelector(sel!(setProxyConfigurations:)) {
        eprintln!("kyuren reader: this system cannot send the reader through a proxy, so no page will be read");
        return false;
    }
    let (Ok(host), Ok(port), Ok(user), Ok(password)) =
        (CString::new("127.0.0.1"), CString::new(port.to_string()), CString::new(user), CString::new(password))
    else {
        return false;
    };
    // SAFETY: both strings outlive the call, which hands back an endpoint retained for the caller.
    let Some(endpoint) = (unsafe { Retained::from_raw(nw_endpoint_create_host(host.as_ptr(), port.as_ptr())) }) else {
        eprintln!("kyuren reader: the proxy's address could not be made, so no page will be read");
        return false;
    };
    // SAFETY: the endpoint just made, and no TLS to a proxy on this machine; the configuration handed
    // back is retained for the caller.
    let made = unsafe { nw_proxy_config_create_http_connect(Retained::as_ptr(&endpoint).cast_mut(), std::ptr::null_mut()) };
    // SAFETY: as above, the caller's to release.
    let Some(proxy) = (unsafe { Retained::from_raw(made) }) else {
        eprintln!("kyuren reader: the proxy could not be described to WebKit, so no page will be read");
        return false;
    };
    // SAFETY: the configuration just made, and both strings outlive the call, which copies them.
    unsafe { nw_proxy_config_set_username_and_password(Retained::as_ptr(&proxy).cast_mut(), user.as_ptr(), password.as_ptr()) };
    let all = NSArray::from_retained_slice(&[proxy]);
    // SAFETY: the store's setter, from macOS 14, which it said it has, given proxy configurations.
    let _: () = unsafe { msg_send![store, setProxyConfigurations: &*all] };
    true
}

/// The rules, with this machine's own IPv4 addresses added: WebKit sends a page's request for one of
/// them straight there rather than through the proxy, and the fixed rules know only the private ranges.
fn rules() -> String {
    let mut all: Vec<Value> = serde_json::from_str(NEARBY).unwrap_or_default();
    for (address, _) in crate::nearby::networks() {
        if let std::net::IpAddr::V4(own) = address {
            let pattern = format!("^[a-z]+://([^/@]*@)?{}[:/]", own.to_string().replace('.', "\\."));
            all.push(json!({ "trigger": { "url-filter": pattern }, "action": { "type": "block" } }));
        }
    }
    serde_json::to_string(&all).unwrap_or_else(|_| NEARBY.to_string())
}

/// Compiles the rules and adds them to the view for good: they are never lifted, since a page
/// still running while they were off could reach what they keep it from.
fn fence_in(view: &WKWebView, mtm: MainThreadMarker) {
    // SAFETY: on the main thread where the view lives. The configuration handed back is a copy, but
    // the controller in it is the view's own, so what is added to it applies to the view.
    let controller = unsafe { view.configuration().userContentController() };
    // SAFETY: asked for on the main thread, as the store requires.
    let Some(store) = (unsafe { WKContentRuleListStore::defaultStore(mtm) }) else { return };
    let compiled = RcBlock::new(move |rules: *mut WKContentRuleList, failure: *mut NSError| {
        // SAFETY: WebKit hands back a compiled list, or none and why, valid for the call.
        match unsafe { rules.as_ref() } {
            Some(rules) => {
                // SAFETY: a list compiled by the store, added on the main thread the store answers on.
                unsafe { controller.addContentRuleList(rules) };
                FENCED.store(true, Ordering::Release);
            }
            None => {
                // SAFETY: the error WebKit handed back, or none, valid for the call.
                let why = unsafe { failure.as_ref() }.map(|failure| failure.localizedDescription().to_string()).unwrap_or_default();
                eprintln!("kyuren reader: the rules did not compile, so no page will be read: {why}");
            }
        }
    });
    let name = NSString::from_str("kyuren-reader-nearby");
    let rules = NSString::from_str(&rules());
    // SAFETY: both strings are given, and the block is kept alive by the store until it answers.
    unsafe { store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(Some(&name), Some(&rules), Some(&compiled)) };
}

/// WebRTC sends straight to whatever address a page names, past the proxy and the rules, so a page
/// read here is given none: a preference of WebKit's own, asked about before it is set.
fn silence_peers(view: &WKWebView) {
    // SAFETY: the view's own preferences, on the main thread where it lives.
    let preferences = unsafe { view.configuration().preferences() };
    if preferences.respondsToSelector(sel!(_setPeerConnectionEnabled:)) {
        // SAFETY: the setter WebKit says it has, given the value it takes.
        let _: () = unsafe { msg_send![&*preferences, _setPeerConnectionEnabled: false] };
        SILENCED.store(true, Ordering::Release);
    } else {
        eprintln!("kyuren reader: WebRTC could not be turned off for the reader, so no page will be read");
    }
}

/// Answers for the reader in place of the webview's own delegate, which hands the camera and the
/// microphone to any page that asks: a page read here is given neither, nor the new windows and
/// file pickers only the replaced delegate offered.
pub fn guard(window: &WebviewWindow, port: u16, user: &'static str, password: String) -> tauri::Result<()> {
    window.with_webview(move |webview| {
        let Some(mtm) = MainThreadMarker::new() else { return };
        // SAFETY: on macOS the pointer is the webview the runtime retains for its window, a
        // WKWebView subclass, and this runs on the main thread while that window is open.
        let Some(view) = (unsafe { webview.inner().cast::<WKWebView>().as_ref() }) else { return };
        let delegate = ReaderUIDelegate::new(mtm);
        // SAFETY: a WKUIDelegate, set on the main thread, where the view lives.
        unsafe { view.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
        // The view holds its delegate weakly, and the reader lasts as long as the app.
        std::mem::forget(delegate);
        GUARDED.store(true, Ordering::Release);
        // SAFETY: the view's own store, the reader's alone, on the main thread where the view lives.
        let store = unsafe { view.configuration().websiteDataStore() };
        if proxy_through(&store, port, user, &password) {
            PROXIED.store(true, Ordering::Release);
        }
        silence_peers(view);
        fence_in(view, mtm);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::{sel, ClassType, ProtocolType};

    #[test]
    fn the_readers_delegate_is_one_webkit_asks_about_the_camera_and_microphone() {
        let class = ReaderUIDelegate::class();
        let delegate = <dyn WKUIDelegate>::protocol().expect("WebKit knows its own delegate");
        assert!(class.conforms_to(delegate));
        assert!(class.responds_to(sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:)));
        assert!(
            !class.responds_to(sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:)),
            "a page read here opens no windows"
        );
    }
}
