// Settings → Mail → the lists that follow you (MR-15): rules, custom tabs,
// Priority people, blocked senders, snippets and aliases with signatures.
// Each row is one `email_settings_items` row (per-row last writer wins).

import { MAIL_RULE_ACTIONS, MAIL_RULE_CONDITIONS } from "@contracts/mail";
import type { EmailSettingsKind } from "@contracts/vocabularies";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";

import { PrefGroup, PrefRow } from "../sections/preferences-section";
import { ChoiceSelect } from "./controls";
import {
  ACTION_LABEL,
  CONDITION_LABEL,
  describeRule,
  itemsOfKind,
  moveItem,
  normalizeAddress,
  RULE_ACTIONS_WITH_ARG,
} from "./model";
import {
  applyPrompt,
  forgetRuleApply,
  ruleApplyLine,
  type RuleApplyPort,
  startRuleApply,
  undoRuleApply,
  useRuleApply,
} from "./rule-apply";

export type ItemActions = {
  /** Returns the new row's id when it knows it (the rule apply prompt needs it). */
  add: (kind: EmailSettingsKind, value: Record<string, unknown>) => string | void;
  update: (item: EmailSettingsItem, value: Record<string, unknown>, position?: number) => void;
  remove: (id: string) => void;
};

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <IconButton icon={X} label={label} onClick={onClick} />;
}

/** Priority people and blocked senders: a list of addresses with an add field. */
function AddressList({
  kind,
  label,
  description,
  items,
  actions,
}: {
  kind: "priority_person" | "blocked_sender";
  label: string;
  description: string;
  items: EmailSettingsItem[];
  actions: ItemActions;
}) {
  const [draft, setDraft] = useState("");
  const list = itemsOfKind(items, kind);
  const submit = () => {
    const address = normalizeAddress(draft);
    if (!address) return;
    if (!list.some((i) => i.value.address === address)) actions.add(kind, { address });
    setDraft("");
  };
  return (
    <PrefGroup label={label} description={description}>
      {list.map((i) => (
        <PrefRow key={i.id} title={String(i.value.address ?? "")}>
          <RemoveButton
            label={`Remove ${String(i.value.address)}`}
            onClick={() => actions.remove(i.id)}
          />
        </PrefRow>
      ))}
      <form
        className="flex items-center gap-2 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          aria-label={`Add to ${label}`}
          placeholder="name@example.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!normalizeAddress(draft)}>
          Add
        </Button>
      </form>
    </PrefGroup>
  );
}

const CONDITIONS = MAIL_RULE_CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABEL[c] ?? c }));
const ACTIONS = MAIL_RULE_ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] ?? a }));

/** A rule's row: its sentence, the apply-to-existing line, and its controls. */
function RuleRow({
  rule,
  at,
  last,
  ruleApply,
  onMove,
  onRemove,
}: {
  rule: EmailSettingsItem;
  at: number;
  last: boolean;
  ruleApply?: RuleApplyPort | null;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const applied = useRuleApply(rule.id);
  return (
    <div
      data-rule-row={rule.id}
      className="flex items-center justify-between gap-4 border-b border-border py-4 first:pt-2 last:border-b-0 last:pb-2"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{describeRule(rule.value)}</span>
        {applied ? (
          <output className="flex items-center gap-1 text-xs text-muted-foreground">
            {ruleApplyLine(applied)}
            {applied.status === "applied" && ruleApply ? (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => void undoRuleApply(ruleApply, rule.id)}
                >
                  Undo
                </button>
              </>
            ) : null}
          </output>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          icon={ArrowUp}
          label="Move rule up"
          disabled={at === 0}
          onClick={() => onMove(-1)}
        />
        <IconButton
          icon={ArrowDown}
          label="Move rule down"
          disabled={last}
          onClick={() => onMove(1)}
        />
        <RemoveButton label="Delete rule" onClick={onRemove} />
      </div>
    </div>
  );
}

/** "Also apply to the {n} already on this Mac?", asked in place after a save. */
function ApplyPrompt({
  ask,
  onApply,
  onSkip,
}: {
  ask: { ruleId: string; count: number };
  onApply: () => void;
  onSkip: () => void;
}) {
  return (
    <fieldset
      aria-label="Apply to existing mail"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2"
    >
      <span className="text-sm text-foreground">{applyPrompt(ask.count)}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Only new mail
        </Button>
        <Button size="sm" onClick={onApply}>
          Apply
        </Button>
      </div>
    </fieldset>
  );
}

/** After a save: the dry run's count, then the in-place question (none when nothing matches). */
function useApplyAsk(ruleApply: RuleApplyPort | null | undefined) {
  const [ask, setAsk] = useState<{ ruleId: string; count: number } | null>(null);
  const offer = (ruleId: string | void) => {
    if (!ruleApply || !ruleId) return;
    void ruleApply.count(ruleId).then(
      (count) => (count > 0 ? setAsk({ ruleId, count }) : undefined),
      () => {},
    );
  };
  const apply = () => {
    if (!ask || !ruleApply) return;
    setAsk(null);
    // Not awaited: the apply carries on if Settings closes (rule-apply.ts).
    void startRuleApply(ruleApply, ask.ruleId, ask.count);
  };
  return { ask, offer, apply, skip: () => setAsk(null) };
}

function RulesGroup({
  items,
  actions,
  ruleApply,
}: {
  items: EmailSettingsItem[];
  actions: ItemActions;
  ruleApply?: RuleApplyPort | null;
}) {
  const list = itemsOfKind(items, "rule");
  const [field, setField] = useState<string>("from");
  const [value, setValue] = useState("");
  const [action, setAction] = useState<string>("skip_inbox");
  const [arg, setArg] = useState("");
  const asking = useApplyAsk(ruleApply);
  const needsValue = field !== "is_newsletter";
  const needsArg = RULE_ACTIONS_WITH_ARG.has(action);
  const ready = (!needsValue || value.trim()) && (!needsArg || arg.trim());
  const move = (id: string, by: -1 | 1) => {
    for (const m of moveItem(list, id, by)) actions.update(m.item, m.item.value, m.position);
  };
  return (
    <PrefGroup
      label="Rules"
      description="The first matching rule decides where mail goes; marking read, labels and Priority all apply."
    >
      {list.map((r, at) => (
        <RuleRow
          key={r.id}
          rule={r}
          at={at}
          last={at === list.length - 1}
          ruleApply={ruleApply}
          onMove={(by) => move(r.id, by)}
          onRemove={() => {
            forgetRuleApply(r.id);
            actions.remove(r.id);
          }}
        />
      ))}
      {asking.ask ? (
        <div className="pt-4">
          <ApplyPrompt ask={asking.ask} onApply={asking.apply} onSkip={asking.skip} />
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-center gap-2 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const id = actions.add("rule", {
            conditions: [needsValue ? { field, value: value.trim() } : { field }],
            actions: [needsArg ? { action, arg: arg.trim() } : { action }],
          });
          asking.offer(id);
          setValue("");
          setArg("");
        }}
      >
        <ChoiceSelect
          label="Rule condition"
          className="w-40"
          value={field}
          choices={CONDITIONS}
          onChange={setField}
        />
        {needsValue ? (
          <Input
            aria-label="Condition value"
            className="w-40"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : null}
        <ChoiceSelect
          label="Rule action"
          className="w-36"
          value={action}
          choices={ACTIONS}
          onChange={setAction}
        />
        {needsArg ? (
          <Input
            aria-label="Action target"
            className="w-32"
            value={arg}
            onChange={(e) => setArg(e.target.value)}
          />
        ) : null}
        <Button type="submit" size="sm" variant="outline" disabled={!ready}>
          Add rule
        </Button>
      </form>
    </PrefGroup>
  );
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** The custom tabs the strip can hold. */
export const MAX_CUSTOM_TABS = 3;

function TabsGroup({ items, actions }: { items: EmailSettingsItem[]; actions: ItemActions }) {
  const list = itemsOfKind(items, "custom_tab");
  const [name, setName] = useState("");
  const [match, setMatch] = useState("");
  // The strip shows at most three custom tabs (specs/mail-v3.md §12, AC2).
  const full = list.length >= MAX_CUSTOM_TABS;
  return (
    <PrefGroup
      label="Custom tabs"
      description="Mail from these senders or domains gets its own tab."
    >
      {list.map((t) => {
        const senders = Array.isArray(t.value.senders) ? t.value.senders : [];
        const domains = Array.isArray(t.value.domains) ? t.value.domains : [];
        return (
          <PrefRow
            key={t.id}
            title={String(t.value.name ?? "")}
            description={[...senders, ...domains].join(", ")}
          >
            <RemoveButton
              label={`Delete tab ${String(t.value.name)}`}
              onClick={() => actions.remove(t.id)}
            />
          </PrefRow>
        );
      })}
      <form
        className="flex items-center gap-2 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          const entries = splitList(match);
          if (full || !name.trim() || entries.length === 0) return;
          actions.add("custom_tab", {
            name: name.trim(),
            senders: entries.filter((x) => x.includes("@")),
            domains: entries.filter((x) => !x.includes("@")),
          });
          setName("");
          setMatch("");
        }}
      >
        <Input
          aria-label="Tab name"
          placeholder="Tab name"
          className="w-36"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          aria-label="Tab senders or domains"
          placeholder="anna@x.com, example.com"
          value={match}
          onChange={(e) => setMatch(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={full || !name.trim() || !match.trim()}
        >
          Add tab
        </Button>
      </form>
      {full ? <p className="pb-4 text-xs text-muted-foreground">Up to 3 custom tabs</p> : null}
    </PrefGroup>
  );
}

function SnippetsGroup({ items, actions }: { items: EmailSettingsItem[]; actions: ItemActions }) {
  const list = itemsOfKind(items, "snippet");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  return (
    <PrefGroup
      label="Snippets"
      description="Type ;; and a name in compose. {first name}, {name} and {email} fill in."
    >
      {list.map((s) => (
        <PrefRow
          key={s.id}
          title={String(s.value.name ?? "")}
          description={String(s.value.body ?? "")}
        >
          <RemoveButton
            label={`Delete snippet ${String(s.value.name)}`}
            onClick={() => actions.remove(s.id)}
          />
        </PrefRow>
      ))}
      <form
        className="flex flex-col gap-2 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !body.trim()) return;
          actions.add("snippet", { name: name.trim(), body });
          setName("");
          setBody("");
        }}
      >
        <Input
          aria-label="Snippet name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          aria-label="Snippet text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || !body.trim()}>
            Add snippet
          </Button>
        </div>
      </form>
    </PrefGroup>
  );
}

function AliasesGroup({
  items,
  actions,
  accounts,
}: {
  items: EmailSettingsItem[];
  actions: ItemActions;
  accounts: { id: string; address: string }[];
}) {
  const list = itemsOfKind(items, "alias");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const makeDefault = (alias: EmailSettingsItem) => {
    for (const other of list) {
      if (other.value.accountId !== alias.value.accountId) continue;
      const want = other.id === alias.id;
      if (other.value.isDefault !== want)
        actions.update(other, { ...other.value, isDefault: want });
    }
  };
  return (
    <PrefGroup
      label="Aliases and signatures"
      description="Send-as addresses, one default per account, each with its signature."
    >
      {list.map((a) => (
        <div key={a.id} className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-foreground">
              {String(a.value.name ?? "")} {`<${String(a.value.address ?? "")}>`}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Default</span>
              <Switch
                aria-label={`Default alias ${String(a.value.address)}`}
                checked={a.value.isDefault === true}
                onCheckedChange={(v) =>
                  v ? makeDefault(a) : actions.update(a, { ...a.value, isDefault: false })
                }
              />
              <RemoveButton
                label={`Delete alias ${String(a.value.address)}`}
                onClick={() => actions.remove(a.id)}
              />
            </div>
          </div>
          <Textarea
            aria-label={`Signature for ${String(a.value.address)}`}
            defaultValue={String(a.value.signatureHtml ?? "")}
            onBlur={(e) => {
              if (e.target.value !== (a.value.signatureHtml ?? "")) {
                actions.update(a, { ...a.value, signatureHtml: e.target.value });
              }
            }}
          />
        </div>
      ))}
      {accounts.length > 0 ? (
        <form
          className="flex items-center gap-2 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const addr = normalizeAddress(address);
            if (!addr || !accountId) return;
            const first = !list.some((x) => x.value.accountId === accountId);
            actions.add("alias", {
              accountId,
              address: addr,
              name: name.trim(),
              isDefault: first,
              signatureHtml: "",
            });
            setAddress("");
            setName("");
          }}
        >
          <ChoiceSelect
            label="Alias account"
            className="w-44"
            value={accountId}
            choices={accounts.map((a) => ({ value: a.id, label: a.address }))}
            onChange={setAccountId}
          />
          <Input
            aria-label="Alias address"
            placeholder="me@example.com"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Input
            aria-label="Alias name"
            placeholder="Name"
            className="w-32"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!normalizeAddress(address)}>
            Add alias
          </Button>
        </form>
      ) : null}
    </PrefGroup>
  );
}

export function ItemsGroups({
  items,
  actions,
  accounts,
  ruleApply,
}: {
  items: EmailSettingsItem[];
  actions: ItemActions;
  accounts: { id: string; address: string }[];
  /** The engine's apply-to-existing; absent on the web (no prompt). */
  ruleApply?: RuleApplyPort | null;
}) {
  return (
    <>
      <AliasesGroup items={items} actions={actions} accounts={accounts} />
      <SnippetsGroup items={items} actions={actions} />
      <RulesGroup items={items} actions={actions} ruleApply={ruleApply} />
      <TabsGroup items={items} actions={actions} />
      <AddressList
        kind="priority_person"
        label="Priority people"
        description="Their mail is marked Priority and can always notify."
        items={items}
        actions={actions}
      />
      <AddressList
        kind="blocked_sender"
        label="Blocked senders"
        description="Their new mail goes where Block sends it."
        items={items}
        actions={actions}
      />
    </>
  );
}
