import {
  Building2,
  CreditCard,
  Info,
  KeyRound,
  type LucideIcon,
  Palette,
  Plug,
  Sliders,
  TerminalSquare,
  Timer,
  User,
  Users,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ComponentType, useEffect, useState } from "react";

import { Eyebrow } from "../../components/ui/eyebrow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useShortcut } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";

import { AboutSection } from "./sections/about-section";
import { AccessSection } from "./sections/access-section";
import { AccountSection } from "./sections/account-section";
import { AdvancedSection } from "./sections/advanced-section";
import { ApiKeysSection } from "./sections/api-keys-section";
import { AppearanceSection } from "./sections/appearance-section";
import { BillingSection } from "./sections/billing-section";
import { FocusSection } from "./sections/focus-section";
import { IntegrationsSection } from "./sections/integrations-section";
import { PreferencesSection } from "./sections/preferences-section";
import { WorkspaceSection } from "./sections/workspace-section";
import {
  clearPendingOpenSettings,
  isSettingsSectionId,
  pendingOpenSettings,
  SETTINGS_GROUPS,
  SETTINGS_OPEN_EVENT,
  type SettingsOpenDetail,
  type SettingsSectionId,
} from "./settings-events";

type SectionEntry = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  Component: ComponentType;
};

const SECTIONS: SectionEntry[] = [
  { id: "appearance", label: "Appearance", icon: Palette, Component: AppearanceSection },
  { id: "account", label: "Account", icon: User, Component: AccountSection },
  { id: "billing", label: "Billing", icon: CreditCard, Component: BillingSection },
  { id: "workspace", label: "Workspace", icon: Building2, Component: WorkspaceSection },
  { id: "access", label: "Members and access", icon: Users, Component: AccessSection },
  { id: "integrations", label: "Integrations", icon: Plug, Component: IntegrationsSection },
  { id: "apikeys", label: "API keys", icon: KeyRound, Component: ApiKeysSection },
  {
    id: "preferences",
    label: "Preferences",
    icon: Sliders,
    Component: PreferencesSection,
  },
  { id: "focus", label: "Focus", icon: Timer, Component: FocusSection },
  {
    id: "advanced",
    label: "Advanced",
    icon: TerminalSquare,
    Component: AdvancedSection,
  },
  { id: "about", label: "About", icon: Info, Component: AboutSection },
];

const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<
  SettingsSectionId,
  SectionEntry
>;

export function SettingsModal() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("appearance");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyDetail = (detail: SettingsOpenDetail) => {
      if (detail.section && isSettingsSectionId(detail.section)) {
        setSection(detail.section);
      }
      setOpen(true);
    };
    const handler = (event: Event) => {
      applyDetail((event as CustomEvent<SettingsOpenDetail>).detail ?? {});
    };
    window.addEventListener(SETTINGS_OPEN_EVENT, handler);
    // A cold-load `/settings?section=…` dispatch fires while this modal is
    // unmounted (boot remount churn) — re-apply the sticky dispatch on every
    // mount so the deep link still opens the right section.
    const pending = pendingOpenSettings();
    if (pending) applyDetail(pending);
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, handler);
  }, []);

  useShortcut("settings", () =>
    setOpen((prev) => {
      if (prev) clearPendingOpenSettings();
      return !prev;
    }),
  );

  // Appearance still leans on the visible app behind for the live preview, so
  // its backdrop drops the blur — content stays legible while the modal sits
  // in front. A medium scrim keeps focus on the controls without losing the
  // preview surface. Other sections get a heavier scrim + blur to signal
  // "you're in a panel."
  const isAppearance = section === "appearance";

  const handleOpenChange = (next: boolean) => {
    // A user dismissal must also disarm the deep-link sticky buffer, or a
    // modal remount inside the TTL would re-open what was explicitly closed.
    if (!next) clearPendingOpenSettings();
    setOpen(next);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 transition-opacity",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            isAppearance ? "bg-background/65" : "bg-background/85 backdrop-blur-md",
          )}
          style={{ zIndex: "var(--z-overlay)" }}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "w-[min(92vw,1040px)] h-[min(80vh,720px)]",
            "grid grid-cols-[220px_minmax(0,1fr)] overflow-hidden outline-none",
            "rounded-xl border border-border bg-card text-card-foreground",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
          style={{
            zIndex: "var(--z-dialog)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Customize appearance, account, billing, workspace, integrations, and preferences.
          </DialogPrimitive.Description>

          <Tabs
            value={section}
            onValueChange={(value) => setSection(value as SettingsSectionId)}
            orientation="vertical"
            className="contents"
          >
            <nav
              aria-label="Settings sections"
              className="pane-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted/40 p-3"
            >
              <div className="flex items-center justify-between px-2 pt-1">
                <Eyebrow>Settings</Eyebrow>
                <DialogPrimitive.Close
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  aria-label="Close settings"
                >
                  <X className="size-4" />
                </DialogPrimitive.Close>
              </div>

              {SETTINGS_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <Eyebrow className="px-3">{group.label}</Eyebrow>
                  <TabsList
                    variant="default"
                    aria-label={group.label}
                    className="rounded-none bg-transparent p-0 gap-1"
                  >
                    {group.ids.map((id) => {
                      const { label, icon: Icon } = SECTION_BY_ID[id];
                      return (
                        <TabsTrigger
                          key={id}
                          value={id}
                          className="flex items-center justify-start gap-2 rounded-md px-3 font-sans text-sm font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                          style={{ height: "var(--row-h)" }}
                        >
                          <Icon className="size-4" aria-hidden />
                          <span>{label}</span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>
              ))}
            </nav>

            <div className="pane-scroll min-h-0 overflow-y-auto px-2 py-4">
              {SECTIONS.map(({ id, Component }) => (
                <TabsContent key={id} value={id} className="data-[state=inactive]:hidden">
                  {id === section ? <Component /> : null}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
