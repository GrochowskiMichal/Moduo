use std::collections::HashMap;

use moduo_config::backend::{resolve, Baked, ConfigError, Sources};

fn sources<'a>(
    args: &'a [&'a str],
    env: &'a HashMap<&'a str, &'a str>,
    files: &'a HashMap<&'a str, &'a str>,
    baked: Baked,
) -> Sources<'a> {
    Sources {
        args,
        env: Box::new(move |k| env.get(k).map(|v| v.to_string())),
        file: Box::new(move |name| files.get(name).map(|v| v.to_string())),
        baked,
    }
}

const BAKED: Baked = Baked {
    url: Some("https://baked.supabase.co"),
    key: Some("sb_publishable_baked"),
};

#[test]
fn env_wins_then_the_env_file_then_the_baked_value() {
    let env = HashMap::from([
        ("PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321/"),
        ("PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_env"),
    ]);
    let file = HashMap::from([(".env.local", "PUBLIC_SUPABASE_URL=https://file.supabase.co\nPUBLIC_SUPABASE_PUBLISHABLE_KEY=\"sb_publishable_file\"\n")]);
    let none = HashMap::new();

    let b = resolve(&sources(&[], &env, &file, BAKED)).unwrap();
    assert_eq!(
        (b.url.as_str(), b.publishable_key.as_str()),
        ("http://127.0.0.1:54321", "sb_publishable_env")
    );
    assert!(!b.is_cloud());

    let b = resolve(&sources(&[], &none, &file, BAKED)).unwrap();
    assert_eq!(
        (b.url.as_str(), b.publishable_key.as_str()),
        ("https://file.supabase.co", "sb_publishable_file")
    );
    assert!(b.is_cloud());

    let b = resolve(&sources(&[], &none, &none, BAKED)).unwrap();
    assert_eq!(b.url, "https://baked.supabase.co");

    let nothing = Baked {
        url: None,
        key: None,
    };
    assert!(matches!(
        resolve(&sources(&[], &none, &none, nothing)),
        Err(ConfigError::NoUrl)
    ));
}

#[test]
fn the_moduo_names_win_over_the_public_ones() {
    let env = HashMap::from([
        ("MODUO_SUPABASE_URL", "http://localhost:54321"),
        ("PUBLIC_SUPABASE_URL", "https://other.supabase.co"),
        ("MODUO_SUPABASE_PUBLISHABLE_KEY", "a"),
    ]);
    let none = HashMap::new();
    let b = resolve(&sources(&[], &env, &none, BAKED)).unwrap();
    assert_eq!(b.url, "http://localhost:54321");
}

#[test]
fn the_cloud_flag_is_refused_without_its_env_file() {
    let env = HashMap::from([("PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")]);
    let none = HashMap::new();
    assert!(matches!(
        resolve(&sources(&["--cloud"], &env, &none, BAKED)),
        Err(ConfigError::NoCloudFile)
    ));
}

#[test]
fn the_cloud_file_wins_over_a_local_shell() {
    let env = HashMap::from([
        ("PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"),
        ("PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local"),
    ]);
    let file = HashMap::from([(".env.cloud.local", "export PUBLIC_SUPABASE_URL=https://prod.supabase.co\nPUBLIC_SUPABASE_PUBLISHABLE_KEY=cloud\n")]);
    let b = resolve(&sources(&["--cloud"], &env, &file, BAKED)).unwrap();
    assert_eq!(
        (b.url.as_str(), b.publishable_key.as_str()),
        ("https://prod.supabase.co", "cloud")
    );
    assert!(b.is_cloud());
    assert!(b.label().contains("production"));
}
