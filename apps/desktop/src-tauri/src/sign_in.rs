//! One-shot loopback receiver for signing in through the system browser (RFC 8252 §7.3).
//!
//! The control plane redirects the browser to `http://127.0.0.1:<port>/callback?code=…` once the
//! user has signed in. Receiving it here, rather than polling the API, means only the machine that
//! started sign-in can ever see the code. The code alone is still worthless: redeeming it needs the
//! PKCE verifier the webview kept, so a page that injects its own code into this port gets nothing.
//!
//! Only transport lives here. The verifier, the exchange and the session belong to the web frontend.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const EVENT: &str = "native-sign-in";
/// Matches the API's attempt lifetime: long enough for GitHub consent and a two-factor prompt.
const WAIT: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
pub struct SignInListener {
    /// Starting a new attempt supersedes the previous one, whose receiver then stops listening.
    current: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInAttempt {
    attempt: u64,
    port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CallbackResult {
    Code { code: String },
    Error { error: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallbackEvent {
    attempt: u64,
    result: CallbackResult,
}

#[tauri::command]
pub fn start_sign_in_listener(
    app: AppHandle,
    listener: State<'_, SignInListener>,
) -> Result<SignInAttempt, String> {
    // Loopback only: binding to all interfaces would expose the port to the local network.
    let socket = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = socket.local_addr().map_err(|e| e.to_string())?.port();
    socket.set_nonblocking(true).map_err(|e| e.to_string())?;
    let attempt = listener.current.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || {
        let current = || app.state::<SignInListener>().current.load(Ordering::SeqCst) == attempt;
        let Some(result) = receive(&socket, Instant::now() + WAIT, current) else {
            return;
        };
        let _ = app.emit(EVENT, CallbackEvent { attempt, result });
        // The browser has the foreground now; bring Concors back so sign-in visibly finishes.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    });
    Ok(SignInAttempt { attempt, port })
}

#[tauri::command]
pub fn cancel_sign_in_listener(listener: State<'_, SignInListener>) {
    listener.current.fetch_add(1, Ordering::SeqCst);
}

/// Serves the listener until a `/callback` request arrives, the deadline passes, or the attempt is
/// superseded. Anything else the browser asks for (a favicon, say) gets a 404 and is ignored.
fn receive(
    socket: &TcpListener,
    deadline: Instant,
    still_current: impl Fn() -> bool,
) -> Option<CallbackResult> {
    while Instant::now() < deadline && still_current() {
        match socket.accept() {
            Ok((stream, _)) => {
                if let Some(result) = handle(stream) {
                    return Some(result);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => return None,
        }
    }
    None
}

fn handle(mut stream: TcpStream) -> Option<CallbackResult> {
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut request_line = String::new();
    BufReader::new(&stream).read_line(&mut request_line).ok()?;

    let Some(query) = callback_query(&request_line) else {
        respond(&mut stream, "404 Not Found", "Not found");
        return None;
    };
    let result = parse_callback(query);
    let body = match result {
        CallbackResult::Code { .. } => "You are signed in to Concors. You can close this tab.",
        CallbackResult::Error { .. } => "Sign-in did not complete. Return to Concors for details.",
    };
    respond(&mut stream, "200 OK", body);
    Some(result)
}

/// The query string of `GET /callback?… HTTP/1.1`, or `None` for any other request.
fn callback_query(request_line: &str) -> Option<&str> {
    let mut parts = request_line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    (path == "/callback").then_some(query)
}

/// Accepts only the shapes the API produces, so nothing unexpected reaches the webview.
fn parse_callback(query: &str) -> CallbackResult {
    let value = |name: &str| {
        query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value)
    };
    if let Some(code) = value("code").filter(|code| is_token(code)) {
        return CallbackResult::Code {
            code: code.to_string(),
        };
    }
    let error = value("error")
        .filter(|error| {
            (1..=64).contains(&error.len())
                && error.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        })
        .unwrap_or("sign_in_failed");
    CallbackResult::Error {
        error: error.to_string(),
    }
}

/// 256 random bits in base64url, as minted by the API.
fn is_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn respond(stream: &mut TcpStream, status: &str, message: &str) {
    // Fixed text only: nothing from the request is reflected into the page.
    let body = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Concors</title>\
<style>:root{{color-scheme:light dark;font-family:system-ui,sans-serif}}body{{margin:0;min-height:100vh;\
display:grid;place-items:center}}p{{max-width:420px;margin:24px;text-align:center;line-height:1.6}}</style>\
</head><body><p>{message}</p></body></html>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    const CODE: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";

    fn request(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    fn listen() -> (TcpListener, u16) {
        let socket = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        socket.set_nonblocking(true).unwrap();
        let port = socket.local_addr().unwrap().port();
        (socket, port)
    }

    #[test]
    fn delivers_the_code_and_ignores_unrelated_requests() {
        let (socket, port) = listen();
        let browser = std::thread::spawn(move || {
            let favicon = request(port, "/favicon.ico");
            let callback = request(port, &format!("/callback?code={CODE}"));
            (favicon, callback)
        });
        let result = receive(&socket, Instant::now() + Duration::from_secs(5), || true);
        let (favicon, callback) = browser.join().unwrap();

        assert_eq!(result, Some(CallbackResult::Code { code: CODE.into() }));
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(callback.starts_with("HTTP/1.1 200"));
        assert!(callback.contains("Cache-Control: no-store"));
    }

    #[test]
    fn reports_known_errors_and_never_reflects_input() {
        assert_eq!(
            parse_callback("error=account_not_linked"),
            CallbackResult::Error {
                error: "account_not_linked".into()
            }
        );
        for hostile in [
            "error=%3Cscript%3E",
            "error=<script>",
            "code=too-short",
            "code=../../etc",
            "",
        ] {
            assert_eq!(
                parse_callback(hostile),
                CallbackResult::Error {
                    error: "sign_in_failed".into()
                },
                "{hostile}"
            );
        }
    }

    #[test]
    fn only_a_get_to_the_callback_path_counts() {
        assert_eq!(
            callback_query("GET /callback?code=x HTTP/1.1\r\n"),
            Some("code=x")
        );
        assert_eq!(callback_query("POST /callback?code=x HTTP/1.1\r\n"), None);
        assert_eq!(callback_query("GET /callbackx?code=x HTTP/1.1\r\n"), None);
        assert_eq!(callback_query("GET /other HTTP/1.1\r\n"), None);
    }

    #[test]
    fn a_superseded_attempt_stops_listening() {
        let (socket, _) = listen();
        let started = Instant::now();
        let result = receive(&socket, Instant::now() + Duration::from_secs(30), || false);
        assert_eq!(result, None);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
