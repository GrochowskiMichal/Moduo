//! The gallery: a window that lists pages down the left and draws the chosen one, under a strip
//! that switches every appearance axis live. Each primitive block adds its page to [`pages`].

mod tokens_page;

use moduo_tokens::{Appearance, Token};
use moduo_ui::gpui::{
    self, div, prelude::*, AnyElement, App, Bounds, Context, ElementId, SharedString,
    TitlebarOptions, Window, WindowBounds, WindowOptions,
};
use moduo_ui::style::{self, Tone};
use moduo_ui::text::{self, TextRole};
use moduo_ui::theme;

/// One gallery page.
pub trait Page {
    fn name(&self) -> &'static str;
    fn render(&self, window: &mut Window, cx: &mut App) -> AnyElement;
}

/// Every page, in the order the sidebar lists them.
pub fn pages() -> Vec<Box<dyn Page>> {
    vec![Box::new(tokens_page::TokensPage)]
}

/// The axes the strip switches, with their values (`tokens.css` header). `None` is the absent
/// attribute: for motion that is "as the system says".
const AXES: &[(&str, &[Option<&str>])] = &[
    ("theme", &[Some("dark"), Some("light")]),
    (
        "shade",
        &[
            Some("black"),
            Some("warm"),
            Some("cool"),
            Some("slate"),
            Some("plum"),
            Some("forest"),
        ],
    ),
    (
        "accent",
        &[
            Some("mono"),
            Some("pink"),
            Some("violet"),
            Some("blue"),
            Some("green"),
            Some("amber"),
            Some("red"),
            Some("teal"),
        ],
    ),
    (
        "density",
        &[Some("comfortable"), Some("compact"), Some("dense")],
    ),
    ("radius", &[Some("soft"), Some("sharp"), Some("round")]),
    (
        "font",
        &[
            Some("geist"),
            Some("inter"),
            Some("pilat"),
            Some("cal"),
            Some("fraunces"),
            Some("serif"),
            Some("mono"),
        ],
    ),
    ("motion", &[None, Some("full"), Some("reduced")]),
];

pub struct Gallery {
    pages: Vec<Box<dyn Page>>,
    selected: usize,
}

impl Gallery {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            pages: pages(),
            selected: 0,
        }
    }

    pub fn select(&mut self, index: usize, cx: &mut Context<Self>) {
        self.selected = index.min(self.pages.len().saturating_sub(1));
        cx.notify();
    }

    fn cycle(axis: &'static str, values: &'static [Option<&'static str>], cx: &mut App) {
        let current = theme::appearance(cx).attr(axis).map(str::to_owned);
        let at = values
            .iter()
            .position(|v| v.map(str::to_owned) == current)
            .unwrap_or(0);
        let next = values[(at + 1) % values.len()];
        let appearance: Appearance = match next {
            Some(v) => theme::appearance(cx).clone().with(axis, v),
            None => theme::appearance(cx).clone().without(axis),
        };
        theme::set_appearance(cx, appearance);
    }

    fn strip(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let gap = theme::px(cx, Token::PanelGap);
        let pad = theme::px(cx, Token::PanelPad);
        let mut row = div()
            .flex()
            .flex_wrap()
            .gap(gap)
            .p(pad)
            .border_b_1()
            .border_color(theme::color(cx, Token::Hairline));
        for (axis, values) in AXES {
            let value = theme::appearance(cx)
                .attr(axis)
                .unwrap_or("system")
                .to_owned();
            let chip = div()
                .id(ElementId::Name(SharedString::from(format!("axis-{axis}"))))
                .px(theme::px(cx, Token::PadXSm))
                .h(theme::px(cx, Token::CtrlHSm))
                .flex()
                .items_center()
                .rounded(theme::px(cx, Token::RadiusMd))
                .child(format!("{axis}: {value}"))
                .on_click(cx.listener(move |_, _, _, cx| Self::cycle(axis, values, cx)));
            row = row.child(text::styled(
                style::state_layer(chip, Tone::Raised, false, cx),
                TextRole::Chrome,
                cx,
            ));
        }
        row
    }
}

impl Render for Gallery {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let pad = theme::px(cx, Token::PanelPad);
        let mut sidebar = div()
            .flex()
            .flex_col()
            .w(theme::px(cx, Token::WidthRail))
            .p(pad)
            .gap(theme::px(cx, Token::PanelGap))
            .border_r_1()
            .border_color(theme::color(cx, Token::Hairline));
        for (index, page) in self.pages.iter().enumerate() {
            let row = div()
                .id(("page", index))
                .px(theme::px(cx, Token::PadXSm))
                .h(theme::px(cx, Token::RowH))
                .flex()
                .items_center()
                .rounded(theme::px(cx, Token::RadiusMd))
                .child(page.name())
                .on_click(cx.listener(move |this, _, _, cx| this.select(index, cx)));
            let tone = if index == self.selected {
                Tone::Raised
            } else {
                Tone::Quiet
            };
            sidebar = sidebar.child(text::styled(
                style::state_layer(row, tone, false, cx),
                TextRole::Body,
                cx,
            ));
        }
        let page = self.pages[self.selected].render(window, cx);
        let content = div()
            .id("gallery-scroll")
            .flex_1()
            .min_w_0()
            .overflow_y_scroll()
            .p(theme::px(cx, Token::PanelInset))
            .child(div().debug_selector(|| "gallery-page".into()).child(page));
        text::styled(
            div()
                .size_full()
                .flex()
                .flex_col()
                .bg(theme::color(cx, Token::Background))
                .text_color(theme::color(cx, Token::Foreground))
                .child(self.strip(cx))
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .child(sidebar)
                        .child(content),
                ),
            TextRole::Body,
            cx,
        )
    }
}

/// Opens the gallery window. Closing it quits.
pub fn run() {
    moduo_ui::application().run(|cx| {
        moduo_ui::init(cx);
        let size = moduo_app_window_size();
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size, cx))),
            titlebar: Some(TitlebarOptions {
                title: Some("Moduo gallery".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        moduo_ui::open_window(options, cx, |_, cx| cx.new(Gallery::new))
            .expect("the gallery opens");
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.activate(true);
    });
}

/// The app's own window size, so primitives are seen at the size they will live at.
fn moduo_app_window_size() -> gpui::Size<gpui::Pixels> {
    gpui::size(gpui::px(1280.), gpui::px(840.)) // design-literal: the app window's size (tauri.conf.json)
}
