// "Why is this in {Tab}?" (specs/mail-v3.md §8, A3, decision 18): explain only,
// read-only. Over `engine.explainThread`, one sentence names the deciding reason,
// the six classifier steps follow in order (the ones before the decider dimmed,
// the decider marked for screen readers), and the footer links to the Settings
// section that controls that step. No segmented control, no rule dialog.

import type { MailClassifyStage, MailTabKind } from "@contracts/mail";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { MailExplain } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

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
              className={cn(
                hit ? "font-medium text-foreground" : "text-muted-foreground",
                past && "text-subtle-foreground line-through",
              )}
            >
              {step.label}
              {hit ? <span className="sr-only"> (this decided it)</span> : null}
            </li>
          );
        })}
      </ol>
      {answer.link && onOpenSettings ? (
        <div className="border-t border-hairline pt-2">
          <Button type="button" size="sm" variant="ghost" onClick={onOpenSettings}>
            {answer.link}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function WhyHerePopover({
  answer,
  anchor,
  onClose,
  onOpenSettings,
}: {
  /** null keeps the popover closed. */
  answer: WhyAnswer | null;
  anchor: { current: { getBoundingClientRect(): DOMRect } | null };
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <Popover open={answer !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <PopoverAnchor virtualRef={anchor as React.RefObject<{ getBoundingClientRect(): DOMRect }>} />
      <PopoverContent
        align="end"
        className="w-80 p-3"
        aria-labelledby="why-here-heading"
        // Opened from the ⋯ menu: the menu handing focus back mustn't close it.
        onFocusOutside={(e) => e.preventDefault()}
      >
        {answer ? (
          <WhyHereCard
            answer={answer}
            onOpenSettings={
              onOpenSettings
                ? () => {
                    onClose();
                    onOpenSettings();
                  }
                : undefined
            }
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
