//! Hyprland (Omarchy) integration for the Linux window.
//!
//! Omarchy binds Super+C/V as universal copy/paste. Windows carrying the `terminal` tag receive
//! Ctrl+Insert/Shift+Insert, which the terminal handles as clipboard chords; every other window
//! receives plain Ctrl+C/V, which a terminal cannot tell apart from a physical interrupt.
//! Tagging this process's own windows keeps Super+C/V terminal-safe without compositor edits.

use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

const TAG: &str = "terminal";
const POLL: Duration = Duration::from_millis(250);
const MAPPING_TIMEOUT: Duration = Duration::from_secs(30);
const TAGGING_ATTEMPTS: u32 = 4;

/// Tags every window of this process as a terminal once Hyprland has mapped it.
/// Does nothing outside a Hyprland session. Failures are logged; the app keeps running.
pub fn mark_windows_as_terminal() {
    if std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_none() {
        return;
    }
    let pid = std::process::id();
    thread::spawn(move || {
        let deadline = Instant::now() + MAPPING_TIMEOUT;
        let mut attempts = 0;
        loop {
            let clients = match hyprctl(&["-j", "clients"]) {
                Ok(json) => json,
                Err(error) => {
                    log::warn!("Hyprland terminal tag skipped: {error}");
                    return;
                }
            };
            let windows = parse_windows(&clients, pid);
            if windows.is_empty() {
                if Instant::now() >= deadline {
                    log::warn!("Hyprland terminal tag skipped: no window for pid {pid}");
                    return;
                }
            } else if windows.iter().all(|window| window.has_tag(TAG)) {
                log::info!("Hyprland window tagged as {TAG}; Super+C/V are terminal-safe");
                return;
            } else if attempts >= TAGGING_ATTEMPTS {
                log::warn!("Hyprland terminal tag failed after {attempts} attempts");
                return;
            } else {
                attempts += 1;
                // Hyprland's Lua-configured builds (0.53+) and older text-configured builds accept
                // different syntax; each rejects the other harmlessly, so try both and verify.
                for command in tag_commands(pid) {
                    let args: Vec<&str> = command.iter().map(String::as_str).collect();
                    if let Err(error) = hyprctl(&args) {
                        log::debug!("hyprctl {} failed: {error}", args.join(" "));
                    }
                }
            }
            thread::sleep(POLL);
        }
    });
}

#[derive(Debug, PartialEq, Eq)]
struct Window {
    tags: Vec<String>,
}

impl Window {
    fn has_tag(&self, tag: &str) -> bool {
        // Tags set at runtime are reported with a trailing "*".
        self.tags
            .iter()
            .any(|item| item.trim_end_matches('*') == tag)
    }
}

/// Windows owned by `pid` from `hyprctl -j clients` output.
fn parse_windows(clients: &str, pid: u32) -> Vec<Window> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(clients)
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter(|item| item.get("pid").and_then(serde_json::Value::as_u64) == Some(u64::from(pid)))
        .map(|item| Window {
            tags: item
                .get("tags")
                .and_then(serde_json::Value::as_array)
                .map(|tags| {
                    tags.iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect()
}

/// `hyprctl` argument lists that add the terminal tag to every window of `pid`.
fn tag_commands(pid: u32) -> [Vec<String>; 2] {
    [
        vec![
            "dispatch".into(),
            format!("hl.dsp.window.tag({{ tag = \"+{TAG}\", window = \"pid:{pid}\" }})"),
        ],
        vec![
            "dispatch".into(),
            "tagwindow".into(),
            format!("+{TAG} pid:{pid}"),
        ],
    ]
}

fn hyprctl(args: &[&str]) -> Result<String, String> {
    let output = Command::new("hyprctl")
        .args(args)
        .output()
        .map_err(|error| format!("could not run hyprctl: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() || stdout.trim_start().starts_with("error") {
        return Err(format!(
            "hyprctl {}: {}",
            args.join(" "),
            stdout.lines().next().unwrap_or("no output")
        ));
    }
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLIENTS: &str = r#"[
      {"address":"0x1","pid":42,"class":"concors-desktop","tags":["default-opacity*"]},
      {"address":"0x2","pid":7,"class":"foot","tags":["terminal*"]},
      {"address":"0x3","pid":42,"class":"concors-desktop","tags":["default-opacity*","terminal"]}
    ]"#;

    #[test]
    fn selects_windows_by_pid() {
        let windows = parse_windows(CLIENTS, 42);
        assert_eq!(windows.len(), 2);
        assert!(!windows[0].has_tag(TAG));
        assert!(windows[1].has_tag(TAG));
        assert!(parse_windows(CLIENTS, 1).is_empty());
        assert!(parse_windows("not json", 42).is_empty());
    }

    #[test]
    fn runtime_tags_match_without_their_marker() {
        let window = Window {
            tags: vec!["terminal*".into()],
        };
        assert!(window.has_tag(TAG));
        assert!(!window.has_tag("terminals"));
    }

    #[test]
    fn tag_commands_target_the_process() {
        let [lua, legacy] = tag_commands(42);
        assert_eq!(
            lua,
            vec![
                "dispatch",
                "hl.dsp.window.tag({ tag = \"+terminal\", window = \"pid:42\" })"
            ]
        );
        assert_eq!(legacy, vec!["dispatch", "tagwindow", "+terminal pid:42"]);
    }
}
