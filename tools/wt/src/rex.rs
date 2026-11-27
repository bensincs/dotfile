use crate::{Result, worktrees::Worktree};
use serde_json::Value;
use std::{env, path::Path, process::Command};

fn output(args: &[&str]) -> Result<String> {
    let output = Command::new("rex")
        .args(args)
        .output()
        .map_err(|error| format!("rex: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if error.is_empty() {
            format!("rex exited {}", output.status)
        } else {
            error
        });
    }
    String::from_utf8(output.stdout).map_err(|_| "Invalid Rex response".into())
}

fn json(args: &[&str]) -> Result<Value> {
    serde_json::from_str(&output(args)?).map_err(|error| format!("Invalid Rex JSON: {error}"))
}

fn available() -> bool {
    env::var_os("PATH")
        .is_some_and(|paths| env::split_paths(&paths).any(|path| path.join("rex").is_file()))
}

struct Rex {
    session: String,
    block: Option<String>,
}

fn current() -> Result<Option<Rex>> {
    let in_rex = env::var_os("REX_BLOCK").is_some() || env::var_os("REX_SESSION").is_some();
    if !in_rex || !available() {
        return Ok(None);
    }
    // Resolve fresh IDs: inherited session IDs can become stale after panes move.
    let who = json(&["whoami", "--json"])?;
    let session = who["session_id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Rex did not return a session ID")?
        .to_owned();
    let block = who["block_id"].as_str().map(str::to_owned);
    Ok(Some(Rex { session, block }))
}

fn windows(rex: &Rex) -> Result<Vec<Value>> {
    json(&[
        "window",
        "ls",
        "-s",
        &rex.session,
        "--short=false",
        "--json",
    ])?["windows"]
        .as_array()
        .cloned()
        .ok_or_else(|| "Rex did not return a window list".into())
}

fn matching_window(windows: &[Value], label: &str) -> Result<Option<String>> {
    let mut matches = windows
        .iter()
        .filter(|window| window["label"].as_str() == Some(label));
    let found = matches.next();
    if matches.next().is_some() {
        return Err(format!(
            "multiple Rex tabs named '{label}'; resolve the duplicate before continuing"
        ));
    }
    found
        .map(|window| {
            window["window_id"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Rex window has no ID".into())
        })
        .transpose()
}

fn contains_block(value: &Value, block: &str) -> bool {
    match value {
        Value::Object(map) => {
            map.get("block_id").and_then(Value::as_str) == Some(block)
                || map.get("focused_block_id").and_then(Value::as_str) == Some(block)
                || map
                    .get("block_ids")
                    .and_then(Value::as_array)
                    .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(block)))
                || map.values().any(|value| contains_block(value, block))
        }
        Value::Array(values) => values.iter().any(|value| contains_block(value, block)),
        _ => false,
    }
}

pub fn open(tree: &Worktree, focus: bool) -> Result<Option<String>> {
    let Some(rex) = current()? else {
        return Ok(None);
    };
    let label = tree.label();
    let window = if let Some(window) = matching_window(&windows(&rex)?, &label)? {
        window
    } else {
        json(&[
            "window",
            "new",
            "-s",
            &rex.session,
            &label,
            "-c",
            tree.path.to_str().ok_or("Worktree path is not UTF-8")?,
            "--focus=false",
            "--json",
        ])?["window_id"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Rex did not return the new window ID")?
    };
    if focus {
        let session_arg = format!("session_id={}", rex.session);
        let window_arg = format!("window_id={window}");
        if output(&["do", "session.select", &session_arg, &window_arg]).is_err() {
            output(&["focus", "-s", &rex.session, &window])?;
        }
        Ok(Some(format!("switched to Rex tab '{label}'")))
    } else {
        Ok(Some(format!("opened Rex tab '{label}'")))
    }
}

pub fn close(tree: &Worktree) -> Result<Option<String>> {
    let Some(rex) = current()? else {
        return Ok(None);
    };
    let windows = windows(&rex)?;
    let label = tree.label();
    let Some(window) = matching_window(&windows, &label)? else {
        return Ok(None);
    };
    let own = rex
        .block
        .as_deref()
        .and_then(|block| windows.iter().find(|window| contains_block(window, block)));
    // Never close the invoking pane's window, or guess when it cannot be identified.
    let Some(own_id) = own.and_then(|window| window["window_id"].as_str()) else {
        return Ok(None);
    };
    if own_id == window {
        return Ok(None);
    }
    output(&["window", "close", "-s", &rex.session, &window])?;
    Ok(Some(format!("closed Rex tab '{label}'")))
}

// Keep this module's path conversion limited to the display/protocol boundary.
pub fn print_path(path: &Path) {
    println!("{}", path.display());
}
