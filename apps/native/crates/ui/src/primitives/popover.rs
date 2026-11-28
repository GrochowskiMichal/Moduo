//! The popover (`popover.tsx`): a floating surface opened by a trigger, placed on a side and an
//! alignment, moved to the other side when it would leave the window, closed by Esc or a press
//! outside. Opening moves focus into it; Esc gives focus back to what had it. Nested popovers close
//! innermost first. This is the one floating layer: menus, selects and pickers build on it.

use std::rc::Rc;

use gpui_kit::{
    anchored, canvas, deferred, div, point, prelude::*, AnyElement, App, Bounds, ElementId, Entity,
    FocusHandle, Global, KeyDownEvent, MouseButton, MouseDownEvent, Pixels, Window,
};
use moduo_tokens::Token;

use crate::space::sp;
use crate::style;

/// Which side of the trigger the surface opens on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Side {
    Top,
    #[default]
    Bottom,
}

/// How the surface lines up with the trigger along that side.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

type Content = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement>;

/// What one popover keeps between renders.
pub struct PopoverState {
    open: bool,
    trigger: Bounds<Pixels>,
    surface: Bounds<Pixels>,
    focus: Option<FocusHandle>,
    restore: Option<FocusHandle>,
}

/// The open popovers, innermost last: only the innermost closes on Esc, and a press outside
/// closes each one it lands outside of.
#[derive(Default)]
struct OpenStack(Vec<Entity<PopoverState>>);

impl Global for OpenStack {}

#[derive(IntoElement)]
pub struct Popover {
    id: ElementId,
    trigger: AnyElement,
    content: Option<Content>,
    side: Side,
    align: Align,
}

impl Popover {
    pub fn new(id: impl Into<ElementId>, trigger: impl IntoElement) -> Self {
        Self {
            id: id.into(),
            trigger: trigger.into_any_element(),
            content: None,
            side: Side::Bottom,
            align: Align::Start,
        }
    }

    pub fn content(
        mut self,
        content: impl Fn(&mut Window, &mut App) -> AnyElement + 'static,
    ) -> Self {
        self.content = Some(Rc::new(content));
        self
    }

    pub fn side(mut self, side: Side) -> Self {
        self.side = side;
        self
    }

    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }

    /// The surface corner that sits on the trigger corner.
    fn corners(&self) -> (gpui_kit::Anchor, gpui_kit::Anchor) {
        use gpui_kit::Anchor::*;
        match (self.side, self.align) {
            (Side::Bottom, Align::Start) => (TopLeft, BottomLeft),
            (Side::Bottom, Align::Center) => (TopCenter, BottomCenter),
            (Side::Bottom, Align::End) => (TopRight, BottomRight),
            (Side::Top, Align::Start) => (BottomLeft, TopLeft),
            (Side::Top, Align::Center) => (BottomCenter, TopCenter),
            (Side::Top, Align::End) => (BottomRight, TopRight),
        }
    }
}

fn close(state: &Entity<PopoverState>, window: &mut Window, cx: &mut App) {
    let restore = state.update(cx, |s, cx| {
        s.open = false;
        cx.notify();
        s.restore.take()
    });
    cx.default_global::<OpenStack>().0.retain(|e| e != state);
    if let Some(restore) = restore {
        restore.focus(window, cx);
    }
    window.refresh();
}

impl RenderOnce for Popover {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let state = window.use_keyed_state(self.id.clone(), cx, |_, _| PopoverState {
            open: false,
            trigger: Bounds::default(),
            surface: Bounds::default(),
            focus: None,
            restore: None,
        });
        let focus = state.update(cx, |s, cx| {
            s.focus.get_or_insert_with(|| cx.focus_handle()).clone()
        });
        let (open, trigger) = {
            let s = state.read(cx);
            (s.open, s.trigger)
        };
        let (surface_corner, trigger_corner) = self.corners();
        let offset = match self.side {
            Side::Bottom => sp(1.),
            Side::Top => -sp(1.),
        };

        let toggle = state.clone();
        let opener = focus.clone();
        let measure = state.clone();
        let wrapper = div()
            .id(self.id.clone())
            .relative()
            .flex_none()
            .child(self.trigger)
            // Records where the trigger is, for the surface to attach to.
            .child(
                canvas(
                    move |bounds, _, cx| measure.update(cx, |s, _| s.trigger = bounds),
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, window, cx| {
                if toggle.read(cx).open {
                    close(&toggle, window, cx);
                    return;
                }
                let previous = window.focused(cx);
                toggle.update(cx, |s, cx| {
                    s.open = true;
                    s.restore = previous;
                    cx.notify();
                });
                cx.default_global::<OpenStack>().0.push(toggle.clone());
                opener.focus(window, cx);
                window.refresh();
            });

        let Some(content) = self.content.filter(|_| open) else {
            return wrapper;
        };
        let escape = state.clone();
        let outside = state.clone();
        let measure_surface = state.clone();
        let surface = style::floating_surface(
            div()
                .id(ElementId::Name(format!("{}-surface", self.id).into()))
                .track_focus(&focus)
                .p(sp(1.))
                .occlude()
                .child(content(window, cx))
                .child(
                    canvas(
                        move |bounds, _, cx| measure_surface.update(cx, |s, _| s.surface = bounds),
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .inset_0()
                    .size_full(),
                )
                .on_key_down(move |e: &KeyDownEvent, window, cx| {
                    if e.keystroke.key == "escape" && !e.keystroke.modifiers.modified() {
                        cx.stop_propagation();
                        close(&escape, window, cx);
                    }
                })
                .on_mouse_down_out(move |e: &MouseDownEvent, window, cx| {
                    // Not when the press lands in a popover opened from this one.
                    let stack = cx.default_global::<OpenStack>().0.clone();
                    let mine = stack.iter().position(|s| *s == outside);
                    let inside_inner = mine.is_some_and(|at| {
                        stack[at + 1..]
                            .iter()
                            .any(|inner| inner.read(cx).surface.contains(&e.position))
                    });
                    if !inside_inner {
                        close(&outside, window, cx);
                    }
                }),
            cx,
        )
        .shadow(style::shadow(cx, Token::ShadowMd));
        // The surface takes no room where the trigger is: it floats over everything.
        wrapper.child(
            div().absolute().top_0().left_0().size_0().child(
                deferred(
                    anchored()
                        .attach(trigger, trigger_corner)
                        .anchor(surface_corner)
                        .offset(point(sp(0.), offset))
                        .child(surface),
                )
                .with_priority(1),
            ),
        )
    }
}
