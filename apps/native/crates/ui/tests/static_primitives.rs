use moduo_tokens::{Appearance, Token};
use moduo_ui::gpui::{self, div, prelude::*, AnyElement, Context, FocusHandle, Modifiers, TestAppContext, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{
    Badge, BadgeVariant, CollectionHeader, DetailTitle, DetailTitleSize, EmptyState, EmptySize, Eyebrow, EyebrowTone, Kbd,
    Label, MetaCount, Progress, ProgressSize, Separator, Skeleton,
};
use moduo_ui::theme;

/// Every variant and size, each in a box the test can find.
struct All;

fn item(name: &'static str, element: impl IntoElement) -> AnyElement {
    div().debug_selector(move || name.into()).child(element).into_any_element()
}

impl Render for All {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let mut items = vec![
            item("kbd", Kbd::new("⌘K")),
            item("separator-h", div().w_full().child(Separator::horizontal())),
            item("separator-v", div().h_full().flex().child(Separator::vertical())),
            item("label", Label::new("Name")),
            item("detail-rail", DetailTitle::new("Rail title").size(DetailTitleSize::Rail)),
            item("detail-lead", DetailTitle::new("Lead title").size(DetailTitleSize::Lead)),
            item("detail-page", DetailTitle::new("Page title").size(DetailTitleSize::Page)),
            item("empty-page", EmptyState::new("Nothing here").icon(IconName::Inbox).description("Add a task").hint("Press C").size(EmptySize::Page)),
            item("empty-inline", EmptyState::new("Nothing here").size(EmptySize::Inline)),
            item("collection", CollectionHeader::new("Subtasks").count("1/3")),
            item("meta", MetaCount::new(IconName::MessageSquare, 3, "comments")),
            item("progress-sm", div().w_full().child(Progress::new(1.0, 3.0, "Done").size(ProgressSize::Sm))),
            item("progress-md", div().w_full().child(Progress::new(2.0, 3.0, "Done").size(ProgressSize::Md))),
            item("skeleton", div().w_full().child(Skeleton::new())),
        ];
        for (i, variant) in BadgeVariant::ALL.iter().enumerate() {
            items.push(item(["badge-0", "badge-1", "badge-2", "badge-3", "badge-4", "badge-5", "badge-6"][i], Badge::new("Badge").variant(*variant)));
        }
        for (i, tone) in EyebrowTone::ALL.iter().enumerate() {
            items.push(item(["eyebrow-0", "eyebrow-1", "eyebrow-2", "eyebrow-3", "eyebrow-4"][i], Eyebrow::new("Section").tone(*tone)));
        }
        div().size_full().flex().flex_col().children(items)
    }
}

#[gpui::test]
fn renders_every_variant_and_size(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    for density in ["comfortable", "compact", "dense"] {
        cx.update(|cx| theme::set_appearance(cx, Appearance::default().with("density", density)));
        let (_view, cx) = cx.add_window_view(|_, _| All);
        cx.run_until_parked();
        let mut names = vec![
            "kbd", "separator-h", "separator-v", "label", "detail-rail", "detail-lead", "detail-page", "empty-page", "empty-inline",
            "collection", "meta", "progress-sm", "progress-md", "skeleton",
        ];
        names.extend(["badge-0", "badge-1", "badge-2", "badge-3", "badge-4", "badge-5", "badge-6"]);
        names.extend(["eyebrow-0", "eyebrow-1", "eyebrow-2", "eyebrow-3", "eyebrow-4"]);
        for name in names {
            let bounds = cx.debug_bounds(name).unwrap_or_else(|| panic!("{name} drew nothing at {density}"));
            assert!(f32::from(bounds.size.height) > 0.0, "{name} has no height at {density}");
        }
        // A collection header is one small control tall (h-(--ctrl-h-sm)).
        let header = cx.debug_bounds("collection").unwrap().size.height;
        assert_eq!(header, cx.update(|_, cx| theme::px(cx, Token::CtrlHSm)));
    }
}

#[gpui::test]
fn a_meta_count_of_zero_draws_nothing(cx: &mut TestAppContext) {
    struct Zero;
    impl Render for Zero {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().child(div().debug_selector(|| "zero".into()).flex().child(MetaCount::new(IconName::Paperclip, 0, "files")))
        }
    }
    cx.update(moduo_ui::init);
    let (_view, cx) = cx.add_window_view(|_, _| Zero);
    cx.run_until_parked();
    assert_eq!(f32::from(cx.debug_bounds("zero").unwrap().size.width), 0.0);
}

struct LabelledField {
    handle: FocusHandle,
}

impl Render for LabelledField {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .child(div().debug_selector(|| "label".into()).child(Label::new("Name").for_control(&self.handle)))
            .child(div().id("control").track_focus(&self.handle).h_8().w_full())
    }
}

#[gpui::test]
fn a_label_press_focuses_its_control(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let (view, cx) = cx.add_window_view(|_, cx| LabelledField { handle: cx.focus_handle() });
    cx.run_until_parked();
    let label = cx.debug_bounds("label").expect("label drawn");
    cx.simulate_click(label.center(), Modifiers::none());
    cx.run_until_parked();
    assert!(cx.update(|window, cx| view.read(cx).handle.is_focused(window)));
}

#[gpui::test]
fn the_skeleton_stops_pulsing_under_reduced_motion(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    cx.update(|cx| {
        assert!(Skeleton::pulses(cx));
        theme::set_appearance(cx, Appearance::default().with("motion", "reduced"));
        assert!(!Skeleton::pulses(cx));
        theme::set_appearance(cx, Appearance::default().prefers_reduced_motion(true));
        assert!(!Skeleton::pulses(cx));
    });
}

#[test]
fn progress_clamps_its_value() {
    assert_eq!(Progress::fraction(5.0, 3.0), 1.0);
    assert_eq!(Progress::fraction(-1.0, 3.0), 0.0);
    assert_eq!(Progress::fraction(1.0, 0.0), 0.0);
    assert_eq!(Progress::fraction(1.0, 4.0), 0.25);
}
