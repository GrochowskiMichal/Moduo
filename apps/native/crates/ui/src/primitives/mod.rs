//! Moduo's primitives, one per role, each the native twin of a React primitive in
//! `apps/app/src/components/ui`. Features draw with these, never with the component library.

mod badge;
mod collection_header;
mod detail_title;
mod empty_state;
mod eyebrow;
mod kbd;
mod label;
mod meta_count;
mod progress;
mod separator;
mod skeleton;

pub use badge::{Badge, BadgeVariant};
pub use collection_header::CollectionHeader;
pub use detail_title::{DetailTitle, DetailTitleSize};
pub use empty_state::{EmptySize, EmptyState};
pub use eyebrow::{Eyebrow, EyebrowTone};
pub use kbd::Kbd;
pub use label::Label;
pub use meta_count::MetaCount;
pub use progress::{Progress, ProgressSize};
pub use separator::Separator;
pub use skeleton::Skeleton;
