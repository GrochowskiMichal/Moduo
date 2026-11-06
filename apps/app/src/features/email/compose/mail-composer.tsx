// The composer (specs/mail-v3.md §9, decision 17): a reply renders inline under
// its conversation, a New message fills the reader column; this component is
// the same in both, the page decides where it goes. It edits the one active
// compose of the session; every change saves the draft. ⌘Enter sends, Esc
// closes and keeps the draft. From switches alias, account and signature
// together; To, Cc and Bcc are token inputs; `;;` opens snippets; attachments
// are checked live against the provider's limit; the footer shows where the
// draft is saved. Markdown line shortcuts, pasted images and drags attach.

import { Forward, PenLine, Reply, X } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useState,
  useSyncExternalStore,
} from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { htmlToPlainText, plainToHtml } from "../compose";
import { entryLabel, splitEntries } from "./address-list";
import { type MailAlias, swapSignature } from "./aliases";
import { ComposerFooter } from "./composer-footer";
import { AttachmentTiles, IntroBanner, SizeAlert } from "./composer-parts";
import { type FromAccount, FromLine } from "./from-line";
import { instantIntro, undoInstantIntro } from "./intro";
import { blockShortcut } from "./markdown";
import { type Person, RecipientRows, type SuggestPeople } from "./recipient-field";
import { composePlacement, type ComposeSession, type ComposeState } from "./session";
import { checkSendSize, type SendLimit } from "./size-limit";
import { SnippetArea, type SnippetPopupState, useSnippetPopup } from "./snippet-area";
import { type MailSnippet, snippetRecipient } from "./snippets";

export type MailComposerProps = {
  session: ComposeSession;
  aliases?: MailAlias[];
  /** Accounts as the From line and the draft status name them. */
  accounts?: readonly FromAccount[];
  snippets?: MailSnippet[];
  contacts?: Person[];
  /** The engine's correspondents for a typed query (the field debounces it). */
  suggestPeople?: SuggestPeople;
  spellCheck?: boolean;
  /** The account's send limit and provider (`sizeLimit(accountId)`). */
  sizeLimit?: SendLimit | null;
  /** The sender of the message replied to, for instant intro. */
  introducer?: string | null;
  /** The compose's account is offline: the draft waits on this Mac. */
  offline?: boolean;
  /** "Aliases and signatures…": opens Settings → Mail. */
  onOpenSettings?: () => void;
  /** Stages a dropped/pasted file in the engine and returns its opaque id. */
  stageFile?: (file: File) => Promise<string>;
  /** Opens the native file picker (engine side) and stages the chosen files. */
  pickFiles?: () => Promise<{ id: string; filename: string; size: number }[]>;
  now?: () => number;
};

type BodyProps = MailComposerProps & { state: ComposeState };

function useActive(session: ComposeSession): ComposeState | null {
  return useSyncExternalStore(session.subscribe, () => session.active);
}

const BULLETS: Record<string, string> = { ul: "• ", ol: "1. ", quote: "> ", h2: "" };

export function MailComposer(props: MailComposerProps) {
  const active = useActive(props.session);
  if (!active) return null;
  return <ComposerBody key={active.key} {...props} state={active} />;
}

/** "Reply to Ana", "Reply all", "Forward" or "New message". */
export function composerTitle(state: Pick<ComposeState, "kind" | "to">): string {
  if (state.kind === "reply") {
    const first = splitEntries(state.to)[0];
    const name = first ? entryLabel(first).split(/[\s@]/)[0] : "";
    return name ? `Reply to ${name}` : "Reply";
  }
  if (state.kind === "reply-all") return "Reply all";
  if (state.kind === "forward") return "Forward";
  return "New message";
}

function ComposerHeader(props: { kind: ComposeState["kind"]; title: string; onClose: () => void }) {
  const Icon = props.kind === "forward" ? Forward : props.kind === "new" ? PenLine : Reply;
  return (
    <header className="flex h-(--ctrl-h) items-center gap-2 border-b border-hairline px-3 text-sm font-medium text-foreground">
      <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{props.title}</span>
      <IconButton
        label="Close, keep the draft"
        tooltip="Close · Esc"
        icon={X}
        onClick={props.onClose}
      />
    </header>
  );
}

function SubjectRow(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-h-(--ctrl-h-sm) items-center gap-2 border-b border-hairline px-3 text-sm">
      <span className="w-12 shrink-0 text-xs text-muted-foreground">Subject</span>
      <Input
        variant="bare"
        size="sm"
        aria-label="Subject"
        placeholder="Subject"
        className="flex-1"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function placeholderFor(state: ComposeState, inline: boolean): string {
  if (state.kind === "forward") return "Add a note to the forwarded message…";
  return inline ? "Write your reply…" : "Write your message…";
}

/** The message field, its snippet popup and the alias's signature under it. */
function MessageField(props: {
  state: ComposeState;
  inline: boolean;
  text: string;
  spellCheck: boolean;
  snippets: SnippetPopupState;
  signatureHtml: string;
  onChange: (value: string) => void;
  onPaste: (e: ClipboardEvent) => void;
}) {
  const { inline } = props;
  return (
    <>
      <SnippetArea popup={props.snippets}>
        <Textarea
          aria-label="Message"
          autoFocus={inline || !!props.state.to}
          variant="bare"
          className={cn("px-3 py-2", inline ? "min-h-32" : "min-h-0 flex-1")}
          placeholder={placeholderFor(props.state, inline)}
          spellCheck={props.spellCheck}
          value={props.text}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={props.snippets.onKeyDown}
          onPaste={props.onPaste}
        />
      </SnippetArea>
      {props.signatureHtml.trim() ? (
        <p className="px-3 pb-2 text-sm whitespace-pre-line text-muted-foreground">
          {htmlToPlainText(props.signatureHtml)}
        </p>
      ) : null}
    </>
  );
}

/** Attaching: dropped and pasted files are staged in the engine; picked files already are. */
function useAttach(props: BodyProps) {
  const { session, state } = props;
  const attach = async (files: File[]) => {
    if (!props.stageFile || files.length === 0) return;
    const staged = await Promise.all(
      files.map(async (f) => ({
        filename: f.name || "pasted-image.png",
        contentType: f.type || "application/octet-stream",
        id: await props.stageFile!(f),
        size: f.size,
      })),
    );
    void session.update({ attachments: [...state.attachments, ...staged] });
  };
  const pick = async () => {
    if (!props.pickFiles) return;
    const picked = await props.pickFiles();
    if (picked.length === 0) return;
    const added = picked.map((p) => ({ ...p, contentType: "application/octet-stream" }));
    void session.update({ attachments: [...state.attachments, ...added] });
  };
  const remove = (id: string) =>
    void session.update({ attachments: state.attachments.filter((a) => a.id !== id) });
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    void attach([...e.dataTransfer.files]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    e.preventDefault();
    void attach(images);
  };
  return { pick: props.pickFiles ? () => void pick() : undefined, remove, onDrop, onPaste };
}

/** The body text and everything that rewrites it: typing, Markdown lines, snippets, the intro. */
function useBody(props: BodyProps, alias: MailAlias | null) {
  const { session, state } = props;
  const [text, setText] = useState(() => htmlToPlainText(swapSignature(state.bodyHtml, null)));
  const [moved, setMoved] = useState(false);
  const setBody = (next: string) => {
    setText(next);
    void session.update({ bodyHtml: swapSignature(plainToHtml(next), alias) });
  };
  const onChange = (value: string) => {
    const line = value.slice(value.lastIndexOf("\n") + 1);
    const block = blockShortcut(line);
    setBody(block ? value.slice(0, value.length - line.length) + BULLETS[block] : value);
  };
  const snippets = useSnippetPopup({
    text,
    snippets: props.snippets ?? [],
    ctx: {
      recipient: snippetRecipient(state.to, props.contacts ?? []),
      me: { name: state.fromName ?? "", email: state.fromAddr },
    },
    onInsert: setBody,
  });
  // Move the introducer to Bcc, or undo it back to To (AC33).
  const intro = (move: boolean) => {
    if (!props.introducer) return;
    const fields = { ...state, bodyHtml: plainToHtml(text) };
    const out = (move ? instantIntro : undoInstantIntro)(fields, props.introducer);
    setText(htmlToPlainText(out.bodyHtml));
    setMoved(move);
    void session.update({
      to: out.to,
      cc: out.cc,
      bcc: out.bcc,
      bodyHtml: swapSignature(out.bodyHtml, alias),
    });
  };
  return { text, onChange, snippets, moved, intro };
}

function useSend(props: BodyProps, blocked: string | null) {
  const { session, state } = props;
  // A send that failed comes back with its reason (AC11).
  const [error, setError] = useState<string | null>(
    state.lastError ? `Not sent: ${state.lastError}` : null,
  );
  const send = async () => {
    if (blocked) return;
    const res = await session.send(props.sizeLimit);
    if (!res.ok) setError(res.reason);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // Keys from a menu's portal (From, Remind) bubble here through React: they're the menu's.
    if (e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      void session.close({ keepDraft: true });
    }
  };
  return { error, send: () => void send(), onKeyDown };
}

/** The over-limit check, live against the account's limit (AC32). */
function overLimit(props: BodyProps) {
  if (!props.sizeLimit) return null;
  const { state } = props;
  const size = checkSendSize(state.attachments, new Blob([state.bodyHtml]).size, props.sizeLimit);
  return size.ok ? null : size;
}

/** From, the recipients, the intro banner and (outside a reply) the subject. */
function ComposerFields(props: BodyProps & { inline: boolean; body: ReturnType<typeof useBody> }) {
  const { session, state, inline, body } = props;
  const showIntro = !!props.introducer && (state.kind === "reply" || state.kind === "reply-all");
  // Another account's alias sends from that account, with its signature (AC29).
  const pickAlias = (next: MailAlias) =>
    void session.update({
      accountId: next.accountId || state.accountId,
      fromAddr: next.address,
      fromName: next.name || state.fromName,
      bodyHtml: swapSignature(plainToHtml(body.text), next),
    });
  return (
    <>
      <FromLine
        aliases={props.aliases ?? []}
        accounts={props.accounts ?? []}
        fromAddr={state.fromAddr}
        onPick={pickAlias}
        onOpenSettings={props.onOpenSettings}
      />
      <RecipientRows
        to={state.to}
        cc={state.cc}
        bcc={state.bcc}
        onChange={(patch) => void session.update(patch)}
        suggest={props.suggestPeople}
        contacts={props.contacts}
        autoFocus={!inline && !state.to}
      />
      {showIntro ? (
        <IntroBanner
          introducer={props.introducer!}
          moved={body.moved}
          onMove={() => body.intro(true)}
          onUndo={() => body.intro(false)}
        />
      ) : null}
      {inline ? null : (
        <SubjectRow
          value={state.subject}
          onChange={(subject) => void session.update({ subject })}
        />
      )}
    </>
  );
}

/** Attachments, the size and send alerts, and the footer. */
function ComposerTail(
  props: BodyProps & {
    inline: boolean;
    over: ReturnType<typeof overLimit>;
    files: ReturnType<typeof useAttach>;
    sending: ReturnType<typeof useSend>;
  },
) {
  const { session, state, over, files, sending } = props;
  const account = props.accounts?.find((a) => a.id === state.accountId);
  return (
    <>
      <AttachmentTiles
        attachments={state.attachments}
        largest={over?.largest ?? null}
        onRemove={files.remove}
      />
      {over ? <SizeAlert id={`${state.key}-limit`} message={over.message} /> : null}
      {sending.error ? (
        <p role="alert" className="px-3 pt-2 text-sm text-destructive">
          {sending.error}
        </p>
      ) : null}
      <ComposerFooter
        blocked={over?.message ?? null}
        onSend={sending.send}
        threaded={props.inline && state.kind !== "new"}
        followUp={state.followUp}
        onFollowUp={(followUp) => void session.update({ followUp })}
        markDone={state.doneOnSend ?? session.defaultDoneOnSend(state)}
        onMarkDone={(doneOnSend) => void session.update({ doneOnSend })}
        saved={state.saved}
        offline={props.offline ?? false}
        accountLabel={account?.label ?? state.fromAddr}
        onAttach={files.pick}
        onDiscard={() => void session.close({ keepDraft: false })}
        now={props.now ?? Date.now}
      />
    </>
  );
}

function ComposerBody(props: BodyProps) {
  const { session, state } = props;
  const alias = (props.aliases ?? []).find((a) => a.address === state.fromAddr) ?? null;
  const files = useAttach(props);
  const body = useBody(props, alias);
  const over = overLimit(props);
  const sending = useSend(props, over?.message ?? null);
  const inline = composePlacement(state) === "inline";
  const title = composerTitle(state);
  return (
    <section
      aria-label={title}
      data-placement={inline ? "inline" : "column"}
      className={cn(
        "flex flex-col bg-card",
        inline
          ? "mx-4 mt-4 mb-6 overflow-hidden rounded-lg border border-hairline"
          : "min-h-0 flex-1",
      )}
      onKeyDown={sending.onKeyDown}
      onDrop={files.onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <ComposerHeader
        kind={state.kind}
        title={title}
        onClose={() => void session.close({ keepDraft: true })}
      />
      <ComposerFields {...props} inline={inline} body={body} />
      <MessageField
        state={state}
        inline={inline}
        text={body.text}
        spellCheck={props.spellCheck ?? true}
        snippets={body.snippets}
        signatureHtml={alias?.signatureHtml ?? ""}
        onChange={body.onChange}
        onPaste={files.onPaste}
      />
      <ComposerTail {...props} inline={inline} over={over} files={files} sending={sending} />
    </section>
  );
}
