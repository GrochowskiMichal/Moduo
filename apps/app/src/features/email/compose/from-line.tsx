// The composer's From line (specs/mail-v3.md §9, AC29): a menu only when more
// than one alias exists, each row with its account's dot and address and the
// default reading "default for {account}". Under it, "Signs ‘…’" names the
// signature's first line, and "Aliases and signatures…" opens Settings.

import { ChevronDown } from "lucide-react";

import type { LabelColor } from "@/components/tag-colors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { htmlToPlainText } from "../compose";
import type { MailAlias } from "./aliases";

/** An account as the From line names it, with its rail dot. */
export type FromAccount = { id: string; label: string; hue: LabelColor };

/** The first non-empty line of a signature, or "" without one. */
export function signatureFirstLine(signatureHtml: string): string {
  return (
    htmlToPlainText(signatureHtml)
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  );
}

function AccountDot({ hue }: { hue: LabelColor | undefined }) {
  return (
    <span data-label={hue ?? "gray"} className="tag-dot size-2 shrink-0 rounded-full" aria-hidden />
  );
}

function aliasNote(alias: MailAlias, account: FromAccount | undefined): string {
  const sig = signatureFirstLine(alias.signatureHtml);
  const parts = [sig ? `Signs ‘${sig}’` : "No signature"];
  if (alias.isDefault && account) parts.push(`default for ${account.label}`);
  return parts.join(" · ");
}

function FromMenu(props: {
  aliases: readonly MailAlias[];
  accounts: readonly FromAccount[];
  fromAddr: string;
  current: MailAlias | null;
  onPick: (alias: MailAlias) => void;
  onOpenSettings?: () => void;
}) {
  const accountOf = (a: MailAlias) => props.accounts.find((x) => x.id === a.accountId);
  const hue = props.current ? accountOf(props.current)?.hue : undefined;
  return (
    // Not modal: a modal menu aria-hides the composer while its fields stay focusable
    // (axe aria-hidden-focus); Escape and an outside click still close it.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`From ${props.fromAddr}, change address`}
          className="min-w-0 gap-1.5 px-1.5"
        >
          <AccountDot hue={hue} />
          <span className="truncate">{props.fromAddr}</span>
          <ChevronDown aria-hidden className="size-icon-sm text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-80">
        <DropdownMenuLabel>Send from</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.fromAddr}
          onValueChange={(addr) => {
            const next = props.aliases.find((a) => a.address === addr);
            if (next) props.onPick(next);
          }}
        >
          {props.aliases.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.address} className="items-start py-1.5">
              <span className="mt-1.5">
                <AccountDot hue={accountOf(a)?.hue} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{a.address}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {aliasNote(a, accountOf(a))}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {props.onOpenSettings ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onOpenSettings}>
              Aliases and signatures…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FromLine(props: {
  aliases: readonly MailAlias[];
  accounts: readonly FromAccount[];
  fromAddr: string;
  onPick: (alias: MailAlias) => void;
  onOpenSettings?: () => void;
}) {
  const current = props.aliases.find((a) => a.address === props.fromAddr) ?? null;
  const sig = current ? signatureFirstLine(current.signatureHtml) : "";
  const hue = props.accounts.find((x) => x.id === current?.accountId)?.hue;
  return (
    <div className="flex flex-col border-b border-hairline px-3 py-1 text-sm">
      <div className="flex min-h-(--ctrl-h-sm) items-center gap-2">
        <span className="w-12 shrink-0 text-xs text-muted-foreground">From</span>
        {props.aliases.length > 1 ? (
          <FromMenu {...props} current={current} />
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <AccountDot hue={hue} />
            <span className="truncate">{props.fromAddr}</span>
          </span>
        )}
      </div>
      {sig || props.onOpenSettings ? (
        <div className="flex items-center gap-2 pl-14 text-xs text-muted-foreground">
          {sig ? <span className="truncate">Signs ‘{sig}’</span> : null}
          {props.onOpenSettings ? (
            <button
              type="button"
              className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={props.onOpenSettings}
            >
              Aliases and signatures…
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
