//! What every pressable control shares: a focus handle that lives across renders, a Tab stop, the
//! ring, and a press from the pointer, Enter or Space (GPUI turns the keys into a click on the
//! focused element). A disabled control is not a Tab stop and answers nothing.

use std::rc::Rc;

use gpui_kit::{div, prelude::*, App, Div, ElementId, FocusHandle, MouseButton, Stateful, Window};

/// A press handler.
pub type OnPress = Rc<dyn Fn(&mut Window, &mut App)>;

pub(crate) fn pressable(
    id: ElementId,
    disabled: bool,
    on_press: Option<OnPress>,
    window: &mut Window,
    cx: &mut App,
) -> (Stateful<Div>, FocusHandle) {
    let handle = window
        .use_keyed_state(id.clone(), cx, |_, cx| cx.focus_handle())
        .read(cx)
        .clone();
    let el = div().id(id).track_focus(&handle);
    if disabled {
        return (el, handle);
    }
    let focus = handle.clone();
    let el = crate::focus::ring(el.tab_index(0), cx)
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            focus.focus(window, cx)
        });
    let el = match on_press {
        Some(press) => el.on_click(move |_, window, cx| {
            // A press inside a row must not also select the row.
            cx.stop_propagation();
            press(window, cx)
        }),
        None => el,
    };
    (el, handle)
}
