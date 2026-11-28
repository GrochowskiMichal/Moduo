use std::cell::RefCell;
use std::rc::Rc;

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AnyWindowHandle, InputHandler as _};
use moduo_tokens::Token;
use moduo_ui::gpui::{self, div, prelude::*, AppContext as _, Context, Entity, TestAppContext, Window};
use moduo_ui::primitives::{FieldSize, FieldVariant, NumberEvent, NumberInput, TextField, TextFieldEvent};
use moduo_ui::theme;

/// A form with one text field and somewhere else to put focus; it records what the field says.
struct Form {
    field: Entity<TextField>,
    events: Rc<RefCell<Vec<String>>>,
    _sub: gpui::Subscription,
}

impl Form {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = cx.new(|cx| TextField::single_line("name", window, cx).with_value("a", window, cx));
        let events = Rc::new(RefCell::new(Vec::new()));
        let log = events.clone();
        let _sub = cx.subscribe(&field, move |_, _, e: &TextFieldEvent, _| {
            log.borrow_mut().push(match e {
                TextFieldEvent::Change(v) => format!("change:{v}"),
                TextFieldEvent::Commit(v) => format!("commit:{v}"),
                TextFieldEvent::Cancel => "cancel".into(),
            });
        });
        Self { field, events, _sub }
    }
}

impl Render for Form {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().flex().flex_col().child(div().w_64().child(self.field.clone()))
    }
}

fn mount(cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<Form>) {
    cx.update(moduo_ui::init);
    let window = cx.add_window(|window, cx| Form::new(window, cx));
    let form = window.root(cx).unwrap();
    (window.into(), form)
}

fn value(cx: &mut TestAppContext, form: &Entity<Form>) -> String {
    cx.update(|cx| form.read(cx).field.read(cx).value(cx).to_string())
}

#[gpui::test]
fn type_select_copy_paste_undo(cx: &mut TestAppContext) {
    let (handle, form) = mount(cx);
    cx.update_window(handle, |_, window, cx| {
        window.click("name", cx);
        window.press("cmd-a", cx);
        window.input("hello", cx);
        window.press("cmd-a", cx);
        window.press("cmd-c", cx);
        window.press("right", cx);
        window.press("cmd-v", cx);
    })
    .unwrap();
    assert_eq!(value(cx, &form), "hellohello");
    assert_eq!(cx.read_from_clipboard().and_then(|c| c.text()).as_deref(), Some("hello"));
    cx.update_window(handle, |_, window, cx| window.press("cmd-z", cx)).unwrap();
    assert_eq!(value(cx, &form), "hello");
}

#[gpui::test]
fn marked_text_commits_once(cx: &mut TestAppContext) {
    let (handle, form) = mount(cx);
    cx.update_window(handle, |_, window, cx| {
        window.click("name", cx);
        window.press("cmd-a", cx);
        let field = form.read(cx).field.clone();
        let mut ime = field.read(cx).ime_handler(window, cx);
        ime.replace_and_mark_text_in_range(None, "ż", Some(0..1), window, cx);
        assert_eq!(ime.marked_text_range(window, cx), Some(0..1));
        ime.replace_text_in_range(None, "ż", window, cx);
        assert_eq!(ime.marked_text_range(window, cx), None);
    })
    .unwrap();
    assert_eq!(value(cx, &form), "ż");
}

#[gpui::test]
fn blur_and_enter_commit_esc_restores(cx: &mut TestAppContext) {
    let (handle, form) = mount(cx);
    let events = cx.update(|cx| form.read(cx).events.clone());
    cx.update_window(handle, |_, window, cx| {
        window.click("name", cx);
        window.press("end", cx);
        window.input("b", cx);
        window.press("enter", cx);
        window.input("c", cx);
        window.press("escape", cx);
    })
    .unwrap();
    assert_eq!(value(cx, &form), "ab", "Esc restores the last committed text");
    let log = events.borrow().clone();
    assert!(log.contains(&"commit:ab".to_string()), "{log:?}");
    assert!(log.contains(&"cancel".to_string()), "{log:?}");
    assert!(!log.iter().any(|e| e == "commit:abc"), "Esc must not commit: {log:?}");

    cx.update_window(handle, |_, window, cx| {
        window.press("end", cx);
        window.input("d", cx);
        // Focus moves away: the draft commits.
        window.blur();
    })
    .unwrap();
    cx.run_until_parked();
    assert!(events.borrow().contains(&"commit:abd".to_string()), "{:?}", events.borrow());
}

struct Numbers {
    field: Entity<NumberInput>,
    last: Rc<RefCell<Option<Option<i64>>>>,
    _sub: gpui::Subscription,
}

impl Render for Numbers {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().w_64().child(self.field.clone())
    }
}

#[gpui::test]
fn number_input_steps_with_arrows_and_clamps(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let window = cx.add_window(|window, cx| {
        let field = cx.new(|cx| NumberInput::new("count", Some(2), window, cx).range(0, 3).step(1));
        let last = Rc::new(RefCell::new(None));
        let l = last.clone();
        let _sub = cx.subscribe(&field, move |_, _, e: &NumberEvent, _| {
            let NumberEvent::Commit(v) = e;
            *l.borrow_mut() = Some(*v);
        });
        cx.new(|_| Numbers { field, last, _sub })
    });
    let numbers = window.root(cx).unwrap();
    let handle: AnyWindowHandle = window.into();
    let current = |cx: &mut TestAppContext| cx.update(|cx| numbers.read(cx).field.read(cx).value());
    cx.update_window(handle, |_, window, cx| {
        window.click("count", cx);
        window.press("up", cx);
    })
    .unwrap();
    assert_eq!(current(cx), Some(3));
    cx.update_window(handle, |_, window, cx| window.press("up", cx)).unwrap();
    assert_eq!(current(cx), Some(3), "clamped at the max");
    cx.update_window(handle, |_, window, cx| window.press("down", cx)).unwrap();
    assert_eq!(current(cx), Some(2));
    cx.update_window(handle, |_, window, cx| {
        window.press("cmd-a", cx);
        window.input("x", cx);
        window.press("enter", cx);
    })
    .unwrap();
    assert_eq!(current(cx), Some(2), "text that is not a number reverts");
    cx.update_window(handle, |_, window, cx| {
        window.press("cmd-a", cx);
        window.input("9", cx);
        window.press("enter", cx);
    })
    .unwrap();
    assert_eq!(current(cx), Some(3), "a typed number is clamped");
    assert_eq!(*cx.update(|cx| numbers.read(cx).last.clone()).borrow(), Some(Some(3)));
}

struct Variants {
    fields: Vec<(&'static str, Entity<TextField>)>,
}

impl Render for Variants {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().flex().flex_col().children(self.fields.iter().map(|(name, f)| {
            let name = *name;
            div().w_64().debug_selector(move || name.into()).child(f.clone())
        }))
    }
}

#[gpui::test]
fn renders_every_variant_and_size(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let (_view, cx) = cx.add_window_view(|window, cx| {
        let mut fields = Vec::new();
        for (v, variant) in [("filled", FieldVariant::Filled), ("ghost", FieldVariant::Ghost), ("bare", FieldVariant::Bare)] {
            for (s, size) in [("sm", FieldSize::Sm), ("md", FieldSize::Md)] {
                let name: &'static str = Box::leak(format!("{v}-{s}").into_boxed_str());
                fields.push((name, cx.new(|cx| TextField::single_line(name, window, cx).variant(variant).size(size).placeholder("Type"))));
            }
        }
        Variants { fields }
    });
    cx.run_until_parked();
    let (sm, md) = cx.update(|_, cx| (theme::px(cx, Token::CtrlHSm), theme::px(cx, Token::CtrlH)));
    for v in ["filled", "ghost", "bare"] {
        assert_eq!(cx.debug_bounds(Box::leak(format!("{v}-sm").into_boxed_str())).unwrap().size.height, sm, "{v} sm");
        assert_eq!(cx.debug_bounds(Box::leak(format!("{v}-md").into_boxed_str())).unwrap().size.height, md, "{v} md");
    }
}
