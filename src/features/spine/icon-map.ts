// Connective-tissue spine — entity-type → type glyph (block CT-2).
//
// The single place that resolves a polymorphic entity type (or the registry's
// stored `icon` hint) to a lucide icon, so hub rows, ref chips, and search
// results show a consistent type glyph. Mirrors the icon-map pattern in
// src/features/mindmap/ui/node-icons.tsx.

import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Calendar,
  CircleCheck,
  CreditCard,
  FileText,
  FolderKanban,
  Link2,
  Mail,
  MessageSquare,
  Paperclip,
  Receipt,
  User,
} from "lucide-react";

/** Type-glyph by well-known entity type. Open by design — unknown → fallback. */
const ENTITY_TYPE_ICONS: Record<string, LucideIcon> = {
  task: CircleCheck,
  project: FolderKanban,
  note: FileText,
  email: Mail,
  comment: MessageSquare,
  contact: User,
  company: Building2,
  payment: CreditCard,
  invoice: Receipt,
  event: Calendar,
  file: Paperclip,
};

/** The fallback glyph for an unknown/unmapped entity type. */
export const FALLBACK_ENTITY_ICON: LucideIcon = Link2;

/**
 * Resolve an entity to its type glyph. Prefers the registry's stored `icon`
 * hint when it names a known type; otherwise falls back to the entity type,
 * then to a neutral link glyph.
 */
export function resolveEntityIcon(entityType: string, iconHint?: string | null): LucideIcon {
  if (iconHint && ENTITY_TYPE_ICONS[iconHint]) return ENTITY_TYPE_ICONS[iconHint];
  return ENTITY_TYPE_ICONS[entityType] ?? FALLBACK_ENTITY_ICON;
}
