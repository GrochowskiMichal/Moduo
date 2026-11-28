use std::io::Read;

use moduo_app::instance::{claim, Claim};

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("moduo-instance-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn a_second_launch_hands_over_to_the_first_and_exits() {
    let dir = scratch("handover");
    let Claim::First(listener) = claim(&dir).unwrap() else { panic!("the first launch must own the app") };
    assert!(matches!(claim(&dir).unwrap(), Claim::Second));
    let (mut stream, _) = listener.accept().unwrap();
    let mut message = String::new();
    stream.read_to_string(&mut message).unwrap();
    assert_eq!(message.trim(), "activate");
}

#[test]
fn a_socket_left_by_a_crash_is_taken_over() {
    let dir = scratch("stale");
    {
        let Claim::First(_listener) = claim(&dir).unwrap() else { panic!() };
        // Dropped without cleaning up, as a crash would leave it.
    }
    assert!(dir.join("instance.sock").exists());
    assert!(matches!(claim(&dir).unwrap(), Claim::First(_)));
}
