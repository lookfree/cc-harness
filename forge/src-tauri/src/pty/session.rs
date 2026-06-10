use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Maximum bytes retained in the pre-live output buffer (256 KB).
const BUFFER_CAP: usize = 256 * 1024;

/// A single PTY session: owns the master pty, child process, and writer.
pub struct PtySession {
    pub id: String,
    pub tool: String,
    pub working_dir: PathBuf,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>,
    /// Set to true once the frontend is ready to receive events.
    live: Arc<AtomicBool>,
    /// Bytes buffered while live==false, guarded by the same Mutex used in
    /// the reader thread so that the live→drain transition is atomic.
    buffer: Arc<Mutex<Vec<u8>>>,
}

impl PtySession {
    /// Spawn a PTY session running `program` in `working_dir`.
    ///
    /// `on_output` is called from a reader thread with each chunk of bytes
    /// read from the pty master. `on_exit` is called once the reader thread
    /// exits (child process exited or pty closed).
    ///
    /// Output is buffered internally until `replay()` is called, at which
    /// point the buffer is drained and returned, and all subsequent output
    /// flows directly through `on_output`.
    pub fn spawn(
        id: &str,
        tool: &str,
        program: &str,
        working_dir: &str,
        env_vars: Vec<(String, String)>,
        extra_args: Option<Vec<String>>,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl Fn() + Send + 'static,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        let mut cmd = CommandBuilder::new(program);
        cmd.cwd(working_dir);

        // Inject custom env vars from the database
        for (k, v) in env_vars {
            cmd.env(k, v);
        }

        // Append extra args (e.g. --resume <sessionId>)
        if let Some(args) = extra_args {
            for arg in args {
                cmd.arg(arg);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn failed: {e}"))?;

        let killer = child.clone_killer();

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer failed: {e}"))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_reader failed: {e}"))?;

        let live = Arc::new(AtomicBool::new(false));
        let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

        let live_thread = Arc::clone(&live);
        let buffer_thread = Arc::clone(&buffer);

        // Reader thread: read 4KB chunks.
        // While live==false, bytes are appended to the buffer.
        // Once live==true, bytes are forwarded through on_output.
        // The check+action is done under the buffer Mutex so that the
        // replay() transition (lock buffer → set live → drain) is atomic.
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        // Lock buffer to make the live check + action atomic
                        // with respect to replay().
                        let mut guard = buffer_thread.lock().unwrap();
                        if live_thread.load(Ordering::Acquire) {
                            // Already live — drop the lock before calling
                            // the potentially-blocking on_output callback.
                            drop(guard);
                            on_output(chunk);
                        } else {
                            // Not yet live — append to buffer (cap at 256 KB).
                            if guard.len() + chunk.len() > BUFFER_CAP {
                                // Drop oldest bytes to make room.
                                let excess = guard.len() + chunk.len() - BUFFER_CAP;
                                guard.drain(..excess);
                            }
                            guard.extend_from_slice(&chunk);
                        }
                    }
                }
            }
            on_exit();
        });

        Ok(PtySession {
            id: id.to_string(),
            tool: tool.to_string(),
            working_dir: PathBuf::from(working_dir),
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            killer: Arc::new(Mutex::new(killer)),
            live,
            buffer,
        })
    }

    /// Mark the session as live, drain and return the pre-live buffer as a
    /// UTF-8-lossy string, and clear the buffer.
    ///
    /// Subsequent output flows directly through the `on_output` callback.
    /// This operation is atomic with respect to the reader thread's live check.
    pub fn replay(&self) -> String {
        let mut guard = self.buffer.lock().unwrap();
        // Set live under the buffer lock so the reader thread cannot sneak in
        // a buffer append between the drain and the live flag flip.
        self.live.store(true, Ordering::Release);
        let bytes = std::mem::take(&mut *guard);
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// Write data to the pty stdin.
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        self.writer
            .lock()
            .map_err(|e| format!("writer lock poisoned: {e}"))?
            .write_all(data)
            .map_err(|e| format!("write failed: {e}"))
    }

    /// Resize the terminal window.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .map_err(|e| format!("master lock poisoned: {e}"))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("resize failed: {e}"))
    }

    /// Kill the child process.
    pub fn kill(&self) -> Result<(), String> {
        self.killer
            .lock()
            .map_err(|e| format!("killer lock poisoned: {e}"))?
            .kill()
            .map_err(|e| format!("kill failed: {e}"))
    }
}

use std::io::Read;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::Duration;

    #[test]
    fn test_spawn_sh_echo() {
        // Test (a): spawn sh -c "echo forge-pty-test" and assert output contains "forge-pty-test"
        let working_dir = std::env::temp_dir().to_string_lossy().to_string();
        let collected: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let exited: Arc<(Mutex<bool>, Condvar)> = Arc::new((Mutex::new(false), Condvar::new()));

        let collected_clone = Arc::clone(&collected);
        let exited_clone = Arc::clone(&exited);

        let session = PtySession::spawn(
            "test-echo",
            "test-tool",
            "sh",
            &working_dir,
            vec![],
            None,
            move |bytes| {
                collected_clone.lock().unwrap().extend_from_slice(&bytes);
            },
            move || {
                let (lock, cvar) = &*exited_clone;
                *lock.lock().unwrap() = true;
                cvar.notify_all();
            },
        )
        .expect("spawn should succeed");

        // Mark live so output flows through on_output
        session.replay();

        // Write the echo command
        session
            .write(b"echo forge-pty-test\r")
            .expect("write should succeed");
        // Send exit
        session.write(b"exit\r").expect("write exit should succeed");

        // Wait for exit
        let (lock, cvar) = &*exited;
        let _ = cvar
            .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(5), |done| !*done)
            .unwrap();

        let output = String::from_utf8_lossy(&collected.lock().unwrap()).to_string();
        assert!(
            output.contains("forge-pty-test"),
            "expected 'forge-pty-test' in output, got: {output:?}"
        );
    }

    #[test]
    fn test_write_resize_kill_no_panic() {
        // Test (b): write/resize/kill APIs don't panic on a live sh session
        let working_dir = std::env::temp_dir().to_string_lossy().to_string();

        let session = PtySession::spawn(
            "test-rk",
            "test-tool",
            "sh",
            &working_dir,
            vec![],
            None,
            |_| {},
            || {},
        )
        .expect("spawn should succeed");

        // Write should not panic
        session.write(b"echo hello\r").expect("write should succeed");

        // Resize should not panic
        session
            .resize(100, 40)
            .expect("resize should succeed");

        // Kill should not panic
        session.kill().expect("kill should succeed");
    }

    #[test]
    fn test_replay_captures_early_output() {
        // Spawn a short-lived process, wait for output to land in buffer
        // (live==false), then call replay() and assert the output is returned.
        let working_dir = std::env::temp_dir().to_string_lossy().to_string();

        // Collect any post-replay output separately
        let post_replay: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let exited: Arc<(Mutex<bool>, Condvar)> = Arc::new((Mutex::new(false), Condvar::new()));

        let post_clone = Arc::clone(&post_replay);
        let exited_clone = Arc::clone(&exited);

        let session = PtySession::spawn(
            "test-replay",
            "test-tool",
            "sh",
            &working_dir,
            vec![],
            None,
            move |bytes| {
                post_clone.lock().unwrap().extend_from_slice(&bytes);
            },
            move || {
                let (lock, cvar) = &*exited_clone;
                *lock.lock().unwrap() = true;
                cvar.notify_all();
            },
        )
        .expect("spawn should succeed");

        // Write the command immediately (output will be buffered, live==false)
        session
            .write(b"echo early-bytes\r")
            .expect("write should succeed");

        // Sleep ~300 ms to let the output land in the buffer
        std::thread::sleep(Duration::from_millis(300));

        // replay() should return the buffered bytes and flip live=true
        let backlog = session.replay();
        assert!(
            backlog.contains("early-bytes"),
            "expected 'early-bytes' in replay backlog, got: {backlog:?}"
        );

        // Now exit and wait — any remaining output flows via on_output
        session.write(b"exit\r").expect("write exit should succeed");

        let (lock, cvar) = &*exited;
        let _ = cvar
            .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(5), |done| !*done)
            .unwrap();
    }
}
