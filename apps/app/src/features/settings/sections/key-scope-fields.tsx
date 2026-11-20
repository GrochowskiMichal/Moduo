import { normalizeMcpKeyScope } from "@contracts/vocabularies";
import { useId } from "react";

import { SegmentedControl } from "../../../components/ui/segmented-control";
import {
  KEY_EXPIRY_OPTIONS,
  KEY_SCOPE_LABELS,
  KEY_SCOPE_MODULES,
  type KeyCeilings,
  MCP_KEY_SCOPES,
  type McpKeyModule,
  type McpKeyScope,
  type McpKeyScopes,
  scopeDependencyNotes,
} from "../api-keys";

const RANK: Record<McpKeyScope, number> = { none: 0, view: 1, edit: 2 };

/**
 * The per-module access picker: one row per module, a None / View / Edit
 * segmented control each. Shared by the new-key card, a key's edit state and
 * the consent screen (/oauth/consent), and mirrored by the marketing landing's
 * key card, so the labels stay plain.
 * Levels above a row's ceiling are off, with the reason under the hint; when a
 * grant lists tools that also need another module, a note says which.
 */
export function KeyScopeFields({
  value,
  onChange,
  ceilings,
  extraNotes,
  disabled,
  ...group
}: {
  value: McpKeyScopes;
  onChange: (next: McpKeyScopes) => void;
  ceilings: KeyCeilings;
  extraNotes?: Partial<Record<McpKeyModule, string>>;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** A reason that covers every row (someone else's key), read once on entering the group. */
  "aria-describedby"?: string;
}) {
  const idPrefix = useId();
  const notes = scopeDependencyNotes(value);
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" {...group}>
      <ul className="flex flex-col">
        {KEY_SCOPE_MODULES.map(({ module, label, hint }) => {
          const note = notes[module];
          const { max, why } = ceilings[module];
          const limit = RANK[max] < RANK.edit ? why : null;
          const extra = extraNotes?.[module] ?? null;
          const hintId = `${idPrefix}-${module}-hint`;
          const limitId = `${idPrefix}-${module}-limit`;
          const noteId = `${idPrefix}-${module}-note`;
          const describedBy = [hintId, limit ? limitId : null, note || extra ? noteId : null]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={module}
              className="flex items-center justify-between gap-4 border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-foreground">{label}</span>
                <span id={hintId} className="truncate text-xs text-muted-foreground">
                  {hint}
                </span>
                {limit ? (
                  <span id={limitId} className="text-xs text-muted-foreground">
                    {limit}
                  </span>
                ) : null}
                {/* Its own line, and it wraps: the last words are the part to act on. */}
                {note || extra ? (
                  <span id={noteId} className="text-xs text-warning">
                    {[note, extra].filter(Boolean).join(" ")}
                  </span>
                ) : null}
              </div>
              <SegmentedControl
                aria-label={`${label} access`}
                aria-describedby={describedBy}
                items={MCP_KEY_SCOPES.map((level) => ({
                  value: level,
                  label: KEY_SCOPE_LABELS[level],
                  // The current level stays selectable even above the ceiling,
                  // so a narrowed role never traps a row (the server agrees).
                  disabled: RANK[level] > RANK[max] && level !== value[module],
                }))}
                value={value[module]}
                onValueChange={(next) =>
                  onChange({ ...value, [module]: normalizeMcpKeyScope(next) })
                }
                disabled={disabled}
              />
            </li>
          );
        })}
      </ul>
      {/* One quiet live region for the notes, so a new one is read out without re-reading every hint. */}
      <p className="sr-only" aria-live="polite">
        {Object.values(notes).join(" ")}
      </p>
    </fieldset>
  );
}

/** "Expires after": Never / 30 days / 90 days / 1 year, for a new key and a connection alike. */
export function KeyExpiryField({
  value,
  onChange,
  hint,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  hint: string;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Expires after</span>
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
      <SegmentedControl
        aria-label="Expires after"
        aria-describedby={hintId}
        items={KEY_EXPIRY_OPTIONS.map(({ value: option, label }) => ({ value: option, label }))}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    </div>
  );
}
