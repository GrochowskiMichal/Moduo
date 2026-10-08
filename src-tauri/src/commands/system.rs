use tauri::State;

use crate::AppState;

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("empty_url".to_string());
    }

    let lower = trimmed.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("unsupported_url_scheme".to_string());
    }

    webbrowser::open(trimmed)
        .map(|_| ())
        .map_err(|e| format!("open_external_url_failed: {e}"))
}

/// Mirror the webview-only `confirmBeforeQuit` preference into Rust `AppState` so the
/// native quit handlers in lib.rs (the custom Quit menu item for ⌘Q and the window
/// `CloseRequested` handler) can read it synchronously. The webview pushes this on boot
/// and on every toggle (see `useConfirmBeforeQuit`). DF-19f-quit.
#[tauri::command]
pub fn set_confirm_before_quit(state: State<'_, AppState>, value: bool) -> Result<(), String> {
    *state
        .confirm_before_quit
        .lock()
        .map_err(|_| "confirm_before_quit_lock_poisoned".to_string())? = value;
    Ok(())
}
