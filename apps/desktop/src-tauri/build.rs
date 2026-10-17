fn main() {
    // Tauri's default tracking watches tauri.conf.json but not the actual
    // icon files referenced from it. Explicitly tell cargo to rerun this
    // build script (and thus recompile the binary with refreshed embedded
    // resources) whenever any icon changes.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::build()
}
