use std::cell::{Cell, RefCell};
use std::rc::Rc;

use moduo_tokens::Appearance;
use moduo_ui::gpui::{self, div, prelude::*, Context, Modifiers, TestAppContext, Window};
use moduo_ui::primitives::{Checkbox, CompleteToggle, RadioGroup, Switch, SwitchSize};
use moduo_ui::theme;

struct Toggles {
    checked: Rc<Cell<bool>>,
    on: Rc<Cell<bool>>,
    done: Rc<Cell<bool>>,
    choice: Rc<RefCell<String>>,
}

impl Render for Toggles {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (checked, on, done, choice) = (
            self.checked.clone(),
            self.on.clone(),
            self.done.clone(),
            self.choice.clone(),
        );
        let current = choice.borrow().clone();
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .child(div().debug_selector(|| "checkbox".into()).child(
                        Checkbox::new("cb", checked.get()).on_change({
                            let checked = checked.clone();
                            move |v, window, _| {
                                checked.set(v);
                                window.refresh();
                            }
                        }),
                    )),
            )
            .child(
                div().flex().child(
                    div().debug_selector(|| "switch".into()).child(
                        Switch::new("sw", on.get())
                            .size(SwitchSize::Default)
                            .on_change({
                                let on = on.clone();
                                move |v, window, _| {
                                    on.set(v);
                                    window.refresh();
                                }
                            }),
                    ),
                ),
            )
            .child(
                div()
                    .flex()
                    .child(div().debug_selector(|| "done".into()).child(
                        CompleteToggle::new("done", done.get()).on_toggle({
                            let done = done.clone();
                            move |_, _| done.set(!done.get())
                        }),
                    )),
            )
            .child(
                div().debug_selector(|| "radio".into()).child(
                    RadioGroup::new("radio", current)
                        .option("list", "List")
                        .option("board", "Board")
                        .option("timeline", "Timeline")
                        .on_change({
                            let choice = choice.clone();
                            // The owner redraws with the new choice, as a view that keeps it would.
                            move |v, window, _| {
                                *choice.borrow_mut() = v.to_string();
                                window.refresh();
                            }
                        }),
                ),
            )
    }
}

/// A key pressed and released, as the platform sends it (GPUI turns Enter and Space on a focused
/// element into a click on the release; `simulate_keystrokes` sends no release).
fn press(cx: &mut gpui::VisualTestContext, key: &'static str) {
    cx.update(|window, cx| window.draw(cx).clear(cx));
    let keystroke = gpui::Keystroke::parse(key).unwrap();
    cx.simulate_event(gpui::KeyDownEvent {
        keystroke: keystroke.clone(),
        is_held: false,
        prefer_character_input: false,
    });
    cx.simulate_event(gpui::KeyUpEvent { keystroke });
}

fn toggles(cx: &mut TestAppContext) -> (Toggles, &mut gpui::VisualTestContext) {
    cx.update(moduo_ui::init);
    let state = Toggles {
        checked: Rc::new(Cell::new(false)),
        on: Rc::new(Cell::new(false)),
        done: Rc::new(Cell::new(false)),
        choice: Rc::new(RefCell::new("list".into())),
    };
    let s = Toggles {
        checked: state.checked.clone(),
        on: state.on.clone(),
        done: state.done.clone(),
        choice: state.choice.clone(),
    };
    let (_view, cx) = cx.add_window_view(move |_, _| s);
    cx.run_until_parked();
    (state, cx)
}

#[gpui::test]
fn checkbox_and_switch_toggle_on_space(cx: &mut TestAppContext) {
    let (state, cx) = toggles(cx);
    // A press focuses the control and toggles it; Space toggles it back.
    let c = cx.debug_bounds("checkbox").unwrap().center();
    cx.simulate_click(c, Modifiers::none());
    assert!(state.checked.get());
    press(cx, "space");
    assert!(!state.checked.get());

    let s = cx.debug_bounds("switch").unwrap().center();
    cx.simulate_click(s, Modifiers::none());
    assert!(state.on.get());
    press(cx, "space");
    assert!(!state.on.get());
}

#[gpui::test]
fn radio_arrows_move_and_select(cx: &mut TestAppContext) {
    let (state, cx) = toggles(cx);
    let r = cx.debug_bounds("radio").unwrap();
    cx.simulate_click(
        gpui::point(r.origin.x + gpui::px(4.), r.origin.y + gpui::px(4.)),
        Modifiers::none(),
    );
    assert_eq!(*state.choice.borrow(), "list");
    cx.simulate_keystrokes("down");
    assert_eq!(*state.choice.borrow(), "board");
    cx.simulate_keystrokes("down");
    assert_eq!(*state.choice.borrow(), "timeline");
    cx.simulate_keystrokes("down");
    assert_eq!(*state.choice.borrow(), "list", "arrows wrap");
    cx.simulate_keystrokes("up");
    assert_eq!(*state.choice.borrow(), "timeline");
}

#[gpui::test]
fn the_complete_toggle_pops_once(cx: &mut TestAppContext) {
    let (state, cx) = toggles(cx);
    let d = cx.debug_bounds("done").unwrap().center();
    cx.simulate_click(d, Modifiers::none());
    assert!(state.done.get());
    cx.update(|_, cx| {
        assert!(CompleteToggle::pops(cx), "the check pops when it appears");
        theme::set_appearance(cx, Appearance::default().with("motion", "reduced"));
        assert!(
            !CompleteToggle::pops(cx),
            "and just appears under reduced motion"
        );
    });
}

#[gpui::test]
fn renders_both_switch_sizes(cx: &mut TestAppContext) {
    struct Sizes;
    impl Render for Sizes {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .flex()
                .flex_col()
                .child(
                    div().flex().child(
                        div()
                            .debug_selector(|| "sm".into())
                            .child(Switch::new("a", true).size(SwitchSize::Sm)),
                    ),
                )
                .child(
                    div().flex().child(
                        div()
                            .debug_selector(|| "default".into())
                            .child(Switch::new("b", false)),
                    ),
                )
        }
    }
    cx.update(moduo_ui::init);
    let (_view, cx) = cx.add_window_view(|_, _| Sizes);
    cx.run_until_parked();
    let sm = cx.debug_bounds("sm").unwrap().size;
    let df = cx.debug_bounds("default").unwrap().size;
    // h-4 w-7 and h-5 w-9.
    assert_eq!((f32::from(sm.width), f32::from(sm.height)), (28.0, 16.0));
    assert_eq!((f32::from(df.width), f32::from(df.height)), (36.0, 20.0));
}
