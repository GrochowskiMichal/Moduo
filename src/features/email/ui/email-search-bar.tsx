// Search input + per-account server-escalation footer (EM-9, DESIGN_BRIEF §6).
// The input is controlled by the page (query state, `/` focus); the footer offers
// an explicit "Search all mail on <account>" per account with honest status
// (searching / N results / timed out / unsupported / failed) — local results
// always stay visible above it. Presentational; the hook owns the search.

import { Loader2, Search, ServerCog, X } from "lucide-react";
import { forwardRef } from "react";

import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { providerLabel } from "../accounts";
import type { ServerSearchState } from "../hooks/use-email-search";
import type { SavedAccount } from "../model/email-types";

export const EmailSearchInput = forwardRef<
  HTMLInputElement,
  { query: string; onQuery: (q: string) => void; onClear: () => void }
>(function EmailSearchInput({ query, onQuery, onClear }, ref) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-icon-xs -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        ref={ref}
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search mail…"
        aria-label="Search mail"
        className="h-8 pl-8 pr-8 text-sm [&::-webkit-search-cancel-button]:hidden"
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.preventDefault();
            e.stopPropagation();
            onClear();
          }
        }}
      />
      {query ? (
        <IconButton
          icon={X}
          label="Clear search"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={onClear}
        />
      ) : null}
    </div>
  );
});

function escalationLine(state: ServerSearchState | undefined, email: string): string {
  switch (state?.status) {
    case "searching":
      return `Searching all mail on ${email}…`;
    case "ok":
      return state.count > 0 ? `${state.count} more from ${email}` : `No more matches on ${email}`;
    case "timeout":
      return `${email} timed out — try again`;
    case "unsupported":
      return `${email} doesn't support full-mailbox search`;
    case "error":
      return `Couldn't search ${email}`;
    default:
      return `Search all mail on ${email}`;
  }
}

/** The per-account escalation footer under the local results. */
export function EmailSearchFooter({
  accounts,
  serverStates,
  onEscalate,
}: {
  accounts: SavedAccount[];
  serverStates: Record<string, ServerSearchState>;
  onEscalate: (accountId: string) => void;
}) {
  if (accounts.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 border-t border-border p-1">
      {accounts.map((account) => {
        const state = serverStates[account.id];
        const searching = state?.status === "searching";
        const done = state?.status === "ok";
        return (
          <button
            key={account.id}
            type="button"
            disabled={searching || done}
            onClick={() => onEscalate(account.id)}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            title={providerLabel(account.provider)}
          >
            {searching ? (
              <Loader2 className="size-icon-xs shrink-0 animate-spin" aria-hidden />
            ) : (
              <ServerCog className="size-icon-xs shrink-0" aria-hidden />
            )}
            <span className="truncate">{escalationLine(state, account.email)}</span>
          </button>
        );
      })}
    </div>
  );
}
