use std::collections::HashSet;
use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};

use anyhow::Context;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

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
    Chunk(HookStream, String),
    Error(std::io::Error),
}

fn send_decoded(
    pending: &mut Vec<u8>,
    stream: HookStream,
    sender: &mpsc::Sender<ReaderMessage>,
    eof: bool,
) -> bool {
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                if !text.is_empty()
                    && sender
                        .send(ReaderMessage::Chunk(stream, text.to_string()))
                        .is_err()
                {
                    return false;
                }
                pending.clear();
                return true;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                if valid_up_to > 0 {
                    let valid = std::str::from_utf8(&pending[..valid_up_to])
                        .expect("UTF-8 error's valid prefix must be valid");
                    if sender
                        .send(ReaderMessage::Chunk(stream, valid.to_string()))
                        .is_err()
                    {
                        return false;
                    }
                    pending.drain(..valid_up_to);
                    continue;
                }
                match error.error_len() {
                    Some(invalid_length) => {
                        if sender
                            .send(ReaderMessage::Chunk(stream, "\u{fffd}".to_string()))
                            .is_err()
                        {
                            return false;
                        }
                        pending.drain(..invalid_length);
                    }
                    None if eof => {
                        if sender
                            .send(ReaderMessage::Chunk(
                                stream,
                                String::from_utf8_lossy(pending).into_owned(),
                            ))
                            .is_err()
                        {
                            return false;
                        }
                        pending.clear();
                        return true;
                    }
                    None => return true,
                }
            }
        }
    }
}

fn read_stream(mut reader: impl Read, stream: HookStream, sender: mpsc::Sender<ReaderMessage>) {
    let mut buffer = [0_u8; 4096];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                send_decoded(&mut pending, stream, &sender, true);
                break;
            }
            Ok(length) => {
                pending.extend_from_slice(&buffer[..length]);
                if !send_decoded(&mut pending, stream, &sender, false) {
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

pub fn stream_command<R: Runtime>(
    app: &AppHandle<R>,
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

    let stream_result = std::thread::scope(|scope| -> anyhow::Result<()> {
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
                ReaderMessage::Chunk(stream, chunk) => {
                    if let Err(error) = app
                        .emit(
                            OUTPUT_EVENT,
                            HookOutput {
                                repo_path: metadata.repo_path.clone(),
                                run_id: metadata.run_id.clone(),
                                stream,
                                chunk,
                            },
                        )
                        .context("could not emit hook output event")
                    {
                        let _ = child.kill();
                        return Err(error);
                    }
                }
                ReaderMessage::Error(error) => {
                    let _ = child.kill();
                    return Err(error).context("could not stream hook command output");
                }
            }
        }
        Ok(())
    });

    let wait_result = child.wait().context("could not wait for hook command");
    stream_result?;
    let status = wait_result?;
    Ok(Output {
        status,
        stdout: Vec::new(),
        stderr: Vec::new(),
    })
}

pub fn run_commit<R: Runtime>(
    app: &AppHandle<R>,
    repo_path: &std::path::Path,
    run_id: &str,
    message: &str,
    pre_commit_enabled: bool,
) -> anyhow::Result<String> {
    let repo_path_string = repo_path
        .to_str()
        .context("open repository path is not valid UTF-8")?
        .to_string();
    let metadata = HookRunMetadata {
        repo_path: repo_path_string,
        run_id: run_id.to_string(),
        hook: HookName::PreCommit,
        operation: "commit",
    };
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(repo_path)
        .arg("commit")
        .current_dir(repo_path);
    if !pre_commit_enabled {
        command.arg("--no-verify");
    }
    command.arg("-m").arg(message);

    let command_result = stream_command(app, &metadata, command, None);
    let (outcome, exit_code, summary) = match &command_result {
        Ok(output) if output.status.success() => (
            HookOutcome::Succeeded,
            output.status.code(),
            "commit completed",
        ),
        Ok(output) => (
            HookOutcome::Failed,
            output.status.code(),
            "pre-commit failed; review hook output",
        ),
        Err(_) => (
            HookOutcome::Failed,
            None,
            "pre-commit failed; review hook output",
        ),
    };
    app.emit(
        FINISHED_EVENT,
        HookFinished {
            repo_path: metadata.repo_path.clone(),
            run_id: metadata.run_id.clone(),
            hook: HookName::PreCommit,
            outcome,
            exit_code,
            summary: summary.to_string(),
        },
    )
    .context("could not emit hook finished event")?;

    let output = command_result?;
    if !output.status.success() {
        anyhow::bail!("pre-commit failed; review hook output");
    }
    let repo = git2::Repository::open(repo_path).context("could not reopen repository")?;
    let oid = repo
        .head()
        .context("could not resolve HEAD")?
        .peel_to_commit()
        .context("could not resolve HEAD to a commit")?
        .id();
    Ok(oid.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tauri::Listener;

    struct CommitFixture {
        directory: tempfile::TempDir,
    }

    impl CommitFixture {
        fn new() -> Self {
            let fixture = Self {
                directory: tempfile::tempdir().unwrap(),
            };
            fixture.git(&["init"]);
            fixture.git(&["config", "user.name", "Git Wasp Test"]);
            fixture.git(&["config", "user.email", "git-wasp@example.test"]);
            fixture.git(&["config", "core.autocrlf", "false"]);
            fixture.git(&["config", "core.eol", "lf"]);
            fixture.stage("file.txt", "initial\n");
            fixture.git(&["commit", "-m", "initial"]);
            fixture
        }

        fn path(&self) -> &Path {
            self.directory.path()
        }

        fn git_dir(&self) -> std::path::PathBuf {
            self.path().join(".git")
        }

        fn git(&self, args: &[&str]) {
            let output = Command::new("git")
                .arg("-C")
                .arg(self.path())
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }

        fn stage(&self, path: &str, contents: &str) {
            std::fs::write(self.path().join(path), contents).unwrap();
            self.git(&["add", path]);
        }

        #[cfg(unix)]
        fn install_hook(&self, name: &str, contents: &str) {
            use std::os::unix::fs::PermissionsExt;

            let path = self.git_dir().join("hooks").join(name);
            std::fs::write(&path, contents).unwrap();
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(path, permissions).unwrap();
        }

        fn head_oid(&self) -> String {
            let repo = git2::Repository::open(self.path()).unwrap();
            let oid = repo.head().unwrap().peel_to_commit().unwrap().id();
            oid.to_string()
        }

        fn is_staged(&self, path: &str) -> bool {
            let repo = git2::Repository::open(self.path()).unwrap();
            repo.status_file(Path::new(path))
                .unwrap()
                .intersects(git2::Status::INDEX_MODIFIED | git2::Status::INDEX_NEW)
        }

        fn head_file(&self, path: &str) -> String {
            let repo = git2::Repository::open(self.path()).unwrap();
            let commit = repo.head().unwrap().peel_to_commit().unwrap();
            let tree = commit.tree().unwrap();
            let entry = tree.get_path(Path::new(path)).unwrap();
            let blob = repo.find_blob(entry.id()).unwrap();
            String::from_utf8(blob.content().to_vec()).unwrap()
        }
    }

    #[cfg(unix)]
    fn run_commit_for_test(
        repo_path: &Path,
        message: &str,
        pre_commit_enabled: bool,
    ) -> anyhow::Result<String> {
        let app = tauri::test::mock_app();
        run_commit(
            app.handle(),
            repo_path,
            "commit-test",
            message,
            pre_commit_enabled,
        )
    }

    #[cfg(unix)]
    #[test]
    fn native_commit_runs_pre_commit_and_returns_head() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf ran > .git/pre-commit-ran\n",
        );
        let oid = run_commit_for_test(fixture.path(), "run hook", true).unwrap();
        assert_eq!(oid, fixture.head_oid());
        assert_eq!(
            std::fs::read_to_string(fixture.git_dir().join("pre-commit-ran")).unwrap(),
            "ran"
        );
    }

    #[cfg(unix)]
    #[test]
    fn failed_pre_commit_blocks_commit_and_keeps_index() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        let before = fixture.head_oid();
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf 'lint failed\\n' >&2\nexit 7\n",
        );
        assert!(run_commit_for_test(fixture.path(), "blocked", true).is_err());
        assert_eq!(fixture.head_oid(), before);
        assert!(fixture.is_staged("file.txt"));
    }

    #[cfg(unix)]
    #[test]
    fn disabled_pre_commit_uses_no_verify() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "changed\n");
        fixture.install_hook("pre-commit", "#!/bin/sh\nexit 9\n");
        assert!(run_commit_for_test(fixture.path(), "skip hook", false).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn pre_commit_can_change_the_index_before_commit() {
        let fixture = CommitFixture::new();
        fixture.stage("file.txt", "before hook\n");
        fixture.install_hook(
            "pre-commit",
            "#!/bin/sh\nprintf 'from hook\\n' > file.txt\ngit add file.txt\n",
        );
        run_commit_for_test(fixture.path(), "index update", true).unwrap();
        assert_eq!(fixture.head_file("file.txt"), "from hook\n");
    }

    #[test]
    fn invalid_utf8_is_decoded_lossily() {
        assert_eq!(decode_output(&[b'o', b'k', 0xff]), "ok\u{fffd}");
    }

    struct OneByteAtATime {
        bytes: std::vec::IntoIter<u8>,
    }

    impl Read for OneByteAtATime {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            match self.bytes.next() {
                Some(byte) => {
                    buffer[0] = byte;
                    Ok(1)
                }
                None => Ok(0),
            }
        }
    }

    #[test]
    fn stream_decoder_preserves_split_utf8_and_replaces_invalid_and_incomplete_bytes() {
        let (sender, receiver) = mpsc::channel();
        read_stream(
            OneByteAtATime {
                bytes: vec![b'a', 0xe2, 0x82, 0xac, 0xff, 0xe2, 0x82].into_iter(),
            },
            HookStream::Stdout,
            sender,
        );

        let text = receiver
            .into_iter()
            .map(|message| match message {
                ReaderMessage::Chunk(_, chunk) => chunk,
                ReaderMessage::Error(error) => panic!("{error}"),
            })
            .collect::<String>();
        assert_eq!(text, "a€\u{fffd}\u{fffd}");
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

    #[test]
    fn stream_command_child() {
        if std::env::var_os("GIT_WASP_STREAM_COMMAND_CHILD").is_none() {
            return;
        }
        let mut stdin = String::new();
        std::io::stdin().read_to_string(&mut stdin).unwrap();
        println!(
            "cwd={};stdin={stdin};unicode=€",
            std::env::current_dir().unwrap().display()
        );
        eprintln!("stderr=problem");
        std::process::exit(7);
    }

    #[test]
    fn stream_command_runs_in_caller_directory_and_streams_process_io() {
        let app = tauri::test::mock_app();
        let events = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        for event_name in [STARTED_EVENT, OUTPUT_EVENT] {
            let events = Arc::clone(&events);
            app.listen(event_name, move |event| {
                events
                    .lock()
                    .unwrap()
                    .push((event_name.to_string(), event.payload().to_string()));
            });
        }

        let directory = tempfile::tempdir().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .current_dir(directory.path())
            .env("GIT_WASP_STREAM_COMMAND_CHILD", "1")
            .arg("--exact")
            .arg("hook_runner::tests::stream_command_child")
            .arg("--nocapture");
        let metadata = HookRunMetadata {
            repo_path: directory.path().display().to_string(),
            run_id: "integration-run".into(),
            hook: HookName::PreCommit,
            operation: "commit",
        };

        let output = stream_command(
            app.handle(),
            &metadata,
            command,
            Some(b"from-parent".to_vec()),
        )
        .unwrap();

        assert_eq!(output.status.code(), Some(7));
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
        let events = events.lock().unwrap();
        assert_eq!(events[0].0, STARTED_EVENT);
        let output_events = events
            .iter()
            .filter(|(name, _)| name == OUTPUT_EVENT)
            .map(|(_, payload)| serde_json::from_str::<serde_json::Value>(payload).unwrap())
            .collect::<Vec<_>>();
        let stream_text = |stream| {
            output_events
                .iter()
                .filter(|event| event["stream"] == stream)
                .map(|event| event["chunk"].as_str().unwrap())
                .collect::<String>()
        };
        let stdout = stream_text("stdout");
        assert!(stdout.contains(&format!(
            "cwd={}",
            std::fs::canonicalize(directory.path()).unwrap().display()
        )));
        assert!(stdout.contains("stdin=from-parent"));
        assert!(stdout.contains("unicode=€"));
        assert!(stream_text("stderr").contains("stderr=problem"));
    }
}
