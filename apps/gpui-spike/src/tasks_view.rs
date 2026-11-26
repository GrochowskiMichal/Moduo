//! The Tasks screen: projects on the left, a virtualised task list in the
//! middle, the selected task's editor on the right. Every edit is applied
//! locally first and then sent through the same RPC the web app uses; a failed
//! write re-reads the task so the screen never keeps a change the server refused.

use std::time::Duration;

use anyhow::Result;
use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::calendar::Date;
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::date_picker::{DatePicker, DatePickerEvent, DatePickerState};
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _, Sizable as _};
use gpui_kit::{
    div, px, uniform_list, App, AppContext as _, Context, Entity, FocusHandle, Focusable, FontWeight,
    InteractiveElement as _, IntoElement, KeyBinding, ParentElement as _, Render, ScrollStrategy, SharedString,
    StatefulInteractiveElement as _, Styled as _, Subscription, UniformListScrollHandle, WeakEntity, Window,
};
use jiff::civil;
use serde_json::{json, Value};

use crate::api::Api;
use crate::model::{self, end_position, midpoint, Nav, Row, Store, Task, Workspace};

gpui_kit::actions!(
    tasks,
    [SelectNext, SelectPrev, ToggleDone, EditTitle, NewTask, DeleteTask, UndoDelete, MoveUp, MoveDown, Refresh]
);

const LIST: &str = "TaskList";
const SCREEN: &str = "Tasks";
const ROW_HEIGHT: f32 = 34.;
const POLL: Duration = Duration::from_secs(4);
/// Projects, sections and statuses are re-read whole on every Nth poll.
const STRUCTURE_EVERY: u32 = 8;

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("down", SelectNext, Some(LIST)),
        KeyBinding::new("j", SelectNext, Some(LIST)),
        KeyBinding::new("up", SelectPrev, Some(LIST)),
        KeyBinding::new("k", SelectPrev, Some(LIST)),
        KeyBinding::new("space", ToggleDone, Some(LIST)),
        KeyBinding::new("enter", EditTitle, Some(LIST)),
        KeyBinding::new("cmd-backspace", DeleteTask, Some(LIST)),
        KeyBinding::new("cmd-z", UndoDelete, Some(LIST)),
        KeyBinding::new("alt-up", MoveUp, Some(LIST)),
        KeyBinding::new("alt-down", MoveDown, Some(LIST)),
        KeyBinding::new("cmd-n", NewTask, Some(SCREEN)),
        KeyBinding::new("cmd-r", Refresh, Some(SCREEN)),
    ]);
}

pub struct TasksView {
    api: Api,
    ws: Workspace,
    store: Store,
    nav: Nav,
    show_closed: bool,
    rows: Vec<Row>,
    selected: Option<String>,
    /// The task whose title, notes and due date are in the editors.
    editing: Option<String>,
    last_deleted: Option<Task>,
    notice: Option<SharedString>,
    loading: bool,
    syncing: bool,
    polls: u32,
    /// Local-stack test hook: open the first task once the list has loaded.
    autoselect: bool,
    focus: FocusHandle,
    scroll: UniformListScrollHandle,
    quick_add: Entity<InputState>,
    title: Entity<InputState>,
    notes: Entity<TextareaState>,
    due: Entity<DatePickerState>,
    on_sign_out: Box<dyn Fn(&mut Window, &mut App)>,
    _subscriptions: Vec<Subscription>,
    _poll: gpui_kit::Task<()>,
}

impl Focusable for TasksView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl TasksView {
    pub fn new(
        api: Api,
        ws: Workspace,
        on_sign_out: impl Fn(&mut Window, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let quick_add = cx.new(|cx| InputState::new(window, cx).placeholder("New task, then Enter"));
        let title = cx.new(|cx| InputState::new(window, cx).placeholder("Title"));
        let notes = cx.new(|cx| TextareaState::new(window, cx).placeholder("Notes"));
        let due = cx.new(|cx| DatePickerState::new(window, cx));

        let subscriptions = vec![
            cx.subscribe_in(&quick_add, window, |this, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.create_from_quick_add(window, cx);
                }
            }),
            cx.subscribe_in(&title, window, |this, _, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { .. } => {
                    this.commit_edits(cx);
                    this.focus.focus(window, cx);
                }
                InputEvent::Blur => this.commit_edits(cx),
                _ => {}
            }),
            cx.subscribe_in(&notes, window, |this, _, event: &InputEvent, _, cx| {
                if let InputEvent::Blur = event {
                    this.commit_edits(cx);
                }
            }),
            cx.subscribe_in(&due, window, |this, _, event: &DatePickerEvent, _, cx| {
                let DatePickerEvent::Change(value) = event;
                let day = match value.date() {
                    Date::Single(day) => day.map(|d| d.to_string()),
                    Date::Range(start, _) => start.map(|d| d.to_string()),
                };
                this.set_due(day, cx);
            }),
            cx.observe_window_activation(window, |this, window, cx| {
                if window.is_window_active() {
                    this.sync(cx);
                }
            }),
        ];

        let poll = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(POLL).await;
            if this.update(cx, |this, cx| this.sync(cx)).is_err() {
                break;
            }
        });

        let api_is_local = api.config.is_local();
        let mut view = Self {
            api,
            ws,
            store: Store::default(),
            nav: Nav::AllOpen,
            show_closed: false,
            rows: Vec::new(),
            selected: None,
            editing: None,
            last_deleted: None,
            notice: None,
            loading: true,
            syncing: false,
            polls: 0,
            autoselect: api_is_local && std::env::var("MODUO_SPIKE_SELECT_FIRST").is_ok(),
            focus: cx.focus_handle(),
            scroll: UniformListScrollHandle::new(),
            quick_add,
            title,
            notes,
            due,
            on_sign_out: Box::new(on_sign_out),
            _subscriptions: subscriptions,
            _poll: poll,
        };
        view.load_everything(cx);
        view
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    fn load_everything(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        let (api, ws) = (self.api.clone(), self.ws.id.clone());
        cx.spawn(async move |this, cx| {
            let loaded = cx
                .background_executor()
                .spawn(async move { Ok::<_, anyhow::Error>((model::load_structure(&api, &ws)?, model::load_tasks(&api, &ws)?)) })
                .await;
            this.update(cx, |this, cx| {
                this.loading = false;
                match loaded {
                    Ok((structure, tasks)) => {
                        this.store.set_structure(structure);
                        this.store.tasks.clear();
                        this.store.apply(tasks, true);
                        this.notice = None;
                    }
                    Err(err) => this.notice = Some(format!("Could not load tasks: {err}").into()),
                }
                this.rebuild(cx);
            })
            .ok();
        })
        .detach();
    }

    /// One delta read: tasks changed since the cursor, and now and then the
    /// structure tables whole. Realtime is not wired; this poll stands in for it.
    fn sync(&mut self, cx: &mut Context<Self>) {
        let Some(cursor) = self.store.cursor else { return };
        if self.syncing || self.loading {
            return;
        }
        self.syncing = true;
        self.polls += 1;
        let with_structure = self.polls % STRUCTURE_EVERY == 0;
        let (api, ws) = (self.api.clone(), self.ws.id.clone());
        cx.spawn(async move |this, cx| {
            let read = cx
                .background_executor()
                .spawn(async move {
                    let structure = if with_structure { Some(model::load_structure(&api, &ws)?) } else { None };
                    Ok::<_, anyhow::Error>((structure, model::load_delta(&api, &ws, cursor)?))
                })
                .await;
            this.update(cx, |this, cx| {
                this.syncing = false;
                if let Ok((structure, rows)) = read {
                    let mut changed = this.store.apply(rows, false);
                    if let Some(structure) = structure {
                        this.store.set_structure(structure);
                        changed = true;
                    }
                    if changed {
                        this.rebuild(cx);
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn rebuild(&mut self, cx: &mut Context<Self>) {
        self.rows = self.store.rows(&self.nav, self.show_closed);
        if let Some(id) = &self.selected {
            if !self.store.tasks.contains_key(id) {
                self.selected = None;
                self.editing = None;
            }
        }
        cx.notify();
    }

    // ── Writes ──────────────────────────────────────────────────────────────

    /// Send one write. The server's answer replaces the optimistic row; a
    /// refusal re-reads the task and says why.
    fn write(
        &mut self,
        task_id: String,
        cx: &mut Context<Self>,
        call: impl FnOnce(&Api, &str) -> Result<Vec<Task>> + Send + 'static,
    ) {
        let (api, ws) = (self.api.clone(), self.ws.id.clone());
        cx.spawn(async move |this, cx| {
            let outcome = cx
                .background_executor()
                .spawn(async move {
                    match call(&api, &ws) {
                        Ok(rows) => Ok(rows),
                        Err(err) => Err((err, model::load_task(&api, &task_id), task_id)),
                    }
                })
                .await;
            this.update(cx, |this, cx| {
                match outcome {
                    Ok(rows) => {
                        this.store.apply(rows, true);
                    }
                    Err((err, server, task_id)) => {
                        this.notice = Some(format!("Not saved: {err}").into());
                        match server {
                            Ok(rows) if !rows.is_empty() => {
                                this.store.apply(rows, true);
                            }
                            // Gone, or never created: drop the optimistic row.
                            Ok(_) => {
                                this.store.tasks.remove(&task_id);
                            }
                            Err(_) => {}
                        }
                    }
                }
                this.rebuild(cx);
            })
            .ok();
        })
        .detach();
    }

    fn patch(&mut self, id: &str, patch: Value, cx: &mut Context<Self>) {
        let task_id = id.to_string();
        self.write(id.to_string(), cx, move |api, ws| model::update_task(api, ws, &task_id, patch));
    }

    fn create_from_quick_add(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let title = self.quick_add.read(cx).value().trim().to_string();
        if title.is_empty() {
            return;
        }
        let bucket_id = match &self.nav {
            Nav::Bucket(id) => Some(id.clone()),
            Nav::AllOpen => self.store.inbox().map(|b| b.id.clone()),
        };
        let id = uuid::Uuid::new_v4().to_string();
        let position = end_position(
            self.store
                .tasks
                .values()
                .filter(|t| Some(&t.bucket_id) == bucket_id.as_ref() && t.section_id.is_none() && t.parent_id.is_none())
                .map(|t| t.position.as_str()),
        );
        // The keys the web app's create always sends; the server rejects unknown ones.
        let payload = json!({
            "id": id, "title": title, "description": "", "bucket_id": bucket_id, "parent_id": null,
            "due_on": null, "scheduled_at": null, "duration_minutes": null, "recurrence": null,
            "energy_level": null, "priority": null, "status": "todo", "position": position,
        });
        if let Some(bucket_id) = bucket_id {
            if let Ok(optimistic) = serde_json::from_value::<Task>(json!({
                "id": id, "bucket_id": bucket_id, "title": title, "status_category": "todo", "position": position,
            })) {
                self.store.tasks.insert(id.clone(), optimistic);
            }
        }
        self.quick_add.update(cx, |input, cx| input.set_value("", window, cx));
        self.write(id.clone(), cx, move |api, ws| model::create_task(api, ws, payload));
        self.rebuild(cx);
        self.select(Some(id), window, cx);
        self.quick_add.update(cx, |input, cx| input.focus(window, cx));
    }

    fn toggle_done(&mut self, id: &str, cx: &mut Context<Self>) {
        let Some(task) = self.store.tasks.get_mut(id) else { return };
        let target = if task.is_closed() { "todo" } else { "done" };
        task.status_category = target.to_string();
        task.status_id = None;
        let task_id = id.to_string();
        self.write(id.to_string(), cx, move |api, ws| model::set_status(api, ws, &task_id, target));
        self.rebuild(cx);
    }

    fn set_status(&mut self, id: &str, status_id: String, category: String, cx: &mut Context<Self>) {
        let Some(task) = self.store.tasks.get_mut(id) else { return };
        if task.status_id.as_deref() == Some(status_id.as_str()) {
            return;
        }
        task.status_id = Some(status_id.clone());
        task.status_category = category;
        let task_id = id.to_string();
        self.write(id.to_string(), cx, move |api, ws| model::set_status(api, ws, &task_id, &status_id));
        self.rebuild(cx);
    }

    fn set_priority(&mut self, id: &str, priority: Option<&'static str>, cx: &mut Context<Self>) {
        let Some(task) = self.store.tasks.get_mut(id) else { return };
        if task.priority.as_deref() == priority {
            return;
        }
        task.priority = priority.map(str::to_string);
        self.patch(id, json!({ "priority": priority }), cx);
        cx.notify();
    }

    fn set_due(&mut self, day: Option<String>, cx: &mut Context<Self>) {
        let Some(id) = self.editing.clone() else { return };
        let Some(task) = self.store.tasks.get_mut(&id) else { return };
        // Loading a task into the picker lands here too: only a real change is written.
        if task.due_on == day {
            return;
        }
        task.due_on = day.clone();
        self.patch(&id, json!({ "due_on": day }), cx);
        cx.notify();
    }

    fn move_to(&mut self, id: &str, bucket_id: String, cx: &mut Context<Self>) {
        let position = end_position(
            self.store
                .tasks
                .values()
                .filter(|t| t.bucket_id == bucket_id && t.section_id.is_none() && t.parent_id.is_none())
                .map(|t| t.position.as_str()),
        );
        let Some(task) = self.store.tasks.get_mut(id) else { return };
        if task.bucket_id == bucket_id {
            return;
        }
        task.bucket_id = bucket_id.clone();
        // The server clears the section on a move to another project, and gives
        // the task that project's matching status; the answer carries both.
        task.section_id = None;
        task.position = position.clone();
        self.patch(id, json!({ "bucket_id": bucket_id, "position": position }), cx);
        self.rebuild(cx);
    }

    /// Save the title and notes if they differ from the held task.
    fn commit_edits(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.editing.clone() else { return };
        let title = self.title.read(cx).value().trim().to_string();
        let notes = self.notes.read(cx).value().to_string();
        let Some(task) = self.store.tasks.get_mut(&id) else { return };
        let mut patch = serde_json::Map::new();
        if !title.is_empty() && title != task.title {
            task.title = title.clone();
            patch.insert("title".into(), json!(title));
        }
        if notes != task.description {
            task.description = notes.clone();
            patch.insert("description".into(), json!(notes));
        }
        if patch.is_empty() {
            return;
        }
        self.patch(&id, Value::Object(patch), cx);
        cx.notify();
    }

    fn delete(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let next = self.neighbour_of(id);
        let Some(task) = self.store.tasks.remove(id) else { return };
        self.last_deleted = Some(task);
        self.editing = None;
        self.notice = Some("Task deleted. Press ⌘Z in the list to bring it back.".into());
        self.patch(id, json!({ "deleted_at": jiff::Timestamp::now().to_string() }), cx);
        self.rebuild(cx);
        self.select(next, window, cx);
    }

    fn undo_delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(task) = self.last_deleted.take() else { return };
        let id = task.id.clone();
        self.store.tasks.insert(id.clone(), task);
        self.notice = None;
        self.patch(&id, json!({ "deleted_at": null }), cx);
        self.rebuild(cx);
        self.select(Some(id), window, cx);
    }

    /// Move the selected task one place among its visible siblings by writing
    /// a position key between its new neighbours.
    fn reorder(&mut self, up: bool, cx: &mut Context<Self>) {
        let Some(id) = self.selected.clone() else { return };
        let Some(task) = self.store.tasks.get(&id) else { return };
        let siblings: Vec<&Task> =
            self.store.siblings(task).into_iter().filter(|t| self.show_closed || !t.is_closed()).collect();
        let Some(at) = siblings.iter().position(|t| t.id == id) else { return };
        let (lo, hi): (String, Option<String>) = if up {
            if at == 0 {
                return;
            }
            (if at >= 2 { siblings[at - 2].position.clone() } else { String::new() }, Some(siblings[at - 1].position.clone()))
        } else {
            if at + 1 >= siblings.len() {
                return;
            }
            (siblings[at + 1].position.clone(), siblings.get(at + 2).map(|t| t.position.clone()))
        };
        if hi.as_ref().map_or(false, |hi| &lo >= hi) {
            self.notice = Some("These two tasks share a position; reorder them in the web app once.".into());
            cx.notify();
            return;
        }
        let position = midpoint(&lo, hi.as_deref());
        if let Some(task) = self.store.tasks.get_mut(&id) {
            task.position = position.clone();
        }
        self.patch(&id, json!({ "position": position }), cx);
        self.rebuild(cx);
        self.reveal_selected();
    }

    // ── Selection ───────────────────────────────────────────────────────────

    fn task_rows(&self) -> impl Iterator<Item = (usize, &str)> {
        self.rows.iter().enumerate().filter_map(|(ix, row)| match row {
            Row::Task { id, .. } => Some((ix, id.as_str())),
            Row::Header(_) => None,
        })
    }

    fn neighbour_of(&self, id: &str) -> Option<String> {
        let ids: Vec<&str> = self.task_rows().map(|(_, id)| id).collect();
        let at = ids.iter().position(|other| *other == id)?;
        ids.get(at + 1).or_else(|| at.checked_sub(1).and_then(|i| ids.get(i))).map(|s| s.to_string())
    }

    fn step(&mut self, by: isize, window: &mut Window, cx: &mut Context<Self>) {
        let ids: Vec<String> = self.task_rows().map(|(_, id)| id.to_string()).collect();
        if ids.is_empty() {
            return;
        }
        let current = self.selected.as_ref().and_then(|id| ids.iter().position(|other| other == id));
        let next = match current {
            Some(at) => (at as isize + by).clamp(0, ids.len() as isize - 1) as usize,
            None => 0,
        };
        self.select(Some(ids[next].clone()), window, cx);
    }

    fn select(&mut self, id: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected == id && self.editing == id {
            return;
        }
        self.commit_edits(cx);
        self.selected = id.clone();
        self.editing = None;
        if let Some(task) = id.as_ref().and_then(|id| self.store.tasks.get(id)).cloned() {
            self.title.update(cx, |input, cx| input.set_value(task.title.clone(), window, cx));
            self.notes.update(cx, |input, cx| input.set_value(task.description.clone(), window, cx));
            let day = task.due_on.as_deref().and_then(|d| d.parse::<civil::Date>().ok());
            self.due.update(cx, |picker, cx| picker.set_date(Date::Single(day), window, cx));
            self.editing = id;
        }
        self.reveal_selected();
        cx.notify();
    }

    fn reveal_selected(&self) {
        let Some(id) = &self.selected else { return };
        if let Some((ix, _)) = self.task_rows().find(|(_, other)| other == id) {
            self.scroll.scroll_to_item(ix, ScrollStrategy::Top);
        }
    }

    fn go(&mut self, nav: Nav, window: &mut Window, cx: &mut Context<Self>) {
        self.select(None, window, cx);
        self.nav = nav;
        self.rebuild(cx);
        self.focus.focus(window, cx);
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (muted, sidebar, border, accent) = (theme.muted_foreground, theme.sidebar, theme.sidebar_border, theme.sidebar_accent);
        let open_in = |bucket: &str| self.store.tasks.values().filter(|t| t.bucket_id == bucket && !t.is_closed()).count();
        let all_open = self.store.tasks.values().filter(|t| !t.is_closed()).count();

        let item = |key: SharedString, label: String, count: usize, nav: Nav, cx: &mut Context<Self>| {
            let active = self.nav == nav;
            h_flex()
                .id(key)
                .h(px(30.))
                .px_2()
                .rounded_md()
                .justify_between()
                .cursor_pointer()
                .when_active(active, accent)
                .hover(move |s| s.bg(accent))
                .child(div().truncate().child(label))
                .child(div().text_xs().text_color(muted).child(if count > 0 { count.to_string() } else { String::new() }))
                .on_click(cx.listener(move |this, _, window, cx| this.go(nav.clone(), window, cx)))
        };

        let mut list = v_flex().id("projects").flex_1().overflow_y_scroll().gap_0p5().child(item(
            "nav-all".into(),
            "All open".into(),
            all_open,
            Nav::AllOpen,
            cx,
        ));
        for bucket in self.store.buckets.iter().filter(|b| b.archived_at.is_none()) {
            list = list.child(item(
                format!("nav-{}", bucket.id).into(),
                bucket.name.clone(),
                open_in(&bucket.id),
                Nav::Bucket(bucket.id.clone()),
                cx,
            ));
        }

        let email = self.api.session().map(|s| s.email).unwrap_or_default();
        v_flex()
            .w(px(232.))
            .h_full()
            .flex_none()
            .p_2()
            .gap_2()
            .bg(sidebar)
            .border_r_1()
            .border_color(border)
            .child(div().px_2().pt_1().text_xs().text_color(muted).child(self.ws.name.clone()))
            .child(list)
            .child(
                Checkbox::new("show-closed")
                    .label("Show finished")
                    .checked(self.show_closed)
                    .on_click(cx.listener(|this, checked: &bool, _, cx| {
                        this.show_closed = *checked;
                        this.rebuild(cx);
                    })),
            )
            .child(
                h_flex()
                    .justify_between()
                    .child(div().text_xs().text_color(muted).truncate().child(email))
                    .child(Button::new("sign-out").ghost().xsmall().label("Sign out").on_click(cx.listener(
                        |this, _, window, cx| {
                            this.api.sign_out();
                            (this.on_sign_out)(window, cx);
                        },
                    ))),
            )
    }

    fn render_row(&self, ix: usize, cx: &mut Context<Self>) -> gpui_kit::AnyElement {
        let theme = cx.theme();
        let (muted, border, active, hover, danger) =
            (theme.muted_foreground, theme.border, theme.list_active, theme.list_hover, theme.danger);
        match &self.rows[ix] {
            Row::Header(name) => h_flex()
                .w_full()
                .h(px(ROW_HEIGHT))
                .px_4()
                .items_end()
                .pb_1()
                .text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(muted)
                .child(name.clone())
                .into_any_element(),
            Row::Task { id, depth } => {
                let Some(task) = self.store.tasks.get(id) else { return div().h(px(ROW_HEIGHT)).into_any_element() };
                let selected = self.selected.as_deref() == Some(id.as_str());
                let closed = task.is_closed();
                let today = jiff::ZonedDateTime::now().date();
                let due = task.due_on.as_deref().and_then(|d| d.parse::<civil::Date>().ok());
                let overdue = !closed && due.map_or(false, |d| d < today);
                let (toggle_id, select_id) = (id.clone(), id.clone());
                h_flex()
                    .id(("task-row", ix))
                    .w_full()
                    .h(px(ROW_HEIGHT))
                    .pl(px(16. + 22. * *depth as f32))
                    .pr_4()
                    .gap_2()
                    .border_b_1()
                    .border_color(border.opacity(0.4))
                    .when_active(selected, active)
                    .hover(move |s| if selected { s } else { s.bg(hover) })
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select(Some(select_id.clone()), window, cx);
                        this.focus.focus(window, cx);
                    }))
                    .child(Checkbox::new(("task-done", ix)).checked(task.is_done()).on_click(cx.listener(
                        move |this, _: &bool, _, cx| this.toggle_done(&toggle_id, cx),
                    )))
                    .child(
                        div()
                            .flex_1()
                            .truncate()
                            .when_closed(closed, muted)
                            .child(if task.title.is_empty() { "Untitled".to_string() } else { task.title.clone() }),
                    )
                    .children(task.priority.as_ref().map(|p| div().text_xs().text_color(muted).child(priority_label(Some(p)))))
                    .children(due.map(|d| {
                        div()
                            .text_xs()
                            .text_color(if overdue { danger } else { muted })
                            .child(d.strftime("%b %-d").to_string())
                    }))
                    .child(div().w(px(96.)).text_xs().text_color(muted).truncate().child(self.store.status_name(task)))
                    .into_any_element()
            }
        }
    }

    fn render_list(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (muted, border) = (theme.muted_foreground, theme.border);
        let heading = match &self.nav {
            Nav::AllOpen => "All open".to_string(),
            Nav::Bucket(id) => self.store.bucket_name(id),
        };
        let count = self.task_rows().count();
        let body = if self.loading {
            div().p_4().text_color(muted).child("Loading tasks…").into_any_element()
        } else if self.rows.is_empty() {
            div().p_4().text_color(muted).child("Nothing here yet. Type a task above and press Enter.").into_any_element()
        } else {
            uniform_list("task-rows", self.rows.len(), cx.processor(|this, range: std::ops::Range<usize>, _, cx| {
                range.map(|ix| this.render_row(ix, cx)).collect::<Vec<_>>()
            }))
            .track_scroll(&self.scroll)
            .size_full()
            .into_any_element()
        };
        v_flex()
            .flex_1()
            .min_w_0()
            .h_full()
            .child(
                v_flex()
                    .p_4()
                    .gap_3()
                    .border_b_1()
                    .border_color(border)
                    .child(
                        h_flex()
                            .gap_2()
                            .items_baseline()
                            .child(div().text_xl().font_weight(FontWeight::SEMIBOLD).child(heading))
                            .child(div().text_sm().text_color(muted).child(format!("{count} tasks"))),
                    )
                    .child(Input::new(&self.quick_add)),
            )
            .child(
                v_flex()
                    .id("task-list")
                    .flex_1()
                    .min_h_0()
                    .key_context(LIST)
                    .track_focus(&self.focus)
                    .on_action(cx.listener(|this, _: &SelectNext, window, cx| this.step(1, window, cx)))
                    .on_action(cx.listener(|this, _: &SelectPrev, window, cx| this.step(-1, window, cx)))
                    .on_action(cx.listener(|this, _: &ToggleDone, _, cx| {
                        if let Some(id) = this.selected.clone() {
                            this.toggle_done(&id, cx);
                        }
                    }))
                    .on_action(cx.listener(|this, _: &EditTitle, window, cx| {
                        if this.editing.is_some() {
                            this.title.update(cx, |input, cx| input.focus(window, cx));
                        }
                    }))
                    .on_action(cx.listener(|this, _: &DeleteTask, window, cx| {
                        if let Some(id) = this.selected.clone() {
                            this.delete(&id, window, cx);
                        }
                    }))
                    .on_action(cx.listener(|this, _: &UndoDelete, window, cx| this.undo_delete(window, cx)))
                    .on_action(cx.listener(|this, _: &MoveUp, _, cx| this.reorder(true, cx)))
                    .on_action(cx.listener(|this, _: &MoveDown, _, cx| this.reorder(false, cx)))
                    .child(body),
            )
    }

    fn render_detail(&self, task: &Task, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (muted, border) = (theme.muted_foreground, theme.border);
        let weak: WeakEntity<Self> = cx.entity().downgrade();
        let id = task.id.clone();

        let statuses: Vec<(String, String, String)> = self
            .store
            .statuses_for(&task.bucket_id)
            .into_iter()
            .map(|s| (s.id.clone(), s.category.clone(), s.name.clone()))
            .collect();
        let status_menu = {
            let (weak, id, current) = (weak.clone(), id.clone(), task.status_id.clone());
            Button::new("status").small().outline().dropdown_caret(true).label(self.store.status_name(task)).dropdown_menu(
                move |mut menu, _, _| {
                    for (status_id, category, name) in statuses.clone() {
                        let (weak, id) = (weak.clone(), id.clone());
                        let checked = current.as_deref() == Some(status_id.as_str());
                        menu = menu.item(PopupMenuItem::new(name).checked(checked).on_click(move |_, _, cx| {
                            weak.update(cx, |this, cx| this.set_status(&id, status_id.clone(), category.clone(), cx)).ok();
                        }));
                    }
                    menu
                },
            )
        };

        let priority_menu = {
            let (weak, id, current) = (weak.clone(), id.clone(), task.priority.clone());
            Button::new("priority")
                .small()
                .outline()
                .dropdown_caret(true)
                .label(priority_label(task.priority.as_deref()))
                .dropdown_menu(move |mut menu, _, _| {
                    for value in [None, Some("low"), Some("medium"), Some("high")] {
                        let (weak, id) = (weak.clone(), id.clone());
                        menu = menu.item(
                            PopupMenuItem::new(priority_label(value)).checked(current.as_deref() == value).on_click(
                                move |_, _, cx| {
                                    weak.update(cx, |this, cx| this.set_priority(&id, value, cx)).ok();
                                },
                            ),
                        );
                    }
                    menu
                })
        };

        let buckets: Vec<(String, String)> =
            self.store.buckets.iter().filter(|b| b.archived_at.is_none()).map(|b| (b.id.clone(), b.name.clone())).collect();
        let project_menu = {
            let (weak, id, current) = (weak.clone(), id.clone(), task.bucket_id.clone());
            Button::new("project")
                .small()
                .outline()
                .dropdown_caret(true)
                .label(self.store.bucket_name(&task.bucket_id))
                .dropdown_menu(move |mut menu, _, _| {
                    for (bucket_id, name) in buckets.clone() {
                        let (weak, id) = (weak.clone(), id.clone());
                        let checked = current == bucket_id;
                        menu = menu.item(PopupMenuItem::new(name).checked(checked).on_click(move |_, _, cx| {
                            weak.update(cx, |this, cx| this.move_to(&id, bucket_id.clone(), cx)).ok();
                        }));
                    }
                    menu.scrollable(true).max_h(px(360.))
                })
        };

        let field = move |label: &'static str, control: gpui_kit::AnyElement| {
            h_flex()
                .w_full()
                .gap_3()
                .child(div().w(px(72.)).flex_none().text_sm().text_color(muted).child(label))
                .child(div().flex_1().min_w_0().child(control))
        };
        let delete_id = id.clone();
        v_flex()
            .w(px(380.))
            .h_full()
            .flex_none()
            .p_4()
            .gap_4()
            .border_l_1()
            .border_color(border)
            .child(div().text_xs().text_color(muted).child(format!("#{}", task.number)))
            .child(Input::new(&self.title))
            .child(field("Status", status_menu.into_any_element()))
            .child(field("Priority", priority_menu.into_any_element()))
            .child(field("Project", project_menu.into_any_element()))
            .child(field("Due", DatePicker::new(&self.due).placeholder("No date").cleanable(true).into_any_element()))
            .child(div().flex_1().min_h(px(120.)).child(Textarea::new(&self.notes).h_full()))
            .child(h_flex().justify_end().child(Button::new("delete").danger().small().label("Delete task").on_click(
                cx.listener(move |this, _, window, cx| this.delete(&delete_id, window, cx)),
            )))
    }
}

impl Render for TasksView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.autoselect && !self.rows.is_empty() {
            self.autoselect = false;
            self.step(1, window, cx);
        }
        let theme = cx.theme();
        let (background, foreground, warning, warning_fg) =
            (theme.background, theme.foreground, theme.warning, theme.warning_foreground);
        let detail = self.selected.as_ref().and_then(|id| self.store.tasks.get(id)).cloned();
        let notice = self.notice.clone();
        v_flex()
            .size_full()
            .bg(background)
            .text_color(foreground)
            .text_sm()
            .key_context(SCREEN)
            .on_action(cx.listener(|this, _: &NewTask, window, cx| {
                this.quick_add.update(cx, |input, cx| input.focus(window, cx));
            }))
            .on_action(cx.listener(|this, _: &Refresh, _, cx| this.load_everything(cx)))
            .children(notice.map(|text| {
                h_flex()
                    .id("notice")
                    .px_4()
                    .py_1()
                    .justify_between()
                    .bg(warning)
                    .text_color(warning_fg)
                    .child(text)
                    .child(Button::new("dismiss").ghost().xsmall().label("Dismiss").on_click(cx.listener(|this, _, _, cx| {
                        this.notice = None;
                        cx.notify();
                    })))
            }))
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .items_start()
                    .child(self.render_sidebar(cx))
                    .child(self.render_list(cx))
                    .children(detail.map(|task| self.render_detail(&task, cx))),
            )
    }
}

fn priority_label(priority: Option<&str>) -> &'static str {
    match priority {
        Some("high") => "High",
        Some("medium") => "Medium",
        Some("low") => "Low",
        _ => "No priority",
    }
}

/// Two tiny conditional-style helpers, to keep the row builders flat.
trait RowStyle: Sized {
    fn when_active(self, on: bool, color: gpui_kit::Hsla) -> Self;
    fn when_closed(self, on: bool, color: gpui_kit::Hsla) -> Self;
}

impl<T: gpui_kit::Styled> RowStyle for T {
    fn when_active(self, on: bool, color: gpui_kit::Hsla) -> Self {
        if on {
            self.bg(color)
        } else {
            self
        }
    }
    fn when_closed(self, on: bool, color: gpui_kit::Hsla) -> Self {
        if on {
            self.text_color(color).line_through()
        } else {
            self
        }
    }
}
