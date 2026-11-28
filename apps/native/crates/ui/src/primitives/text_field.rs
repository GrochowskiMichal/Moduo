//! Text fields (`input.tsx`, `textarea.tsx`, `field-shell.ts`): one draft-and-commit field on the
//! component library's text engine (selection, clipboard, undo, input methods). The draft commits
//! on Enter (⌘Enter in a multi-line field) or when focus leaves, and Esc puts back the last
//! committed text (`useDraftField`).

use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::TestSupportExt as _;
use gpui_kit::{
    div, prelude::*, App, Context, ElementId, ElementInputHandler, Entity, EventEmitter,
    FocusHandle, Focusable, KeyDownEvent, SharedString, Subscription, Window,
};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

/// The field's surface (`field-shell.ts`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FieldVariant {
    /// A visible well: the input fill and a border (standalone forms).
    #[default]
    Filled,
    /// Transparent at rest; a hairline and the hover fill on hover (inline edits).
    Ghost,
    /// No chrome at all, until focused (inline titles and renames).
    Bare,
}

/// The control rung: `--ctrl-h-sm` or `--ctrl-h`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FieldSize {
    Sm,
    #[default]
    Md,
}

/// What a field tells its owner.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextFieldEvent {
    /// The draft changed.
    Change(SharedString),
    /// The draft was committed (Enter, ⌘Enter, or focus leaving with a change).
    Commit(SharedString),
    /// Esc: the draft was dropped and the committed text put back.
    Cancel,
}

enum Engine {
    Line(Entity<InputState>),
    Area(Entity<TextareaState>),
}

pub struct TextField {
    id: ElementId,
    engine: Engine,
    committed: SharedString,
    variant: FieldVariant,
    size: FieldSize,
    invalid: bool,
    disabled: bool,
    /// Set by the builder, handed to the engine on the first render (it needs a window).
    pending_placeholder: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<TextFieldEvent> for TextField {}

impl TextField {
    /// A one-line field.
    pub fn single_line(
        id: impl Into<ElementId>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let state = cx.new(|cx| InputState::new(window, cx));
        let subscription = cx.subscribe_in(&state, window, Self::on_input);
        Self::with_engine(id.into(), Engine::Line(state), subscription)
    }

    /// A field that grows from `min_rows` to `max_rows`, then scrolls.
    pub fn multi_line(
        id: impl Into<ElementId>,
        min_rows: usize,
        max_rows: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let state = cx.new(|cx| TextareaState::new(window, cx).auto_grow(min_rows, max_rows));
        let subscription = cx.subscribe_in(&state, window, Self::on_input);
        Self::with_engine(id.into(), Engine::Area(state), subscription)
    }

    fn with_engine(id: ElementId, engine: Engine, subscription: Subscription) -> Self {
        Self {
            id,
            engine,
            committed: SharedString::default(),
            variant: FieldVariant::default(),
            size: FieldSize::default(),
            invalid: false,
            disabled: false,
            pending_placeholder: None,
            _subscriptions: vec![subscription],
        }
    }

    /// Starts with a committed value.
    pub fn with_value(
        mut self,
        value: impl Into<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        self.set_value(value, window, cx);
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.pending_placeholder = Some(placeholder.into());
        self
    }

    pub fn variant(mut self, variant: FieldVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: FieldSize) -> Self {
        self.size = size;
        self
    }

    pub fn set_invalid(&mut self, invalid: bool, cx: &mut Context<Self>) {
        self.invalid = invalid;
        cx.notify();
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        self.disabled = disabled;
        match &self.engine {
            Engine::Line(s) => s.update(cx, |s, cx| s.set_disabled(disabled, cx)),
            Engine::Area(s) => s.update(cx, |s, cx| s.set_disabled(disabled, cx)),
        }
        cx.notify();
    }

    /// The text in the field now (the draft).
    pub fn value(&self, cx: &App) -> SharedString {
        match &self.engine {
            Engine::Line(s) => s.read(cx).value(),
            Engine::Area(s) => s.read(cx).value(),
        }
    }

    /// The last committed text.
    pub fn committed(&self) -> &SharedString {
        &self.committed
    }

    /// Puts a value in, committed (the owner's value changed).
    pub fn set_value(
        &mut self,
        value: impl Into<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let value = value.into();
        self.committed = value.clone();
        match &self.engine {
            Engine::Line(s) => s.update(cx, |s, cx| s.set_value(value, window, cx)),
            Engine::Area(s) => s.update(cx, |s, cx| s.set_value(value, window, cx)),
        }
    }

    pub fn focus_handle(&self, cx: &App) -> FocusHandle {
        match &self.engine {
            Engine::Line(s) => s.read(cx).focus_handle(cx),
            Engine::Area(s) => s.read(cx).focus_handle(cx),
        }
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.focus_handle(cx).focus(window, cx);
    }

    /// The platform's text-input protocol for this field (marked text from an input method).
    /// What the window installs while the field is focused; tests drive input methods with it.
    pub fn ime_handler(&self, _: &mut Window, cx: &App) -> Box<dyn gpui_kit::InputHandler> {
        match &self.engine {
            Engine::Line(s) => Box::new(ElementInputHandler::new(
                s.read(cx).input_bounds(),
                s.clone(),
            )),
            Engine::Area(s) => Box::new(ElementInputHandler::new(
                s.read(cx).input_bounds(),
                s.clone(),
            )),
        }
    }

    fn multi(&self) -> bool {
        matches!(self.engine, Engine::Area(_))
    }

    fn commit(&mut self, force: bool, cx: &mut Context<Self>) {
        let draft = self.value(cx);
        if force || draft != self.committed {
            self.committed = draft.clone();
            cx.emit(TextFieldEvent::Commit(draft));
        }
    }

    fn cancel(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let committed = self.committed.clone();
        self.set_value(committed, window, cx);
        cx.emit(TextFieldEvent::Cancel);
        cx.notify();
    }

    fn on_input<S: 'static>(
        &mut self,
        _: &Entity<S>,
        event: &InputEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            InputEvent::Change => {
                let draft = self.value(cx);
                cx.emit(TextFieldEvent::Change(draft));
            }
            InputEvent::PressEnter { secondary, .. } if !self.multi() || *secondary => {
                self.commit(true, cx)
            }
            InputEvent::PressEnter { .. } => {}
            InputEvent::Blur => {
                self.commit(false, cx);
                cx.notify();
            }
            InputEvent::Focus => cx.notify(),
        }
    }
}

impl Render for TextField {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(p) = self.pending_placeholder.take() {
            match &self.engine {
                Engine::Line(s) => s.update(cx, |s, cx| s.set_placeholder(p, window, cx)),
                Engine::Area(s) => s.update(cx, |s, cx| s.set_placeholder(p, window, cx)),
            }
        }
        let focused = self.focus_handle(cx).is_focused(window);
        let height = match self.size {
            FieldSize::Sm => theme::px(cx, Token::CtrlHSm),
            FieldSize::Md => theme::px(cx, Token::CtrlH),
        };
        let pad = match (self.variant, self.size) {
            (FieldVariant::Bare, _) => sp(0.),
            (_, FieldSize::Sm) => sp(2.5),
            (_, FieldSize::Md) => sp(3.),
        };
        let edge_focus = theme::color_alpha(cx, Token::Ring, 50.0);
        // A line field's engine carries the id; a multi-line one has none, so its shell does.
        let shell_id = match self.engine {
            Engine::Line(_) => ElementId::Name(format!("{}-shell", self.id).into()),
            Engine::Area(_) => self.id.clone(),
        };
        let shell = div()
            .id(shell_id)
            .test_support()
            .w_full()
            .min_w_0()
            .flex()
            .items_center()
            .px(pad)
            .rounded(theme::px(cx, Token::RadiusMd))
            .text_color(theme::color(cx, Token::Foreground))
            .when(self.disabled, |el| el.opacity(0.5))
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, window, cx| {
                if e.keystroke.key == "escape" && !e.keystroke.modifiers.modified() {
                    this.cancel(window, cx);
                    cx.stop_propagation();
                }
            }));
        let shell = match self.variant {
            FieldVariant::Filled => shell
                .border_1()
                .border_color(if focused {
                    edge_focus
                } else {
                    theme::color(cx, Token::Border)
                })
                .bg(theme::color(cx, Token::Input)),
            FieldVariant::Ghost => {
                let hover_edge = theme::color(cx, Token::Hairline);
                let hover_fill = theme::color(cx, Token::StateHover);
                shell
                    .border_1()
                    .border_color(if focused {
                        edge_focus
                    } else {
                        gpui_kit::transparent_black()
                    })
                    .when(focused, |el| el.bg(hover_fill))
                    .hover(move |s| s.border_color(hover_edge).bg(hover_fill))
            }
            FieldVariant::Bare => {
                shell.when(focused, |el| el.shadow(vec![crate::focus::ring_shadow(cx)]))
            }
        };
        let shell = if self.invalid {
            let mut ring = crate::focus::ring_shadow(cx);
            ring.color = theme::color_alpha(cx, Token::Destructive, 40.0);
            shell
                .border_color(theme::color(cx, Token::Destructive))
                .shadow(vec![ring])
        } else {
            shell
        };
        let shell = match &self.engine {
            // The engine carries the field's id: tests and accessibility find the text by it.
            Engine::Line(state) => shell.h(height).child(
                Input::new(state)
                    .id(self.id.clone())
                    .appearance(false)
                    .w_full(),
            ),
            Engine::Area(state) => shell
                .py(sp(2.))
                .child(Textarea::new(state).appearance(false).w_full()),
        };
        text::font(
            shell,
            Family::Sans,
            Token::TextBase,
            Token::FontWeightRegular,
            cx,
        )
    }
}
