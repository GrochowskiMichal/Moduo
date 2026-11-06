// The rebuilt composer (AC20–AC23): rendered inline under the thread for
// r/a/f, or in the reader pane for `c`. It edits the one active compose of the
// session; every change saves the draft. ⌘Enter sends, Esc closes and keeps the
// draft. `;;` opens snippets, the To field autocompletes, Finder drags and
// pasted images attach, Markdown line shortcuts apply, and the footer holds the
// follow-up reminder and the instant-intro button.

import { Paperclip, Send, UserMinus, X } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { htmlToPlainText, plainToHtml } from "../compose";
import { type MailAlias, swapSignature } from "./aliases";
import { rankRecipients } from "./autocomplete";
import { FOLLOW_UP_CHOICES, type FollowUpChoice, followUpDueMs } from "./follow-up";
import { instantIntro } from "./intro";
import { blockShortcut } from "./markdown";
import type { ComposeSession, ComposeState } from "./session";
import {
  findSnippetTrigger,
  insertSnippet,
  type MailSnippet,
  matchSnippets,
  snippetRecipient,
} from "./snippets";

export type MailComposerProps = {
  session: ComposeSession;
  aliases?: MailAlias[];
  snippets?: MailSnippet[];
  contacts?: { name: string; email: string }[];
  correspondents?: { name: string; email: string; count: number }[];
  spellCheck?: boolean;
  sizeLimit?: number;
  /** The sender of the message replied to, for instant intro. */
  introducer?: string | null;
  /** Stages a dropped/pasted file in the engine and returns its opaque id. */
  stageFile?: (file: File) => Promise<string>;
  /** Opens the native file picker (engine side) and stages the chosen files. */
  pickFiles?: () => Promise<{ id: string; filename: string; size: number }[]>;
  now?: () => number;
};

function useActive(session: ComposeSession): ComposeState | null {
  return useSyncExternalStore(session.subscribe, () => session.active);
}

const BULLETS: Record<string, string> = { ul: "• ", ol: "1. ", quote: "> ", h2: "" };

export function MailComposer(props: MailComposerProps) {
  const active = useActive(props.session);
  if (!active) return null;
  return <ComposerBody key={active.key} {...props} state={active} />;
}

/** Derived lookups for the composer: the sending alias, snippet and recipient hits. */
function composerLookups(
  props: MailComposerProps & { state: ComposeState },
  text: string,
  toQuery: string,
) {
  const { state } = props;
  const alias = (props.aliases ?? []).find((a) => a.address === state.fromAddr) ?? null;
  const trigger = findSnippetTrigger(text, text.length);
  const snippetHits = trigger ? matchSnippets(props.snippets ?? [], trigger.query).slice(0, 5) : [];
  const recipients = rankRecipients({
    query: toQuery,
    contacts: props.contacts ?? [],
    correspondents: props.correspondents ?? [],
    exclude: state.to.split(",").map((s) => s.trim()),
    limit: 5,
  });
  // `{first name}` reads the recipient's display name (spec §9), never only the address.
  const recipient = snippetRecipient(state.to, [
    ...(props.contacts ?? []),
    ...(props.correspondents ?? []),
  ]);
  return { alias, snippetHits, recipients, recipient };
}

function ComposerBody(props: MailComposerProps & { state: ComposeState }) {
  const { session, state } = props;
  const [text, setText] = useState(() => htmlToPlainText(swapSignature(state.bodyHtml, null)));
  const [toQuery, setToQuery] = useState("");
  // A send that failed comes back with its reason (AC11).
  const [error, setError] = useState<string | null>(
    state.lastError ? `Not sent: ${state.lastError}` : null,
  );
  const { alias, snippetHits, recipients, recipient } = composerLookups(props, text, toQuery);

  const setBody = (next: string) => {
    setText(next);
    void session.update({ bodyHtml: swapSignature(plainToHtml(next), alias) });
  };

  const onBodyChange = (value: string) => {
    const line = value.slice(value.lastIndexOf("\n") + 1);
    const block = blockShortcut(line);
    setBody(block ? value.slice(0, value.length - line.length) + BULLETS[block] : value);
  };

  const pickSnippet = (s: MailSnippet) => {
    const out = insertSnippet(text, text.length, s, {
      recipient,
      me: { name: state.fromName ?? "", email: state.fromAddr },
    });
    if (out) setBody(out.text);
  };

  const addRecipient = (email: string) => {
    const list = state.to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // The suggestion replaces what was typed to find it.
    if (toQuery && list.at(-1) === toQuery) list.pop();
    void session.update({ to: [...list, email].join(", ") });
    setToQuery("");
  };

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

  const send = async () => {
    const res = await session.send(props.sizeLimit);
    if (!res.ok) setError(res.reason);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      e.preventDefault();
      void session.close({ keepDraft: true });
    }
  };

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

  const onFollowUp = (choice: string) => {
    const now = props.now?.() ?? Date.now();
    void session.update({ followUp: choice ? followUpDueMs(choice as FollowUpChoice, now) : null });
  };

  const intro = () => {
    if (!props.introducer) return;
    const out = instantIntro({ ...state, bodyHtml: plainToHtml(text) }, props.introducer);
    setText(htmlToPlainText(out.bodyHtml));
    void session.update({
      to: out.to,
      cc: out.cc,
      bcc: out.bcc,
      bodyHtml: swapSignature(out.bodyHtml, alias),
    });
  };

  return (
    <section
      aria-label={state.placement === "inline" ? "Reply" : "New message"}
      data-placement={state.placement}
      className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3"
      onKeyDown={onKeyDown}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {(props.aliases?.length ?? 0) > 1 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <select
            aria-label="From"
            className="bg-transparent text-foreground"
            value={state.fromAddr}
            onChange={(e) => {
              const next = props.aliases!.find((a) => a.address === e.target.value) ?? null;
              // Another account's alias sends from that account (spec §9).
              void session.update({
                accountId: next?.accountId || state.accountId,
                fromAddr: e.target.value,
                fromName: next?.name ?? state.fromName,
                bodyHtml: swapSignature(plainToHtml(text), next),
              });
            }}
          >
            {props.aliases!.map((a) => (
              <option key={a.id} value={a.address}>
                {a.name ? `${a.name} <${a.address}>` : a.address}
              </option>
            ))}
          </select>
        </label>
      )}
      <Input
        aria-label="To"
        placeholder="To"
        value={state.to}
        onChange={(e) => {
          void session.update({ to: e.target.value });
          setToQuery(e.target.value.split(",").pop()?.trim() ?? "");
        }}
      />
      {recipients.length > 0 && (
        <ul role="listbox" aria-label="Suggestions" className="flex flex-col text-sm">
          {recipients.map((r) => (
            <li key={r.email}>
              <Button variant="ghost" size="sm" onClick={() => addRecipient(r.email)}>
                {r.name ? `${r.name} <${r.email}>` : r.email}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(state.kind === "new" || state.kind === "forward") && (
        <Input
          aria-label="Subject"
          placeholder="Subject"
          value={state.subject}
          onChange={(e) => void session.update({ subject: e.target.value })}
        />
      )}
      <Textarea
        aria-label="Message"
        autoFocus
        spellCheck={props.spellCheck ?? true}
        value={text}
        onChange={(e) => onBodyChange(e.target.value)}
        onPaste={onPaste}
      />
      {snippetHits.length > 0 && (
        <ul role="listbox" aria-label="Snippets" className="flex flex-col text-sm">
          {snippetHits.map((s) => (
            <li key={s.id}>
              <Button variant="ghost" size="sm" onClick={() => pickSnippet(s)}>
                {s.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state.attachments.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {state.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1">
              <Paperclip className="size-icon-sm" />
              {a.filename}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <footer className="flex items-center gap-2">
        <Button onClick={() => void send()}>
          <Send />
          Send
        </Button>
        <label className="flex items-center gap-1 text-sm text-muted-foreground">
          Remind me if no reply in
          <select
            aria-label="Follow-up"
            className="bg-transparent text-foreground"
            onChange={(e) => onFollowUp(e.target.value)}
          >
            <option value="">Never</option>
            {FOLLOW_UP_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <span className="flex-1" />
        {props.introducer && state.kind !== "new" && (
          <IconButton label="Move introducer to Bcc" icon={UserMinus} onClick={intro} />
        )}
        {props.pickFiles && (
          <IconButton label="Attach files" icon={Paperclip} onClick={() => void pick()} />
        )}
        <IconButton
          label="Discard draft"
          icon={X}
          onClick={() => void session.close({ keepDraft: false })}
        />
      </footer>
    </section>
  );
}
