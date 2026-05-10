#[tauri::command]
pub async fn window_toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    // On macOS, some environments/OS versions can crash during the native fullscreen
    // transition (green button / AppKit transition snapshot). To avoid hard crashes,
    // implement a "pseudo fullscreen" that hides decorations and maximizes.
    #[cfg(target_os = "macos")]
    {
        let is_decorated = window
            .is_decorated()
            .map_err(|e| format!("window_is_decorated_failed: {e}"))?;
        let is_maximized = window
            .is_maximized()
            .map_err(|e| format!("window_is_maximized_failed: {e}"))?;

        let next = !(!is_decorated && is_maximized);
        if next {
            window
                .set_decorations(false)
                .map_err(|e| format!("window_set_decorations_failed: {e}"))?;
            window
                .maximize()
                .map_err(|e| format!("window_maximize_failed: {e}"))?;
        } else {
            window
                .unmaximize()
                .map_err(|e| format!("window_unmaximize_failed: {e}"))?;
            window
                .set_decorations(true)
                .map_err(|e| format!("window_set_decorations_failed: {e}"))?;
        }

        return Ok(next);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let is_fullscreen = window
            .is_fullscreen()
            .map_err(|e| format!("window_is_fullscreen_failed: {e}"))?;

        let next = !is_fullscreen;
        window
            .set_fullscreen(next)
            .map_err(|e| format!("window_set_fullscreen_failed: {e}"))?;

        Ok(next)
    }
}
