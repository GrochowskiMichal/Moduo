use std::time::Duration;

use moduo_tokens::{Appearance, Tokens};
use moduo_ui::motion::{spec, Pattern};

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

#[test]
fn reduced_motion_turns_movement_into_a_fade() {
    let tokens = Tokens::load();
    let full = tokens.resolve(&Appearance::default());
    let reduced = tokens.resolve(&Appearance::default().with("motion", "reduced"));

    // A popover grows from 0.96 over --motion-base and fades in over --motion-fade (global.css).
    let pop = spec(Pattern::Pop, &full);
    assert_eq!((pop.movement, pop.fade, pop.scale_from), (ms(180), ms(100), 0.96));
    let pop = spec(Pattern::Pop, &reduced);
    assert_eq!((pop.movement, pop.fade, pop.scale_from, pop.shift_from), (ms(0), ms(80), 1.0, 0.0));

    // A panel slides --motion-shift over --motion-slow; reduced, it only fades.
    let panel = spec(Pattern::Panel, &full);
    assert_eq!((panel.movement, panel.shift_from), (ms(280), 8.0));
    let panel = spec(Pattern::Panel, &reduced);
    assert_eq!((panel.movement, panel.shift_from, panel.fade), (ms(0), 0.0, ms(80)));

    // A view switch is all opacity: --motion-slow, or the short fade when reduced.
    assert_eq!(spec(Pattern::View, &full).fade, ms(280));
    assert_eq!(spec(Pattern::View, &reduced).fade, ms(80));

    // A keyed change fades on --motion-fast, which is zero when reduced: nothing fades.
    assert_eq!(spec(Pattern::Key, &full).fade, ms(100));
    assert_eq!(spec(Pattern::Key, &reduced).fade, ms(0));
}
