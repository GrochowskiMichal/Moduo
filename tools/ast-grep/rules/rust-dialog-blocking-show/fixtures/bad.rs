// Pre-fix shapes: every `@flag` line must be reported.
fn confirm_quit(app: &AppHandle) -> bool {
    // @flag
    app.dialog().message("Quit Moduo?").blocking_show()
}
