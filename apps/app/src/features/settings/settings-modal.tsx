import {
  Building2,
  CreditCard,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  type LucideIcon,
  MessageSquare,
  Palette,
  Plug,
  Sliders,
  TerminalSquare,
  Timer,
  User,
  Users,
  X,
} from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { Eyebrow } from "../../components/ui/eyebrow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useShortcut } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { type LazySection, lazySection, SettingsSectionView } from "./section-loader";
import { AccountSection } from "./sections/account-section";
import {
  clearPendingOpenSettings,
  isSettingsSectionId,
  pendingOpenSettings,
  SETTINGS_CLOSE_EVENT,
  SETTINGS_GROUPS,
  SETTINGS_OPEN_EVENT,
  type SettingsOpenDetail,
  type SettingsSectionId,
} from "./settings-events";

// Sections load on first open (each is its own async chunk), so the modal's
// weight (fflate, billing, access) stays off the first-load bundle. Account is
// the exception: it holds Log out, which has to work offline, when a chunk
// never fetched before can't load.
const AboutSection = lazySection(() =>
  import("./sections/about-section").then((m) => m.AboutSection),
);
const AccessSection = lazySection(() =>
  import("./sections/access-section").then((m) => m.AccessSection),
);
const AdvancedSection = lazySection(() =>
  import("./sections/advanced-section").then((m) => m.AdvancedSection),
);
const ApiKeysSection = lazySection(() =>
  import("./sections/api-keys-section").then((m) => m.ApiKeysSection),
);
const AppearanceSection = lazySection(() =>
  import("./sections/appearance-section").then((m) => m.AppearanceSection),
);
const BillingSection = lazySection(() =>
  import("./sections/billing-section").then((m) => m.BillingSection),
);
const ChatSection = lazySection(() => import("./sections/chat-section").then((m) => m.ChatSection));
const FocusSection = lazySection(() =>
  import("./sections/focus-section").then((m) => m.FocusSection),
);
const IntegrationsSection = lazySection(() =>
  import("./sections/integrations-section").then((m) => m.IntegrationsSection),
);
const PreferencesSection = lazySection(() =>
  import("./sections/preferences-section").then((m) => m.PreferencesSection),
);
const StorageSection = lazySection(() =>
  import("./sections/storage-section").then((m) => m.StorageSection),
);
const TimeRegionSection = lazySection(() =>
  import("./sections/time-region-section").then((m) => m.TimeRegionSection),
);
const WorkspaceSection = lazySection(() =>
  import("./sections/workspace-section").then((m) => m.WorkspaceSection),
);

type SectionEntry = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  Component: ComponentType | LazySection;
};

const SECTIONS: SectionEntry[] = [
  { id: "appearance", label: "Appearance", icon: Palette, Component: AppearanceSection },
  { id: "account", label: "Account", icon: User, Component: AccountSection },
  { id: "billing", label: "Billing", icon: CreditCard, Component: BillingSection },
  { id: "workspace", label: "Workspace", icon: Building2, Component: WorkspaceSection },
  { id: "access", label: "Members and access", icon: Users, Component: AccessSection },
  { id: "storage", label: "Storage", icon: HardDrive, Component: StorageSection },
  { id: "integrations", label: "Integrations", icon: Plug, Component: IntegrationsSection },
  { id: "apikeys", label: "API keys", icon: KeyRound, Component: ApiKeysSection },
  {
    id: "preferences",
    label: "Preferences",
    icon: Sliders,
    Component: PreferencesSection,
  },
  { id: "timeregion", label: "Time & region", icon: Globe, Component: TimeRegionSection },
  { id: "focus", label: "Focus", icon: Timer, Component: FocusSection },
  { id: "chat", label: "Chat", icon: MessageSquare, Component: ChatSection },
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
    // Something inside Settings leads elsewhere (Storage's task name).
    const close = () => setOpen(false);
    window.addEventListener(SETTINGS_CLOSE_EVENT, close);
    // A cold-load `/settings?section=…` dispatch fires while this modal is
    // unmounted (boot remount churn) — re-apply the sticky dispatch on every
    // mount so the deep link still opens the right section.
    const pending = pendingOpenSettings();
    if (pending) applyDetail(pending);
    return () => {
      window.removeEventListener(SETTINGS_OPEN_EVENT, handler);
      window.removeEventListener(SETTINGS_CLOSE_EVENT, close);
    };
  }, []);

  useShortcut("settings", () =>
    setOpen((prev) => {
      if (prev) clearPendingOpenSettings();
      return !prev;
    }),
  );

  // Appearance still leans on the visible app behind for the live preview, so
  // its backdrop is lighter — content stays legible while the modal sits in
  // front. A medium scrim keeps focus on the controls without losing the
  // preview surface. Other sections get a heavier scrim to signal "you're in a
  // panel." No backdrop blur anywhere (tasks-v3 call 81).
  const isAppearance = section === "appearance";

  const handleOpenChange = (next: boolean) => {
    // A user dismissal must also disarm the deep-link sticky buffer, or a
    // modal remount inside the TTL would re-open what was explicitly closed.
    if (!next) clearPendingOpenSettings();
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={isAppearance ? "bg-background/65" : "bg-background/85"}
        className={cn(
          "w-[min(92vw,1040px)] max-w-none h-[min(80vh,720px)] gap-0 p-0",
          "grid-cols-[220px_minmax(0,1fr)] overflow-hidden",
        )}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize appearance, account, billing, workspace, integrations, and preferences.
        </DialogDescription>

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
              <DialogClose
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="Close settings"
              >
                <X className="size-4" />
              </DialogClose>
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
                        className="flex items-center justify-start gap-2 rounded-md px-3 font-sans text-sm font-normal text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=active]:bg-state-active data-[state=active]:text-foreground data-[state=active]:shadow-none"
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

          <div className="pane-scroll h-full min-h-0 overflow-y-auto px-2 py-4">
            {SECTIONS.map(({ id, Component }) => (
              <TabsContent key={id} value={id} className="data-[state=inactive]:hidden">
                {id === section ? <SettingsSectionView section={Component} /> : null}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
