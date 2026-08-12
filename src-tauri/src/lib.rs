use std::collections::BTreeMap;
use std::ffi::OsString;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, Runtime};
use tauri::async_runtime::Mutex;

struct PtySession {
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader: Mutex<Box<dyn std::io::Read + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
}

type PtyHandler = u32;

#[derive(Default)]
pub struct TuiState {
    session_id: AtomicU32,
    sessions: tokio::sync::RwLock<BTreeMap<PtyHandler, Arc<PtySession>>>,
}

#[tauri::command]
async fn spawn_tui<R: Runtime>(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    state: tauri::State<'_, TuiState>,
    app_handle: AppHandle<R>,
) -> Result<PtyHandler, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    // Use shell to run the command so PATH is resolved
    let mut cmd = CommandBuilder::new("cmd.exe");
    cmd.args(["/C", &file]);
    cmd.args(&args);
    if let Some(cwd) = cwd {
        cmd.cwd(OsString::from(cwd));
    }
    for (k, v) in env.iter() {
        cmd.env(OsString::from(k), OsString::from(v));
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let handler = state.session_id.fetch_add(1, Ordering::Relaxed);

    let session = Arc::new(PtySession {
        writer: Mutex::new(writer),
        reader: Mutex::new(reader),
        child: Mutex::new(child),
    });

    state.sessions.write().await.insert(handler, session.clone());

    // Spawn reader task to forward PTY output to frontend
    let handle = app_handle.clone();
    let session_clone = session.clone();
    tauri::async_runtime::spawn(async move {
        use std::io::Read;
        let mut buf = [0u8; 8192];
        loop {
            let n = {
                let mut reader = session_clone.reader.lock().await;
                reader.read(&mut buf).unwrap_or(0)
            };
            if n == 0 {
                break;
            }
            let data = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = handle.emit("pty-output", data);
        }
    });

    Ok(handler)
}

#[tauri::command]
async fn write_tui(
    pid: PtyHandler,
    data: String,
    state: tauri::State<'_, TuiState>,
) -> Result<(), String> {
    use std::io::Write;
    let sessions = state.sessions.read().await;
    let session = sessions.get(&pid).ok_or("Session not found")?;
    let mut writer = session.writer.lock().await;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn kill_tui(
    pid: PtyHandler,
    state: tauri::State<'_, TuiState>,
) -> Result<(), String> {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&pid).ok_or("Session not found")?;
    let mut child = session.child.lock().await;
    child.kill().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_pty::init())
        .manage(TuiState::default())
        .invoke_handler(tauri::generate_handler![
            spawn_tui,
            write_tui,
            kill_tui,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
