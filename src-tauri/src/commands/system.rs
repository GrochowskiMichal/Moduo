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
