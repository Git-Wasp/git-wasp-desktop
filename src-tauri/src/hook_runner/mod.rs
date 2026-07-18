use std::collections::HashSet;
use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use anyhow::Context;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const STARTED_EVENT: &str = "git-hook://started";
pub const OUTPUT_EVENT: &str = "git-hook://output";
pub const FINISHED_EVENT: &str = "git-hook://finished";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HookName {
    PreCommit,
    PrePush,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HookOutcome {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HookStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone)]
pub struct HookRunMetadata {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub operation: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStarted {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub operation: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookOutput {
    pub repo_path: String,
    pub run_id: String,
    pub stream: HookStream,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookFinished {
    pub repo_path: String,
    pub run_id: String,
    pub hook: HookName,
    pub outcome: HookOutcome,
    pub exit_code: Option<i32>,
    pub summary: String,
}

static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);
static PROCESS_RUN_PREFIX: OnceLock<String> = OnceLock::new();

fn next_run_id() -> String {
    let prefix = PROCESS_RUN_PREFIX.get_or_init(|| {
        let started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("{}-{started}", std::process::id())
    });
    let sequence = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{sequence}")
}

#[derive(Clone, Default)]
pub struct RunRegistry {
    active: Arc<Mutex<HashSet<String>>>,
}

impl RunRegistry {
    pub fn begin(&self, repo_path: &str) -> anyhow::Result<HookRunGuard> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| anyhow::anyhow!("hook run registry lock poisoned"))?;
        if !active.insert(repo_path.to_string()) {
            anyhow::bail!("a hook-aware operation is already running for this repository");
        }
        Ok(HookRunGuard {
            active: Arc::clone(&self.active),
            repo_path: repo_path.to_string(),
            run_id: next_run_id(),
        })
    }
}

#[derive(Debug)]
pub struct HookRunGuard {
    active: Arc<Mutex<HashSet<String>>>,
    repo_path: String,
    run_id: String,
}

impl HookRunGuard {
    pub fn run_id(&self) -> &str {
        &self.run_id
    }
}

impl Drop for HookRunGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.repo_path);
        }
    }
}

fn decode_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

enum ReaderMessage {
    Chunk(HookStream, Vec<u8>),
    Error(std::io::Error),
}

fn read_stream(mut reader: impl Read, stream: HookStream, sender: mpsc::Sender<ReaderMessage>) {
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(length) => {
                if sender
                    .send(ReaderMessage::Chunk(stream, buffer[..length].to_vec()))
                    .is_err()
                {
                    break;
                }
            }
            Err(error) => {
                let _ = sender.send(ReaderMessage::Error(error));
                break;
            }
        }
    }
}

pub fn stream_command(
    app: &AppHandle,
    metadata: &HookRunMetadata,
    mut command: Command,
    stdin: Option<Vec<u8>>,
) -> anyhow::Result<Output> {
    app.emit(
        STARTED_EVENT,
        HookStarted {
            repo_path: metadata.repo_path.clone(),
            run_id: metadata.run_id.clone(),
            hook: metadata.hook,
            operation: metadata.operation,
        },
    )
    .context("could not emit hook started event")?;

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin.is_some() {
        command.stdin(Stdio::piped());
    }
    let mut child = command.spawn().context("could not start hook command")?;
    let stdout = child
        .stdout
        .take()
        .context("hook command stdout was not piped")?;
    let stderr = child
        .stderr
        .take()
        .context("hook command stderr was not piped")?;
    let child_stdin = child.stdin.take();
    let (sender, receiver) = mpsc::channel();

    std::thread::scope(|scope| -> anyhow::Result<()> {
        let stdout_sender = sender.clone();
        scope.spawn(move || read_stream(stdout, HookStream::Stdout, stdout_sender));
        let stderr_sender = sender.clone();
        scope.spawn(move || read_stream(stderr, HookStream::Stderr, stderr_sender));
        if let (Some(mut child_stdin), Some(input)) = (child_stdin, stdin) {
            let stdin_sender = sender.clone();
            scope.spawn(move || {
                if let Err(error) = child_stdin.write_all(&input) {
                    let _ = stdin_sender.send(ReaderMessage::Error(error));
                }
            });
        }
        drop(sender);

        for message in receiver {
            match message {
                ReaderMessage::Chunk(stream, bytes) => app
                    .emit(
                        OUTPUT_EVENT,
                        HookOutput {
                            repo_path: metadata.repo_path.clone(),
                            run_id: metadata.run_id.clone(),
                            stream,
                            chunk: decode_output(&bytes),
                        },
                    )
                    .context("could not emit hook output event")?,
                ReaderMessage::Error(error) => {
                    return Err(error).context("could not stream hook command output")
                }
            }
        }
        Ok(())
    })?;

    let status = child.wait().context("could not wait for hook command")?;
    Ok(Output {
        status,
        stdout: Vec::new(),
        stderr: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_utf8_is_decoded_lossily() {
        assert_eq!(decode_output(&[b'o', b'k', 0xff]), "ok\u{fffd}");
    }

    #[test]
    fn a_repository_cannot_start_two_hook_runs() {
        let registry = RunRegistry::default();
        let first = registry.begin("/tmp/a").unwrap();
        assert_eq!(
            registry.begin("/tmp/a").unwrap_err().to_string(),
            "a hook-aware operation is already running for this repository"
        );
        assert!(registry.begin("/tmp/b").is_ok());
        drop(first);
        assert!(registry.begin("/tmp/a").is_ok());
    }

    #[test]
    fn hook_run_ids_are_unique() {
        let registry = RunRegistry::default();
        let first_id = registry.begin("/tmp/a").unwrap().run_id().to_string();
        let second_id = registry.begin("/tmp/b").unwrap().run_id().to_string();
        assert_ne!(first_id, second_id);
    }

    #[test]
    fn event_payloads_match_the_frontend_contract() {
        let started = HookStarted {
            repo_path: "/tmp/a".into(),
            run_id: "run-1".into(),
            hook: HookName::PreCommit,
            operation: "commit",
        };
        assert_eq!(
            serde_json::to_value(started).unwrap(),
            serde_json::json!({
                "repoPath": "/tmp/a",
                "runId": "run-1",
                "hook": "pre-commit",
                "operation": "commit"
            })
        );

        let output = HookOutput {
            repo_path: "/tmp/a".into(),
            run_id: "run-1".into(),
            stream: HookStream::Stderr,
            chunk: "problem".into(),
        };
        assert_eq!(
            serde_json::to_value(output).unwrap(),
            serde_json::json!({
                "repoPath": "/tmp/a",
                "runId": "run-1",
                "stream": "stderr",
                "chunk": "problem"
            })
        );

        let finished = HookFinished {
            repo_path: "/tmp/a".into(),
            run_id: "run-1".into(),
            hook: HookName::PrePush,
            outcome: HookOutcome::Failed,
            exit_code: Some(9),
            summary: "pre-push failed".into(),
        };
        assert_eq!(
            serde_json::to_value(finished).unwrap(),
            serde_json::json!({
                "repoPath": "/tmp/a",
                "runId": "run-1",
                "hook": "pre-push",
                "outcome": "failed",
                "exitCode": 9,
                "summary": "pre-push failed"
            })
        );
    }
}
