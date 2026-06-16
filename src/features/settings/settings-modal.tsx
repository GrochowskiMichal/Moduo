import { useEffect, useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Building2,
  Info,
  LogOut,
  Palette,
  Plug,
  Sliders,
  TerminalSquare,
  Timer,
  User,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useShortcut } from "../../lib/shortcuts";
import { useAuth } from "../../providers/auth-provider";

import { AboutSection } from "./sections/about-section";
import { AccountSection } from "./sections/account-section";
import { AdvancedSection } from "./sections/advanced-section";
import { AppearanceSection } from "./sections/appearance-section";
import { FocusSection } from "./sections/focus-section";
import { IntegrationsSection } from "./sections/integrations-section";
import { PreferencesSection } from "./sections/preferences-section";
import { WorkspaceSection } from "./sections/workspace-section";
import {
  SETTINGS_OPEN_EVENT,
  isSettingsSectionId,
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
  { id: "workspace", label: "Workspace", icon: Building2, Component: WorkspaceSection },
  { id: "integrations", label: "Integrations", icon: Plug, Component: IntegrationsSection },
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

export function SettingsModal() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("appearance");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SettingsOpenDetail>).detail ?? {};
      if (detail.section && isSettingsSectionId(detail.section)) {
        setSection(detail.section);
      }
      setOpen(true);
    };
    window.addEventListener(SETTINGS_OPEN_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_OPEN_EVENT, handler);
  }, []);

  useShortcut("settings", () => setOpen((prev) => !prev));

  // Appearance still leans on the visible app behind for the live preview, so
  // its backdrop drops the blur — content stays legible while the modal sits
  // in front. A medium scrim keeps focus on the controls without losing the
  // preview surface. Other sections get a heavier scrim + blur to signal
  // "you're in a panel."
  const isAppearance = section === "appearance";

  const handleSignOut = async () => {
    setOpen(false);
    try {
      await signOut();
    } finally {
      void navigate({ to: "/auth" });
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
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
            Customize appearance, account, workspace, integrations, and preferences.
          </DialogPrimitive.Description>

          <Tabs
            value={section}
            onValueChange={(value) => setSection(value as SettingsSectionId)}
            orientation="vertical"
            className="contents"
          >
            <nav
              aria-label="Settings sections"
              className="flex h-full min-h-0 flex-col gap-3 border-r border-border bg-muted/40 p-3"
            >
              <div className="flex items-center justify-between px-2 pt-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Settings
                </span>
                <DialogPrimitive.Close
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  aria-label="Close settings"
                >
                  <X className="size-4" />
                </DialogPrimitive.Close>
              </div>

              <TabsList
                variant="default"
                className="rounded-none bg-transparent p-0 gap-1"
              >
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className="flex items-center justify-start gap-2 rounded-md px-3 font-sans text-sm font-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    style={{ height: "var(--row-h)" }}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span>{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="mt-auto flex items-center gap-2 rounded-md px-3 font-sans text-sm font-normal text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                style={{ height: "var(--row-h)" }}
              >
                <LogOut className="size-4" aria-hidden />
                <span>Log out</span>
              </button>
            </nav>

            <div className="min-h-0 overflow-y-auto px-2 py-4">
              {SECTIONS.map(({ id, Component }) => (
                <TabsContent
                  key={id}
                  value={id}
                  className="data-[state=inactive]:hidden"
                >
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
