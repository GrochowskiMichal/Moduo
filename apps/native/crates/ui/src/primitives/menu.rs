//! Menus (`dropdown-menu.tsx`, `context-menu.tsx`): one model, two places. A `MenuModel` is drawn as a
//! dropdown under a trigger or as a context menu at the pointer (the web app's `MenuKit`).
//! Arrows move, typing jumps, Right opens a submenu and Left closes it, Enter picks, Esc closes
//! and gives focus back. A long menu scrolls inside the window and fades its foot while more
//! waits below. An item that opens a focus-taking surface runs only once the menu has closed.

use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui_kit::TestSupportExt as _;
use gpui_kit::{
    anchored, canvas, deferred, div, linear_color_stop, linear_gradient, point, prelude::*,
    AnyElement, App, Bounds, ElementId, Entity, FocusHandle, KeyDownEvent, MouseButton,
    MouseDownEvent, Pixels, Point, Role, ScrollHandle, SharedString, Toggled, Window,
};
use moduo_tokens::Token;

use crate::icon::{Icon, IconName, IconSize};
use crate::space::sp;
use crate::text::{self, Family};
use crate::{style, theme};

/// How long typed letters keep adding to one search (Radix's typeahead pause).
pub const TYPEAHEAD_RESET: Duration = Duration::from_millis(1000);

type Select = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(Clone)]
enum Kind {
    Action,
    Checkbox(bool),
    Radio(bool),
    Label,
    Separator,
    Submenu(Vec<MenuItem>),
}

/// One row of a menu.
#[derive(Clone)]
pub struct MenuItem {
    id: SharedString,
    label: SharedString,
    kind: Kind,
    icon: Option<IconName>,
    shortcut: Option<SharedString>,
    destructive: bool,
    disabled: bool,
    keep_open: bool,
    after_close: bool,
    on_select: Option<Select>,
}

impl MenuItem {
    fn new(id: impl Into<SharedString>, label: impl Into<SharedString>, kind: Kind) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            kind,
            icon: None,
            shortcut: None,
            destructive: false,
            disabled: false,
            keep_open: false,
            after_close: false,
            on_select: None,
        }
    }

    pub fn action(id: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self::new(id, label, Kind::Action)
    }

    /// A checkbox item; `on_select` flips it.
    pub fn checkbox(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        checked: bool,
    ) -> Self {
        Self::new(id, label, Kind::Checkbox(checked))
    }

    /// One choice of a radio group; `on_select` picks it.
    pub fn radio(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        checked: bool,
    ) -> Self {
        Self::new(id, label, Kind::Radio(checked))
    }

    /// A small-caps heading over a group.
    pub fn label(text: impl Into<SharedString>) -> Self {
        let text = text.into();
        Self::new(format!("label-{text}"), text, Kind::Label)
    }

    pub fn separator() -> Self {
        Self::new("separator", "", Kind::Separator)
    }

    pub fn submenu(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        children: Vec<MenuItem>,
    ) -> Self {
        Self::new(id, label, Kind::Submenu(children))
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    /// The key it answers to elsewhere, shown at the row's end.
    pub fn shortcut(mut self, keys: impl Into<SharedString>) -> Self {
        self.shortcut = Some(keys.into());
        self
    }

    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// Picking it leaves the menu open (a checkbox you flip several of).
    pub fn keep_open(mut self) -> Self {
        self.keep_open = true;
        self
    }

    /// The action opens something that takes focus (a dialog, a popover, an editor): it runs once
    /// the menu has closed and handed focus back, so the new surface keeps it.
    pub fn after_close(mut self) -> Self {
        self.after_close = true;
        self
    }

    pub fn on_select(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(f));
        self
    }

    fn selectable(&self) -> bool {
        !self.disabled && !matches!(self.kind, Kind::Label | Kind::Separator)
    }
}

/// What a menu shows, written once and drawn as a dropdown or a context menu.
#[derive(Clone, Default)]
pub struct MenuModel {
    items: Vec<MenuItem>,
}

impl MenuModel {
    pub fn new(items: Vec<MenuItem>) -> Self {
        Self { items }
    }
}

type Build = Rc<dyn Fn(&mut Window, &mut App) -> MenuModel>;

#[derive(Clone, Copy)]
enum Place {
    Below(Bounds<Pixels>),
    At(Point<Pixels>),
}

/// What an open menu keeps between frames.
pub struct MenuState {
    open: bool,
    place: Place,
    /// The trigger's bounds, kept current for a dropdown.
    trigger: Bounds<Pixels>,
    /// The highlighted row per open level; a level past the first is the submenu of the row
    /// highlighted on the level before it.
    levels: Vec<Option<usize>>,
    /// Where each open level's surface is, for presses that land in a submenu.
    surfaces: Vec<Bounds<Pixels>>,
    /// Where each submenu row is, for its submenu to attach to.
    rows: Vec<(SharedString, Bounds<Pixels>)>,
    scrolls: Vec<ScrollHandle>,
    more_below: Vec<bool>,
    typed: String,
    typed_at: Option<Instant>,
    focus: Option<FocusHandle>,
    restore: Option<FocusHandle>,
}

impl MenuState {
    fn scroll(&mut self, level: usize) -> ScrollHandle {
        while self.scrolls.len() <= level {
            self.scrolls.push(ScrollHandle::new());
        }
        self.scrolls[level].clone()
    }
}

fn items_at<'a>(model: &'a MenuModel, levels: &[Option<usize>], depth: usize) -> &'a [MenuItem] {
    let mut items = model.items.as_slice();
    for level in levels.iter().take(depth) {
        match level.and_then(|i| items.get(i)).map(|i| &i.kind) {
            Some(Kind::Submenu(children)) => items = children,
            _ => return &[],
        }
    }
    items
}

fn first_selectable(items: &[MenuItem]) -> Option<usize> {
    items.iter().position(MenuItem::selectable)
}

fn close(state: &Entity<MenuState>, window: &mut Window, cx: &mut App) {
    let restore = state.update(cx, |s, cx| {
        s.open = false;
        s.levels.clear();
        s.surfaces.clear();
        s.typed.clear();
        cx.notify();
        s.restore.take()
    });
    if let Some(restore) = restore {
        restore.focus(window, cx);
    }
    window.refresh();
}

fn open(state: &Entity<MenuState>, place: Place, window: &mut Window, cx: &mut App) {
    let previous = window.focused(cx);
    let focus = state.update(cx, |s, cx| {
        s.open = true;
        s.place = place;
        s.levels = vec![None];
        s.surfaces.clear();
        s.more_below.clear();
        s.typed.clear();
        s.restore = previous;
        for scroll in &s.scrolls {
            scroll.set_offset(Point::default());
        }
        cx.notify();
        s.focus.get_or_insert_with(|| cx.focus_handle()).clone()
    });
    focus.focus(window, cx);
    window.refresh();
}

/// Runs a picked row: a submenu opens, a checkbox kept open stays, anything else closes the menu
/// (before the action when the action takes focus).
fn pick(
    state: &Entity<MenuState>,
    depth: usize,
    ix: usize,
    item: &MenuItem,
    window: &mut Window,
    cx: &mut App,
) {
    if !item.selectable() {
        return;
    }
    if let Kind::Submenu(children) = &item.kind {
        let first = first_selectable(children);
        state.update(cx, |s, cx| {
            s.levels.truncate(depth + 1);
            s.levels[depth] = Some(ix);
            s.levels.push(first);
            cx.notify();
        });
        return;
    }
    let action = item.on_select.clone();
    if item.keep_open {
        if let Some(f) = action {
            f(window, cx);
        }
        window.refresh();
        return;
    }
    if item.after_close {
        close(state, window, cx);
        if let Some(f) = action {
            window.defer(cx, move |window, cx| f(window, cx));
        }
        return;
    }
    if let Some(f) = action {
        f(window, cx);
    }
    close(state, window, cx);
}

fn step(items: &[MenuItem], from: Option<usize>, down: bool) -> Option<usize> {
    let n = items.len();
    let mut ix = match (from, down) {
        (None, true) => return first_selectable(items),
        (None, false) => return items.iter().rposition(MenuItem::selectable),
        (Some(i), _) => i,
    };
    loop {
        if down {
            if ix + 1 >= n {
                return from;
            }
            ix += 1;
        } else {
            if ix == 0 {
                return from;
            }
            ix -= 1;
        }
        if items[ix].selectable() {
            return Some(ix);
        }
    }
}

/// The next row whose label starts with what was typed, from after the highlight.
fn typeahead(items: &[MenuItem], from: Option<usize>, typed: &str) -> Option<usize> {
    let start = from.map_or(0, |i| i + 1);
    let n = items.len();
    (0..n)
        .map(|k| (start + k) % n)
        .find(|&i| items[i].selectable() && items[i].label.to_lowercase().starts_with(typed))
}

fn on_key(
    state: &Entity<MenuState>,
    model: &MenuModel,
    e: &KeyDownEvent,
    window: &mut Window,
    cx: &mut App,
) {
    let levels = state.read(cx).levels.clone();
    let depth = levels.len().saturating_sub(1);
    let items = items_at(model, &levels, depth);
    let current = levels.last().copied().flatten();
    let key = e.keystroke.key.as_str();
    let mods = e.keystroke.modifiers;
    let set = |state: &Entity<MenuState>, ix: Option<usize>, cx: &mut App| {
        state.update(cx, |s, cx| {
            if let Some(last) = s.levels.last_mut() {
                *last = ix;
            }
            if let Some(ix) = ix {
                let scroll = s.scroll(s.levels.len() - 1);
                scroll.scroll_to_item(ix);
            }
            cx.notify();
        });
    };
    match key {
        "escape" => close(state, window, cx),
        "down" | "up" => set(state, step(items, current, key == "down"), cx),
        "home" => set(state, first_selectable(items), cx),
        "end" => set(state, items.iter().rposition(MenuItem::selectable), cx),
        "right" => {
            if let Some(ix) = current.filter(|&i| matches!(items[i].kind, Kind::Submenu(_))) {
                pick(state, depth, ix, &items[ix].clone(), window, cx);
            }
        }
        "left" if depth > 0 => state.update(cx, |s, cx| {
            s.levels.pop();
            s.surfaces.truncate(s.levels.len());
            cx.notify();
        }),
        "enter" | "space" => {
            if let Some(ix) = current {
                pick(state, depth, ix, &items[ix].clone(), window, cx);
            }
        }
        _ => {
            let Some(ch) =
                e.keystroke.key_char.as_deref().filter(|c| {
                    !mods.control && !mods.platform && !mods.alt && c.chars().count() == 1
                })
            else {
                return;
            };
            let now = Instant::now();
            let typed = state.update(cx, |s, _| {
                let stale = s
                    .typed_at
                    .is_none_or(|t| now.duration_since(t) > TYPEAHEAD_RESET);
                if stale {
                    s.typed.clear();
                }
                s.typed.push_str(&ch.to_lowercase());
                s.typed_at = Some(now);
                s.typed.clone()
            });
            // One letter typed again moves on to the next match; more letters refine the match.
            let from = if typed.chars().count() == 1 {
                current
            } else {
                current.map(|i| i.saturating_sub(1))
            };
            if let Some(ix) = typeahead(items, from, &typed) {
                set(state, Some(ix), cx);
            }
        }
    }
    cx.stop_propagation();
}

fn indicator(item: &MenuItem) -> Option<AnyElement> {
    match item.kind {
        Kind::Checkbox(true) => Some(
            Icon::new(IconName::Check)
                .size(IconSize::Sm)
                .into_any_element(),
        ),
        Kind::Radio(true) => Some(
            Icon::new(IconName::Circle)
                .size(IconSize::Xs)
                .into_any_element(),
        ),
        _ => None,
    }
}

fn row(
    state: &Entity<MenuState>,
    depth: usize,
    ix: usize,
    item: &MenuItem,
    highlighted: bool,
    open_sub: bool,
    cx: &mut App,
) -> AnyElement {
    match item.kind {
        Kind::Separator => {
            return div()
                .flex_none()
                .h(sp(0.25))
                .mx(-sp(1.))
                .my(sp(1.))
                .bg(theme::color(cx, Token::Border))
                .into_any_element();
        }
        Kind::Label => {
            return div()
                .px(sp(2.))
                .py(sp(1.5))
                .child(super::Eyebrow::new(item.label.clone()))
                .into_any_element();
        }
        _ => {}
    }
    let c = |t: Token| theme::color(cx, t);
    let lit = highlighted || open_sub;
    let (fg, bg) = match (item.destructive, lit) {
        (true, true) => (
            c(Token::Destructive),
            Some(theme::color_alpha(cx, Token::Destructive, 10.0)),
        ),
        (true, false) => (c(Token::Destructive), None),
        (false, true) => (c(Token::Foreground), Some(c(Token::StateActive))),
        (false, false) => (c(Token::PopoverForeground), None),
    };
    let muted = if item.destructive {
        c(Token::Destructive)
    } else {
        c(Token::MutedForeground)
    };
    let checkable = matches!(item.kind, Kind::Checkbox(_) | Kind::Radio(_));
    let role = match item.kind {
        Kind::Checkbox(_) => Role::MenuItemCheckBox,
        Kind::Radio(_) => Role::MenuItemRadio,
        _ => Role::MenuItem,
    };
    let el = div()
        .id(ElementId::Name(item.id.clone()))
        .test_support()
        .role(role)
        .aria_label(item.label.clone())
        .aria_selected(highlighted)
        .when(checkable, |el| {
            let on = matches!(item.kind, Kind::Checkbox(true) | Kind::Radio(true));
            el.aria_toggled(if on { Toggled::True } else { Toggled::False })
        })
        .when(matches!(item.kind, Kind::Submenu(_)), |el| {
            el.aria_expanded(open_sub)
        })
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .gap(sp(2.))
        .px(sp(2.))
        .py(sp(1.5))
        .when(checkable, |el| el.pl(sp(8.)))
        .rounded(theme::px(cx, Token::RadiusSm))
        .text_color(fg)
        .when_some(bg, |el, bg| el.bg(bg))
        .when(item.disabled, |el| el.opacity(0.5));
    let el = text::font(
        el,
        Family::Sans,
        Token::TextSm,
        Token::FontWeightRegular,
        cx,
    )
    .when(checkable, |el| {
        el.child(
            div()
                .absolute()
                .left(sp(2.))
                .flex()
                .items_center()
                .justify_center()
                .size(sp(3.5))
                .children(indicator(item)),
        )
    })
    .children(
        item.icon
            .map(|i| Icon::new(i).size(IconSize::Sm).color(muted)),
    )
    .child(div().flex_1().whitespace_nowrap().child(item.label.clone()))
    .children(item.shortcut.clone().map(|keys| {
        text::font(
            div().ml_auto().pl(sp(4.)),
            Family::Mono,
            Token::TextXs,
            Token::FontWeightRegular,
            cx,
        )
        .text_color(c(Token::MutedForeground))
        .child(keys)
    }))
    .when(matches!(item.kind, Kind::Submenu(_)), |el| {
        let measure = state.clone();
        let id = item.id.clone();
        el.child(
            div().ml_auto().child(
                Icon::new(IconName::ChevronRight)
                    .size(IconSize::Sm)
                    .color(muted),
            ),
        )
        .child(
            canvas(
                move |bounds, _, cx| {
                    measure.update(cx, |s, _| {
                        s.rows.retain(|(r, _)| *r != id);
                        s.rows.push((id.clone(), bounds));
                    })
                },
                |_, _, _, _| {},
            )
            .absolute()
            .inset_0()
            .size_full(),
        )
    });
    if item.disabled {
        return el.into_any_element();
    }
    let hover = state.clone();
    let press = state.clone();
    let picked = item.clone();
    let is_sub = matches!(item.kind, Kind::Submenu(_));
    el.on_mouse_move(move |_, _, cx| {
        let changed = hover.read(cx).levels.get(depth).copied().flatten() != Some(ix);
        if changed {
            hover.update(cx, |s, cx| {
                s.levels.truncate(depth + 1);
                if let Some(l) = s.levels.get_mut(depth) {
                    *l = Some(ix);
                }
                s.surfaces.truncate(s.levels.len());
                if is_sub {
                    s.levels.push(None);
                }
                cx.notify();
            });
        }
    })
    .on_click(move |_, window, cx| {
        cx.stop_propagation();
        pick(&press, depth, ix, &picked, window, cx);
    })
    .into_any_element()
}

/// The room a surface may take on its better side, so a long menu scrolls instead of running
/// past the window.
fn room(place: Place, window: &Window) -> Pixels {
    let height = window.viewport_size().height;
    let margin = sp(2.);
    match place {
        Place::Below(t) => (height - t.bottom()).max(t.top()) - sp(1.) - margin,
        Place::At(p) => (height - p.y).max(p.y) - margin,
    }
    .max(sp(16.))
}

/// One level's surface: the rows, scrolling when long, and the fade at its foot.
fn surface(
    id: ElementId,
    state: &Entity<MenuState>,
    model: &MenuModel,
    depth: usize,
    max_h: Pixels,
    window: &mut Window,
    cx: &mut App,
) -> gpui_kit::base::test_support::Observed<gpui_kit::Stateful<gpui_kit::Div>> {
    let (levels, scroll, more_below) = state.update(cx, |s, _| {
        (
            s.levels.clone(),
            s.scroll(depth),
            s.more_below.get(depth).copied().unwrap_or(false),
        )
    });
    let items = items_at(model, &levels, depth).to_vec();
    let highlight = levels.get(depth).copied().flatten();
    // The last row highlighted is scrolled into view this frame: nothing waits below it.
    let more_below = more_below && highlight != items.iter().rposition(MenuItem::selectable);
    let sub_open = levels.len() > depth + 1;
    let rows: Vec<AnyElement> = items
        .iter()
        .enumerate()
        .map(|(ix, item)| {
            let lit = highlight == Some(ix);
            row(
                state,
                depth,
                ix,
                item,
                lit && !sub_open,
                lit && sub_open,
                cx,
            )
        })
        .collect();
    let list_id = ElementId::Name(format!("{id}-list").into());
    let fade_id = ElementId::Name(format!("{id}-fade").into());
    let measure = state.clone();
    let watch = scroll.clone();
    let fade_bg = theme::color(cx, Token::Popover);
    let mut fade_top = fade_bg;
    fade_top.a = 0.;
    let _ = window;
    let el = div()
        .id(id)
        .test_support()
        .role(Role::Menu)
        .relative()
        .min_w(sp(32.))
        .max_h(max_h)
        .flex()
        .flex_col()
        .occlude()
        .child(
            div()
                .id(list_id)
                .flex()
                .flex_col()
                .p(sp(1.))
                .max_h(max_h)
                .overflow_y_scroll()
                .track_scroll(&scroll)
                .on_scroll(|_, window, _| window.refresh())
                .children(rows),
        )
        .child(
            canvas(
                move |bounds, window, cx| {
                    let below = -watch.offset().y < watch.max_offset().y - gpui_kit::px(1.); // design-literal: a pixel of rounding slack
                    measure.update(cx, |s, _| {
                        while s.surfaces.len() <= depth {
                            s.surfaces.push(Bounds::default());
                        }
                        s.surfaces[depth] = bounds;
                        while s.more_below.len() <= depth {
                            s.more_below.push(false);
                        }
                        if s.more_below[depth] != below {
                            s.more_below[depth] = below;
                            window.refresh();
                        }
                    });
                },
                |_, _, _, _| {},
            )
            .absolute()
            .inset_0()
            .size_full(),
        )
        .when(more_below, |el| {
            el.child(
                div()
                    .id(fade_id)
                    .test_support()
                    .absolute()
                    .bottom_0()
                    .left_0()
                    .right_0()
                    .h(theme::px(cx, Token::MenuFade))
                    .bg(linear_gradient(
                        180.,
                        linear_color_stop(fade_top, 0.),
                        linear_color_stop(fade_bg, 1.),
                    )),
            )
        });
    style::floating_surface(el, cx).shadow(style::shadow(cx, Token::ShadowMd))
}

/// Every open level, the deeper ones floating beside their row.
fn levels_view(
    menu_id: &SharedString,
    state: &Entity<MenuState>,
    model: &MenuModel,
    depth: usize,
    max_h: Pixels,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let levels = state.read(cx).levels.clone();
    let id: ElementId = if depth == 0 {
        ElementId::Name(format!("{menu_id}-menu").into())
    } else {
        let parent = items_at(model, &levels, depth - 1);
        let row_id = levels[depth - 1]
            .and_then(|i| parent.get(i))
            .map(|i| i.id.clone())
            .unwrap_or_default();
        ElementId::Name(format!("{row_id}-sub").into())
    };
    let mut el = surface(id, state, model, depth, max_h, window, cx);
    if levels.len() > depth + 1 {
        let parent = items_at(model, &levels, depth);
        let row_id = levels[depth]
            .and_then(|i| parent.get(i))
            .map(|i| i.id.clone());
        let at = row_id.and_then(|r| {
            state
                .read(cx)
                .rows
                .iter()
                .find(|(id, _)| *id == r)
                .map(|(_, b)| *b)
        });
        if let Some(at) = at {
            let inner = levels_view(menu_id, state, model, depth + 1, max_h, window, cx);
            el = el.child(
                div().absolute().top_0().left_0().size_0().child(
                    deferred(
                        anchored()
                            .position(at.top_right())
                            .offset(point(sp(1.), -sp(1.)))
                            .snap_to_window_with_margin(sp(2.))
                            .child(inner),
                    )
                    .with_priority(2 + depth),
                ),
            );
        }
    }
    el.into_any_element()
}

fn root(
    menu_id: &SharedString,
    state: &Entity<MenuState>,
    build: &Build,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let model = build(window, cx);
    let place = state.read(cx).place;
    let focus = state.update(cx, |s, cx| {
        s.focus.get_or_insert_with(|| cx.focus_handle()).clone()
    });
    let max_h = room(place, window);
    let keys = state.clone();
    let key_model = model.clone();
    let outside = state.clone();
    let tree = levels_view(menu_id, state, &model, 0, max_h, window, cx);
    let host = div()
        .track_focus(&focus)
        .on_key_down(move |e: &KeyDownEvent, window, cx| on_key(&keys, &key_model, e, window, cx))
        .on_mouse_down_out(move |e: &MouseDownEvent, window, cx| {
            let inside = outside
                .read(cx)
                .surfaces
                .iter()
                .any(|b| b.contains(&e.position));
            if !inside {
                close(&outside, window, cx);
            }
        })
        .child(tree);
    let positioned = match place {
        Place::Below(trigger) => anchored()
            .attach(trigger, gpui_kit::Anchor::BottomLeft)
            .anchor(gpui_kit::Anchor::TopLeft)
            .offset(point(sp(0.), sp(1.)))
            .child(host),
        Place::At(p) => anchored()
            .position(p)
            .anchor(gpui_kit::Anchor::TopLeft)
            .snap_to_window_with_margin(sp(2.))
            .child(host),
    };
    div()
        .absolute()
        .top_0()
        .left_0()
        .size_0()
        .child(deferred(positioned).with_priority(1))
        .into_any_element()
}

fn use_state(id: &ElementId, window: &mut Window, cx: &mut App) -> Entity<MenuState> {
    window.use_keyed_state(id.clone(), cx, |_, _| MenuState {
        open: false,
        place: Place::At(Point::default()),
        trigger: Bounds::default(),
        levels: Vec::new(),
        surfaces: Vec::new(),
        rows: Vec::new(),
        scrolls: Vec::new(),
        more_below: Vec::new(),
        typed: String::new(),
        typed_at: None,
        focus: None,
        restore: None,
    })
}

/// A menu under a trigger, opened by pressing it.
#[derive(IntoElement)]
pub struct DropdownMenu {
    id: SharedString,
    trigger: AnyElement,
    build: Build,
}

impl DropdownMenu {
    pub fn new(
        id: impl Into<SharedString>,
        trigger: impl IntoElement,
        model: impl Fn(&mut Window, &mut App) -> MenuModel + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            trigger: trigger.into_any_element(),
            build: Rc::new(model),
        }
    }
}

impl RenderOnce for DropdownMenu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let el_id = ElementId::Name(self.id.clone());
        let state = use_state(&el_id, window, cx);
        let measure = state.clone();
        let toggle = state.clone();
        let wrapper = div()
            .id(el_id)
            .relative()
            .flex_none()
            .child(self.trigger)
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
                } else {
                    let trigger = toggle.read(cx).trigger;
                    open(&toggle, Place::Below(trigger), window, cx);
                }
            });
        if !state.read(cx).open {
            return wrapper;
        }
        let menu = root(&self.id, &state, &self.build, window, cx);
        wrapper.child(menu)
    }
}

/// A menu at the pointer, opened by a right press on its area.
#[derive(IntoElement)]
pub struct ContextMenu {
    id: SharedString,
    area: AnyElement,
    build: Build,
}

impl ContextMenu {
    pub fn new(
        id: impl Into<SharedString>,
        area: impl IntoElement,
        model: impl Fn(&mut Window, &mut App) -> MenuModel + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            area: area.into_any_element(),
            build: Rc::new(model),
        }
    }
}

impl RenderOnce for ContextMenu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let el_id = ElementId::Name(format!("{}-context", self.id).into());
        let state = use_state(&el_id, window, cx);
        let opener = state.clone();
        let wrapper = div()
            .id(el_id)
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .child(self.area)
            .on_mouse_down(MouseButton::Right, move |e: &MouseDownEvent, window, cx| {
                cx.stop_propagation();
                open(&opener, Place::At(e.position), window, cx);
            });
        if !state.read(cx).open {
            return wrapper;
        }
        let menu = root(&self.id, &state, &self.build, window, cx);
        wrapper.child(menu)
    }
}

/// A dropdown from a trigger (the web app's `DropdownMenu`).
pub fn dropdown(
    id: impl Into<SharedString>,
    trigger: impl IntoElement,
    model: impl Fn(&mut Window, &mut App) -> MenuModel + 'static,
) -> DropdownMenu {
    DropdownMenu::new(id, trigger, model)
}

/// A context menu over an area (the web app's `ContextMenu`).
pub fn context_menu(
    id: impl Into<SharedString>,
    area: impl IntoElement,
    model: impl Fn(&mut Window, &mut App) -> MenuModel + 'static,
) -> ContextMenu {
    ContextMenu::new(id, area, model)
}
