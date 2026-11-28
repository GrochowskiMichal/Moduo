use std::cell::Cell;
use std::rc::Rc;

use moduo_tokens::{Appearance, Token};
use moduo_ui::gpui::{self, div, prelude::*, AnyElement, Context, Modifiers, TestAppContext, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{Button, ButtonSize, ButtonVariant};
use moduo_ui::theme;

fn item(name: &'static str, element: impl IntoElement) -> AnyElement {
    div().flex().child(div().debug_selector(move || name.into()).child(element)).into_any_element()
}

const SIZE_NAMES: [&str; 4] = ["size-sm", "size-md", "size-lg", "size-icon"];

struct All;

impl Render for All {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let mut items = Vec::new();
        for (i, variant) in ButtonVariant::ALL.iter().enumerate() {
            let name = ["v-default", "v-secondary", "v-outline", "v-ghost", "v-destructive", "v-link"][i];
            items.push(item(name, Button::new(name, "Save").variant(*variant)));
        }
        for (i, size) in ButtonSize::ALL.iter().enumerate() {
            let button = if *size == ButtonSize::Icon {
                Button::icon(SIZE_NAMES[i], IconName::Plus, "Add")
            } else {
                Button::new(SIZE_NAMES[i], "Save").size(*size)
            };
            items.push(item(SIZE_NAMES[i], button));
        }
        items.push(item("loading", Button::new("loading", "Saving").loading(true)));
        items.push(item("idle", Button::new("idle", "Saving")));
        div().flex().flex_col().children(items)
    }
}

#[gpui::test]
fn renders_every_variant_and_size(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    for density in ["comfortable", "dense"] {
        cx.update(|cx| theme::set_appearance(cx, Appearance::default().with("density", density)));
        let (_view, cx) = cx.add_window_view(|_, _| All);
        cx.run_until_parked();
        for name in ["v-default", "v-secondary", "v-outline", "v-ghost", "v-destructive", "v-link"] {
            assert!(cx.debug_bounds(name).is_some(), "{name} drew nothing");
        }
        let token = |t: Token| cx.update(|_, cx| theme::px(cx, t));
        let h = |cx: &mut gpui::VisualTestContext, n: &'static str| cx.debug_bounds(n).unwrap().size;
        assert_eq!(h(cx, "size-sm").height, token(Token::CtrlHSm));
        assert_eq!(h(cx, "size-md").height, token(Token::CtrlH));
        assert_eq!(h(cx, "size-lg").height, token(Token::CtrlHLg));
        let icon = h(cx, "size-icon");
        assert_eq!((icon.width, icon.height), (token(Token::CtrlH), token(Token::CtrlH)), "an icon button is square");
        // Loading keeps the button's width: the label stays laid out.
        assert_eq!(h(cx, "loading").width, h(cx, "idle").width);
    }
}

struct Counter {
    presses: Rc<Cell<u32>>,
    disabled: bool,
}

impl Render for Counter {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let presses = self.presses.clone();
        div().size_full().child(
            div().debug_selector(|| "button".into()).child(
                Button::new("count", "Count")
                    .disabled(self.disabled)
                    .on_click(move |_, _| presses.set(presses.get() + 1)),
            ),
        )
    }
}

fn counter(cx: &mut TestAppContext, disabled: bool) -> (Rc<Cell<u32>>, &mut gpui::VisualTestContext) {
    cx.update(moduo_ui::init);
    let presses = Rc::new(Cell::new(0));
    let p = presses.clone();
    let (_view, cx) = cx.add_window_view(move |_, _| Counter { presses: p, disabled });
    cx.run_until_parked();
    (presses, cx)
}

#[gpui::test]
fn space_and_enter_fire_once(cx: &mut TestAppContext) {
    let (presses, cx) = counter(cx, false);
    let center = cx.debug_bounds("button").unwrap().center();
    cx.simulate_click(center, Modifiers::none());
    assert_eq!(presses.get(), 1, "a click fires once");
    cx.simulate_keystrokes("space");
    assert_eq!(presses.get(), 2, "space fires once");
    cx.simulate_keystrokes("enter");
    assert_eq!(presses.get(), 3, "enter fires once");
}

#[gpui::test]
fn disabled_ignores_press_and_keys(cx: &mut TestAppContext) {
    let (presses, cx) = counter(cx, true);
    let center = cx.debug_bounds("button").unwrap().center();
    cx.simulate_click(center, Modifiers::none());
    cx.simulate_keystrokes("space enter");
    assert_eq!(presses.get(), 0);
}

#[gpui::test]
fn pressed_shows_the_toggle_fill(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    cx.update(|cx| {
        let active = theme::color(cx, Token::StateActive);
        for variant in [ButtonVariant::Outline, ButtonVariant::Ghost] {
            assert_eq!(Button::fill(variant, false, cx), None, "{variant:?} rests transparent");
            assert_eq!(Button::fill(variant, true, cx), Some(active), "{variant:?} pressed");
        }
        assert_eq!(Button::fill(ButtonVariant::Default, false, cx), Some(theme::color(cx, Token::Primary)));
    });
}
