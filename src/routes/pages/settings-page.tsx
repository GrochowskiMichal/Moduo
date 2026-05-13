import { useEffect, useState } from "react";
import {
  AppWindow,
  Building2,
  Info,
  Palette,
  Plug,
  Sliders,
  TerminalSquare,
  User,
  type LucideIcon,
} from "lucide-react";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { AboutSection } from "../../features/settings/sections/about-section";
import { AccountSection } from "../../features/settings/sections/account-section";
import { AdvancedSection } from "../../features/settings/sections/advanced-section";
import { AppearanceSection } from "../../features/settings/sections/appearance-section";
import { IntegrationsSection } from "../../features/settings/sections/integrations-section";
import { PreferencesSection } from "../../features/settings/sections/preferences-section";
import { WorkspaceSection } from "../../features/settings/sections/workspace-section";

type SettingsSectionId =
  | "appearance"
  | "account"
  | "workspace"
  | "integrations"
  | "preferences"
  | "advanced"
  | "about";

type NavEntry = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
};

const SECTIONS: NavEntry[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "account", label: "Account", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "preferences", label: "Preferences", icon: Sliders },
  { id: "advanced", label: "Advanced", icon: TerminalSquare },
  { id: "about", label: "About", icon: Info },
];

const VALID_IDS = new Set(SECTIONS.map((s) => s.id));

function readInitialSection(): SettingsSectionId {
  if (typeof window === "undefined") return "appearance";
  const s = new URLSearchParams(window.location.search).get("section");
  if (s && VALID_IDS.has(s as SettingsSectionId)) {
    return s as SettingsSectionId;
  }
  return "appearance";
}

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSectionId>(readInitialSection);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      const next = readInitialSection();
      setSection(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("section") === section) return;
    if (section === "appearance") {
      params.delete("section");
    } else {
      params.set("section", section);
    }
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [section]);

  return (
    <Tabs
      value={section}
      onValueChange={(value) => setSection(value as SettingsSectionId)}
      orientation="vertical"
      className="contents"
    >
      <FeaturePanelsShell
        feature="settings"
        hideRight
        left={
          <nav aria-label="Settings sections" className="flex h-full min-h-0 flex-col gap-2">
            <p className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </p>
            <TabsList variant="line" className="border-none bg-transparent p-0">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="justify-start gap-2 rounded-md px-3 hover:bg-accent data-[state=active]:bg-accent data-[state=active]:shadow-none"
                  style={{ height: "var(--row-h)" }}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>
        }
        center={
          <div className="h-full overflow-auto px-2 py-4">
            <TabsContent value="appearance" className="data-[state=inactive]:hidden">
              <AppearanceSection />
            </TabsContent>
            <TabsContent value="account" className="data-[state=inactive]:hidden">
              <AccountSection />
            </TabsContent>
            <TabsContent value="workspace" className="data-[state=inactive]:hidden">
              <WorkspaceSection />
            </TabsContent>
            <TabsContent value="integrations" className="data-[state=inactive]:hidden">
              <IntegrationsSection />
            </TabsContent>
            <TabsContent value="preferences" className="data-[state=inactive]:hidden">
              <PreferencesSection />
            </TabsContent>
            <TabsContent value="advanced" className="data-[state=inactive]:hidden">
              <AdvancedSection />
            </TabsContent>
            <TabsContent value="about" className="data-[state=inactive]:hidden">
              <AboutSection />
            </TabsContent>
          </div>
        }
      />
    </Tabs>
  );
}
