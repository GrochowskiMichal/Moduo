//! Moduo's primitives, one per role, each the native twin of a React primitive in
//! `apps/app/src/components/ui`. Features draw with these, never with the component library.

mod badge;
mod button;
mod checkbox;
mod collection_header;
mod complete_toggle;
mod detail_title;
mod empty_state;
mod eyebrow;
mod kbd;
mod label;
mod meta_count;
mod number_input;
mod pressable;
mod progress;
mod radio_group;
mod separator;
mod skeleton;
mod switch;
mod text_field;

pub use badge::{Badge, BadgeVariant};
pub use button::{Button, ButtonSize, ButtonVariant};
pub use checkbox::Checkbox;
pub use collection_header::CollectionHeader;
pub use complete_toggle::CompleteToggle;
pub use detail_title::{DetailTitle, DetailTitleSize};
pub use empty_state::{EmptySize, EmptyState};
pub use eyebrow::{Eyebrow, EyebrowTone};
pub use kbd::Kbd;
pub use label::Label;
pub use meta_count::MetaCount;
pub use number_input::{NumberEvent, NumberInput};
pub use pressable::OnPress;
pub use progress::{Progress, ProgressSize};
pub use radio_group::RadioGroup;
pub use separator::Separator;
pub use skeleton::Skeleton;
pub use switch::{Switch, SwitchSize};
pub use text_field::{FieldSize, FieldVariant, TextField, TextFieldEvent};
