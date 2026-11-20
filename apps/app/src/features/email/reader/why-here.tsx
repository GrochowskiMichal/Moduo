// "Why is this in {Tab}?" (specs/mail-v3.md §8, A3, decision 18; specs/mail-improve.md
// §4, AC15): explain only, read-only. A sheet inside the reader, under the sender card,
// so the subject and card stay visible. Over `engine.explainThread`, one sentence names
// the deciding reason, the six classifier steps follow in order (the ones before the
// decider dimmed and tagged "didn't match", never struck through; the decider tagged
// "decided it"), and a ghost button opens Settings at Mail → Rules. Esc or × closes.

import type { MailClassifyStage, MailTabKind } from "@contracts/mail";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { MailExplain } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import { dispatchOpenSettings } from "../../settings/settings-events";

/** The sheet's Settings button: Settings at Mail → Rules (specs/mail-improve.md §4). */
export const openMailRules = () => dispatchOpenSettings({ section: "mail", sub: "rules" });

export type WhyNames = {
  /** Rules from Settings, by item id. */
  rules: readonly { id: string; label: string }[];
  /** Custom tabs from Settings; `domains` lets the sentence name the domain it collects. */
  customTabs: readonly { id: string; label: string; domains?: readonly string[] }[];
};

/** The classifier's order (`MAIL_CLASSIFY_ORDER`), as the popover names each step. */
export const WHY_STEPS: readonly { stage: MailClassifyStage; label: string }[] = [
  { stage: "block", label: "Blocked senders" },
  { stage: "rules", label: "Your rules" },
  { stage: "sender_override", label: "Your choice for this sender" },
  { stage: "custom_tabs", label: "Custom tabs" },
  { stage: "known_contact", label: "People in your contacts" },
  { stage: "header_heuristics", label: "Mailing-list headers" },
];

export type WhyAnswer = {
  heading: string;
  sentence: string;
  /** Index into WHY_STEPS of the deciding step; null when no reason was kept. */
  decided: number | null;
  /** The footer's Settings link. */
  link: string | null;
};

const TAB_NAMES: Record<Exclude<MailTabKind, "custom">, string> = {
  personal: "Personal",
  notifications: "Notifications",
  newsletters: "Newsletters",
};

/** A tab's name; a custom tab's comes from Settings. */
export function tabName(
  tab: MailTabKind,
  customTabId: string | null | undefined,
  customTabs: WhyNames["customTabs"],
): string {
  if (tab !== "custom") return TAB_NAMES[tab];
  return customTabs.find((t) => t.id === customTabId)?.label ?? "your custom tab";
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

function customTabSentence(why: MailExplain, names: WhyNames): string {
  const tab = names.customTabs.find((t) => t.id === why.customTabId);
  const domain = why.address.split("@")[1]?.toLowerCase() ?? "";
  const byDomain = !!domain && (tab?.domains ?? []).some((d) => d.toLowerCase() === domain);
  const label = tab?.label ?? "custom";
  return `Your ${label} tab collects mail from ${byDomain ? domain : why.address}.`;
}

function headerSentence(tab: MailTabKind, name: string): string {
  if (tab === "newsletters")
    return `${name} sends with an unsubscribe header, so it reads as a newsletter.`;
  if (tab === "notifications")
    return `${name} sends automated mail, so it reads as a notification.`;
  return `${name} wrote to you personally; nothing marks it as automated.`;
}

function sentenceFor(why: MailExplain, names: WhyNames, name: string, tab: string): string {
  switch (why.stage) {
    case "block":
      return `${name} is in your blocked senders.`;
    case "rules": {
      const rule = names.rules.find((r) => r.id === why.ruleId);
      return rule ? `Your rule '${rule.label}' moved it.` : "One of your rules moved it.";
    }
    case "sender_override":
      return `You chose ${tab} for ${name}.`;
    case "custom_tabs":
      return customTabSentence(why, names);
    case "known_contact":
      return `${firstName(name)} is in your contacts.`;
    case "header_heuristics":
      return headerSentence(why.tab, name);
    default:
      return `Moduo sorted this before it kept a reason. It's in ${tab}.`;
  }
}

function linkFor(stage: MailClassifyStage | null, name: string): string | null {
  if (stage === "block") return "Blocked senders in Settings";
  if (stage === "rules") return "Edit rules in Settings";
  if (stage === "custom_tabs") return "Edit custom tabs in Settings";
  if (stage === null) return null;
  const who = stage === "known_contact" ? firstName(name) : name;
  return `Change where ${who} goes in Settings → Mail → Rules`;
}

/** The popover's words for one answer from `explainThread`. */
export function explainWhy(why: MailExplain, names: WhyNames, senderName: string): WhyAnswer {
  const tab = tabName(why.tab, why.customTabId, names.customTabs);
  const name = senderName.trim() || why.address;
  const decided = why.stage ? WHY_STEPS.findIndex((s) => s.stage === why.stage) : -1;
  return {
    heading: `Why this is in ${tab}`,
    sentence: sentenceFor(why, names, name, tab),
    decided: decided >= 0 ? decided : null,
    link: linkFor(decided >= 0 ? why.stage : null, name),
  };
}

export function WhyHereCard({
  answer,
  onOpenSettings,
}: {
  answer: WhyAnswer;
  onOpenSettings?: () => void;
}) {
  const { decided } = answer;
  return (
    <div className="flex flex-col gap-2">
      <h3 id="why-here-heading" className="text-sm font-semibold text-foreground">
        {answer.heading}
      </h3>
      <p className="text-sm text-foreground">{answer.sentence}</p>
      <ol aria-label="The order Moduo checks" className="list-decimal pl-5 text-xs">
        {WHY_STEPS.map((step, i) => {
          const past = decided !== null && i < decided;
          const hit = i === decided;
          return (
            <li
              key={step.stage}
              data-past={past || undefined}
              data-decided={hit || undefined}
              className={cn(hit ? "font-medium text-foreground" : "text-muted-foreground")}
            >
              <span data-step-label>{step.label}</span>
              {past || hit ? (
                <span
                  data-step-tag
                  className={cn(
                    "ml-2 rounded-sm px-1 text-2xs",
                    hit ? "bg-state-selected text-foreground" : "bg-state-hover",
                  )}
                >
                  {hit ? "decided it" : "didn't match"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {answer.link && onOpenSettings ? (
        <div className="border-t border-hairline pt-2">
          {/* The link names the sender: it wraps rather than run past the sheet. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-auto py-1 text-left whitespace-normal"
            onClick={onOpenSettings}
          >
            {answer.link}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The sheet in the reader body, under the sender card (§4, AC15). */
export function WhyHereSheet({
  answer,
  onClose,
  onOpenSettings = openMailRules,
}: {
  answer: WhyAnswer;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <section
      aria-labelledby="why-here-heading"
      data-why-sheet
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
      className="motion-key relative mx-4 mb-3 rounded-lg border border-hairline bg-card p-3 pr-10"
    >
      <WhyHereCard
        answer={answer}
        onOpenSettings={() => {
          onClose();
          onOpenSettings();
        }}
      />
      <IconButton
        icon={X}
        label="Close"
        tooltip={null}
        className="absolute top-2 right-2"
        onClick={onClose}
      />
    </section>
  );
}
