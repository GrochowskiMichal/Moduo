use moduo_tokens::{Appearance, Token};
use moduo_ui::gpui::{self, div, prelude::*, Context, TestAppContext, Window};
use moduo_ui::theme;

/// A control-height box: what every control row sizes itself by.
struct Probe;

impl Render for Probe {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .debug_selector(|| "probe".into())
            .w(theme::px(cx, Token::CtrlH))
            .h(theme::px(cx, Token::CtrlH))
    }
}

#[gpui::test]
fn a_density_switch_re_lays_every_primitive(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let (_view, cx) = cx.add_window_view(|_, _| Probe);
    cx.run_until_parked();
    let comfortable = cx.debug_bounds("probe").expect("probe drawn").size.height;

    cx.update(|_, cx| theme::set_appearance(cx, Appearance::default().with("density", "dense")));
    cx.run_until_parked();
    let dense = cx.debug_bounds("probe").expect("probe drawn").size.height;

    // --ctrl-h is 2rem at comfortable (tokens.css).
    assert_eq!(f32::from(comfortable), 32.0);
    assert!(
        dense < comfortable,
        "dense {dense:?} is not smaller than {comfortable:?}"
    );
    assert_eq!(
        cx.update(|_, cx| theme::appearance(cx).attr("density").map(str::to_owned)),
        Some("dense".into())
    );
}

#[gpui::test]
fn switching_the_appearance_re_themes_the_component_library(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    cx.update(|cx| {
        let (background, foreground) = moduo_ui::window_colors(cx);
        assert_eq!(background, theme::color(cx, Token::Background));
        assert_eq!(foreground, theme::color(cx, Token::Foreground));

        theme::set_appearance(cx, Appearance::default().with("theme", "light"));
        let (light_background, _) = moduo_ui::window_colors(cx);
        assert_eq!(light_background, theme::color(cx, Token::Background));
        assert_ne!(light_background, background);
    });
}
