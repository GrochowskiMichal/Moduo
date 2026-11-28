//! The static primitives (NF-8), every variant, in the current appearance.

use moduo_tokens::Token;
use moduo_ui::gpui::{div, prelude::*, AnyElement, App, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{
    Badge, BadgeVariant, CollectionHeader, DetailTitle, DetailTitleSize, EmptySize, EmptyState,
    Eyebrow, EyebrowTone, Kbd, Label, MetaCount, Progress, ProgressSize, Separator, Skeleton,
};
use moduo_ui::space::sp;
use moduo_ui::theme;

use crate::Page;

pub struct StaticPage;

fn row(cx: &App) -> moduo_ui::gpui::Div {
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(theme::px(cx, Token::PanelGap))
}

fn block(title: &'static str, body: impl IntoElement, cx: &App) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(theme::px(cx, Token::PanelGap))
        .pb(theme::px(cx, Token::PanelInset))
        .child(Eyebrow::new(title))
        .child(body)
}

impl Page for StaticPage {
    fn name(&self) -> &'static str {
        "Static"
    }

    fn render(&self, _: &mut Window, cx: &mut App) -> AnyElement {
        let mut badges = row(cx);
        for v in BadgeVariant::ALL {
            badges = badges.child(Badge::new(format!("{v:?}")).variant(v));
        }
        let mut eyebrows = row(cx);
        for tone in EyebrowTone::ALL {
            eyebrows = eyebrows.child(Eyebrow::new(format!("{tone:?}")).tone(tone));
        }
        let narrow = theme::px(cx, Token::WidthRail);
        div()
            .flex()
            .flex_col()
            .child(block("Badge", badges, cx))
            .child(block("Eyebrow", eyebrows, cx))
            .child(block(
                "Kbd · Label",
                row(cx)
                    .child(Kbd::new("⌘K"))
                    .child(Kbd::new("⇧⌘P"))
                    .child(Label::new("Project")),
                cx,
            ))
            .child(block(
                "DetailTitle",
                div()
                    .flex()
                    .flex_col()
                    .gap(sp(2.))
                    .child(DetailTitle::new("Rail — a project name").size(DetailTitleSize::Rail))
                    .child(DetailTitle::new("Lead — a task title").size(DetailTitleSize::Lead))
                    .child(
                        DetailTitle::new("Page — a full-page title").size(DetailTitleSize::Page),
                    ),
                cx,
            ))
            .child(block(
                "CollectionHeader · MetaCount",
                div()
                    .flex()
                    .flex_col()
                    .w(narrow)
                    .child(CollectionHeader::new("Subtasks").count("1/3"))
                    .child(
                        row(cx)
                            .child(MetaCount::new(IconName::MessageSquare, 3, "comments"))
                            .child(MetaCount::new(IconName::Paperclip, 2, "files")),
                    ),
                cx,
            ))
            .child(block(
                "Separator · Progress · Skeleton",
                div()
                    .flex()
                    .flex_col()
                    .gap(sp(3.))
                    .w(narrow)
                    .child(Separator::horizontal())
                    .child(Progress::new(1.0, 3.0, "Subtasks done").size(ProgressSize::Sm))
                    .child(Progress::new(2.0, 3.0, "Subtasks done").size(ProgressSize::Md))
                    .child(Skeleton::new().id("skeleton-a"))
                    .child(Skeleton::new().id("skeleton-b")),
                cx,
            ))
            .child(block(
                "EmptyState",
                div()
                    .flex()
                    .gap(theme::px(cx, Token::PanelGap))
                    .child(
                        div()
                            .w(narrow)
                            .border_1()
                            .border_color(theme::color(cx, Token::Hairline))
                            .child(
                                EmptyState::new("Nothing in Inbox")
                                    .icon(IconName::Inbox)
                                    .description("New tasks land here.")
                                    .hint("Press C to add one")
                                    .size(EmptySize::Inline),
                            ),
                    )
                    .child(
                        div()
                            .w(narrow)
                            .border_1()
                            .border_color(theme::color(cx, Token::Hairline))
                            .child(EmptyState::new("No comments yet").size(EmptySize::Inline)),
                    ),
                cx,
            ))
            .into_any_element()
    }
}
