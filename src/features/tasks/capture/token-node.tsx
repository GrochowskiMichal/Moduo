// A recognised token in the capture title (TV-U14): the kit Chip at the inline
// rung with the active fill, so the title shows what the `@ # /` menus
// understood and its pill fills at the same moment (research §2). A person is
// round, a team square (95); a linked thing is a live Reference chip.

import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { Bell, CalendarClock, CalendarDays, Flag, Repeat, Timer } from "lucide-react";
import type { ReactNode } from "react";

import { PersonAvatar, TeamMark } from "../../../components/ui/avatar";
import { Chip } from "../../../components/ui/chip";
import { Reference } from "../../spine/references/ui/reference";
import { type CaptureToken, tokenText } from "../parse/capture-tokens";

/** What a token reads as before its name is looked up again (a restored draft). */
const FALLBACK: Partial<Record<CaptureToken["kind"], string>> = {
  person: "Someone",
  team: "Team",
  tag: "Tag",
};

export type SerializedCaptureTokenNode = Spread<{ token: CaptureToken }, SerializedLexicalNode>;

function TokenChip({ token }: { token: CaptureToken }) {
  if (token.kind === "thing") {
    return <Reference type={token.ref.type} id={token.ref.id} display="chip" />;
  }
  const icon: ReactNode | undefined =
    token.kind === "person" ? (
      <PersonAvatar name={token.label} id={token.userId} />
    ) : token.kind === "team" ? (
      <TeamMark name={token.label} id={token.teamId} letters={token.letters ?? null} />
    ) : token.kind === "tag" ? (
      <span
        data-label={token.color ?? "gray"}
        className="tag-dot size-2 shrink-0 rounded-full"
        aria-hidden
      />
    ) : undefined;
  const Icon =
    token.kind === "due"
      ? CalendarDays
      : token.kind === "schedule"
        ? CalendarClock
        : token.kind === "repeat"
          ? Repeat
          : token.kind === "priority"
            ? Flag
            : token.kind === "estimate"
              ? Timer
              : token.kind === "remind"
                ? Bell
                : undefined;
  return (
    <Chip
      size="xs"
      active
      icon={icon ?? Icon}
      data-capture-token={token.kind}
      className="mx-0.5 align-baseline"
    >
      {token.label || FALLBACK[token.kind] || ""}
    </Chip>
  );
}

export class CaptureTokenNode extends DecoratorNode<ReactNode> {
  __token: CaptureToken;

  static getType(): string {
    return "capture-token";
  }

  static clone(node: CaptureTokenNode): CaptureTokenNode {
    return new CaptureTokenNode(node.__token, node.__key);
  }

  static importJSON(json: SerializedCaptureTokenNode): CaptureTokenNode {
    return $createCaptureTokenNode(json.token);
  }

  constructor(token: CaptureToken, key?: NodeKey) {
    super(key);
    this.__token = token;
  }

  exportJSON(): SerializedCaptureTokenNode {
    return { ...super.exportJSON(), type: "capture-token", version: 1, token: this.__token };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.contentEditable = "false";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  getToken(): CaptureToken {
    return this.getLatest().__token;
  }

  /** The words it stands for: "@Sam Ortiz", "#design", "Tomorrow". */
  getTextContent(): string {
    return tokenText(this.__token);
  }

  decorate(): ReactNode {
    return <TokenChip token={this.__token} />;
  }
}

export function $createCaptureTokenNode(token: CaptureToken): CaptureTokenNode {
  return $applyNodeReplacement(new CaptureTokenNode(token));
}

export function $isCaptureTokenNode(
  node: LexicalNode | null | undefined,
): node is CaptureTokenNode {
  return node instanceof CaptureTokenNode;
}
