//! Moduo Tasks on GPUI: a throwaway spike. A native window that draws Tasks
//! itself (no webview) and talks to the same Supabase backend as the app.
//!
//!   cargo run --release             the backend in the repo's .env.local
//!   cargo run --release -- --cloud  the cloud project (.env.cloud.local)
//!   cargo run -- --smoke            headless wire check, see `smoke.rs`

mod api;
mod config;
mod model;
mod smoke;
mod tasks_view;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _};
use gpui_kit::{
    div, px, size, App, AppContext as _, Bounds, Context, Entity, FontWeight, IntoElement, ParentElement as _, Render,
    SharedString, Styled as _, Subscription, TitlebarOptions, Window, WindowBounds, WindowOptions,
};

use crate::api::Api;
use crate::config::Config;
use crate::model::Workspace;
use crate::tasks_view::TasksView;

enum Screen {
    Restoring,
    Email,
    Code { email: String },
    Pick(Vec<Workspace>),
    Tasks(Entity<TasksView>),
}

struct Shell {
    api: Api,
    screen: Screen,
    email: Entity<InputState>,
    code: Entity<InputState>,
    busy: bool,
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl Shell {
    fn new(api: Api, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let email = cx.new(|cx| InputState::new(window, cx).placeholder("you@company.com"));
        let code = cx.new(|cx| InputState::new(window, cx).placeholder("6-digit code"));
        let subscriptions = vec![
            cx.subscribe_in(&email, window, |this, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.send_code(window, cx);
                }
            }),
            cx.subscribe_in(&code, window, |this, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.verify_code(window, cx);
                }
            }),
        ];
        let mut shell =
            Self { api, screen: Screen::Restoring, email, code, busy: false, error: None, _subscriptions: subscriptions };
        shell.restore(window, cx);
        shell
    }

    /// Run a blocking call off the main thread, then hand its result back.
    fn run<T: Send + 'static>(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        work: impl FnOnce(Api) -> anyhow::Result<T> + Send + 'static,
        done: impl FnOnce(&mut Self, anyhow::Result<T>, &mut Window, &mut Context<Self>) + 'static,
    ) {
        self.busy = true;
        self.error = None;
        cx.notify();
        let api = self.api.clone();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx.background_executor().spawn(async move { work(api) }).await;
            this.update_in(cx, |this, window, cx| {
                this.busy = false;
                done(this, result, window, cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn restore(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.run(
            window,
            cx,
            |api| {
                api.restore()?;
                model::load_workspaces(&api)
            },
            |this, result, window, cx| match result {
                Ok(workspaces) => this.enter(workspaces, window, cx),
                Err(_) => this.screen = Screen::Email,
            },
        );
    }

    fn send_code(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let email = self.email.read(cx).value().trim().to_lowercase();
        if email.is_empty() || self.busy {
            return;
        }
        let sent_to = email.clone();
        self.run(window, cx, move |api| api.send_code(&email), move |this, result, window, cx| match result {
            Ok(()) => {
                this.screen = Screen::Code { email: sent_to };
                this.code.update(cx, |input, cx| input.focus(window, cx));
            }
            Err(err) => this.error = Some(format!("Could not send the code: {err}").into()),
        });
    }

    fn verify_code(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Screen::Code { email } = &self.screen else { return };
        let (email, code) = (email.clone(), self.code.read(cx).value().trim().to_string());
        if code.is_empty() || self.busy {
            return;
        }
        self.run(
            window,
            cx,
            move |api| {
                api.verify_code(&email, &code)?;
                model::load_workspaces(&api)
            },
            |this, result, window, cx| match result {
                Ok(workspaces) => this.enter(workspaces, window, cx),
                Err(err) => this.error = Some(format!("That code did not work: {err}").into()),
            },
        );
    }

    fn enter(&mut self, mut workspaces: Vec<Workspace>, window: &mut Window, cx: &mut Context<Self>) {
        match workspaces.len() {
            0 => {
                self.error = Some("This account has no workspace.".into());
                self.screen = Screen::Email;
            }
            1 => self.open(workspaces.remove(0), window, cx),
            _ => self.screen = Screen::Pick(workspaces),
        }
    }

    fn open(&mut self, workspace: Workspace, window: &mut Window, cx: &mut Context<Self>) {
        let shell = cx.entity().downgrade();
        let api = self.api.clone();
        let view = cx.new(|cx| {
            TasksView::new(
                api,
                workspace,
                move |_, cx| {
                    shell
                        .update(cx, |this, cx| {
                            this.screen = Screen::Email;
                            cx.notify();
                        })
                        .ok();
                },
                window,
                cx,
            )
        });
        self.screen = Screen::Tasks(view);
    }

    fn card(&self, cx: &mut Context<Self>, title: &'static str, body: impl IntoElement) -> impl IntoElement {
        let theme = cx.theme();
        let (muted, danger) = (theme.muted_foreground, theme.danger);
        v_flex().size_full().items_center().justify_center().child(
            v_flex()
                .w(px(360.))
                .gap_3()
                .child(div().text_xl().font_weight(FontWeight::SEMIBOLD).child(title))
                .child(div().text_xs().text_color(muted).child(format!("Backend: {}", self.api.config.label)))
                .child(body)
                .children(self.error.clone().map(|e| div().text_sm().text_color(danger).child(e))),
        )
    }
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (background, foreground, muted, danger, danger_fg) =
            (theme.background, theme.foreground, theme.muted_foreground, theme.danger, theme.danger_foreground);
        let cloud = !self.api.config.is_local();
        let body = match &self.screen {
            Screen::Restoring => self.card(cx, "Moduo Tasks", div().text_color(muted).child("Signing in…")).into_any_element(),
            Screen::Email => self
                .card(
                    cx,
                    "Sign in to Moduo",
                    v_flex().gap_2().child(Input::new(&self.email)).child(
                        Button::new("send")
                            .primary()
                            .label("Email me a code")
                            .loading(self.busy)
                            .on_click(cx.listener(|this, _, window, cx| this.send_code(window, cx))),
                    ),
                )
                .into_any_element(),
            Screen::Code { email } => self
                .card(
                    cx,
                    "Enter the code",
                    v_flex()
                        .gap_2()
                        .child(div().text_sm().text_color(muted).child(format!("Sent to {email}")))
                        .child(Input::new(&self.code))
                        .child(
                            h_flex()
                                .gap_2()
                                .child(
                                    Button::new("verify")
                                        .primary()
                                        .label("Sign in")
                                        .loading(self.busy)
                                        .on_click(cx.listener(|this, _, window, cx| this.verify_code(window, cx))),
                                )
                                .child(Button::new("back").ghost().label("Use another email").on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.screen = Screen::Email;
                                        this.error = None;
                                        cx.notify();
                                    },
                                ))),
                        ),
                )
                .into_any_element(),
            Screen::Pick(workspaces) => {
                let mut list = v_flex().gap_2();
                for (ix, workspace) in workspaces.iter().enumerate() {
                    let chosen = workspace.clone();
                    list = list.child(Button::new(("workspace", ix)).outline().label(workspace.name.clone()).on_click(
                        cx.listener(move |this, _, window, cx| {
                            this.open(chosen.clone(), window, cx);
                            cx.notify();
                        }),
                    ));
                }
                self.card(cx, "Choose a workspace", list).into_any_element()
            }
            Screen::Tasks(view) => view.clone().into_any_element(),
        };
        v_flex()
            .size_full()
            .bg(background)
            .text_color(foreground)
            // Production data gets a banner that cannot be missed.
            .children(cloud.then(|| {
                div()
                    .px_4()
                    .py_0p5()
                    .bg(danger)
                    .text_color(danger_fg)
                    .text_xs()
                    .child("Cloud backend: every change here is a real change to production data.")
            }))
            .child(div().flex_1().min_h_0().child(body))
    }
}

fn main() {
    let config = match Config::load() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("moduo-gpui-spike: {err}");
            std::process::exit(2);
        }
    };
    if std::env::args().any(|a| a == "--smoke") {
        std::process::exit(smoke::run(config));
    }

    gpui_kit::application().with_assets(gpui_kit::assets::Assets).run(move |cx: &mut App| {
        gpui_kit::init(cx);
        tasks_view::bind_keys(cx);
        let title = format!("Moduo Tasks (GPUI spike) · {}", config.label);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(1240.), px(800.)), cx))),
            window_min_size: Some(size(px(1024.), px(700.))),
            titlebar: Some(TitlebarOptions { title: Some(title.into()), ..Default::default() }),
            ..Default::default()
        };
        let api = Api::new(config.clone());
        gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Shell::new(api, window, cx)))
            .expect("failed to open the window");
        cx.activate(true);
    });
}
