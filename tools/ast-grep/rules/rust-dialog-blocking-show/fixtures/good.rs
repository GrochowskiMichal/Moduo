// Fixed shapes: nothing here may be reported.
fn confirm_quit(app: &AppHandle) {
    app.dialog().message("Quit Moduo?").show(|confirmed| {
        if confirmed {
            quit();
        }
    });
}
