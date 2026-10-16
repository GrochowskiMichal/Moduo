// The open workspace's custom emoji for everything drawn inside Chat (the
// stream, the panels, the composer and its picker) without threading them
// through every row (CV-20). Outside a provider nothing custom is known, so
// every `:name:` reads as text.

import { customEmojiNameOf } from "@contracts/vocabularies";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { GlyphOf } from "@/components/ui/reactions";

import { CustomEmojiGlyph } from "./custom-emoji";
import { useWorkspaceEmoji, type WorkspaceEmoji } from "./store";

export type ChatCustomEmoji = WorkspaceEmoji & {
  /** You may add one here (the "Add custom emoji" switch; the server decides). */
  canAdd: boolean;
};

const NONE: ChatCustomEmoji = {
  list: [],
  byName: new Map(),
  loaded: false,
  urlOf: () => null,
  canAdd: false,
};

const CustomEmojiContext = createContext<ChatCustomEmoji>(NONE);

export function CustomEmojiProvider({
  workspaceId,
  canAdd = false,
  children,
}: {
  workspaceId: string | null;
  canAdd?: boolean;
  children: ReactNode;
}) {
  const emoji = useWorkspaceEmoji(workspaceId);
  const value = useMemo(() => ({ ...emoji, canAdd }), [emoji, canAdd]);
  return <CustomEmojiContext.Provider value={value}>{children}</CustomEmojiContext.Provider>;
}

export function useCustomEmoji(): ChatCustomEmoji {
  return useContext(CustomEmojiContext);
}

/**
 * How the reaction component draws a key with these emoji: a live `:name:` is
 * its image; a removed one, or one this workspace doesn't have, its text; a
 * standard emoji itself (null).
 */
export function customGlyph(view: Pick<WorkspaceEmoji, "byName" | "urlOf">): GlyphOf {
  return (key) => {
    const name = customEmojiNameOf(key);
    if (!name) return null;
    return (
      <CustomEmojiGlyph
        name={name}
        emoji={view.byName.get(name)}
        urlOf={view.urlOf}
        size="reaction"
      />
    );
  };
}

/** A reaction key inside Chat (the hover toolbar, the menu's row). */
export function ReactionKeyGlyph({ reactionKey }: { reactionKey: string }) {
  const view = useCustomEmoji();
  return <>{customGlyph(view)(reactionKey) ?? reactionKey}</>;
}

/** `:name:` in a message: the image when it's live here, else the text. */
export function InlineCustomEmoji({ name, className }: { name: string; className?: string }) {
  const { byName, urlOf } = useCustomEmoji();
  return (
    <CustomEmojiGlyph name={name} emoji={byName.get(name)} urlOf={urlOf} className={className} />
  );
}
