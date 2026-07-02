import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { toast } from "sonner";

import { ENTITY_OPEN_EVENT, entityOpenTarget } from "../../lib/entity-open";

import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import {
  formatShortcut,
  SHORTCUTS,
  useGlobalShortcuts,
  useShortcut,
  type ShortcutId,
} from "../../lib/shortcuts";
import {
  PROFILE_UPDATED_EVENT,
  readStoredAvatar,
} from "../../features/profile/profile-storage";
import {
  dispatchLayoutPanelsApply,
  LAYOUT_PANELS_SET_EVENT,
  readPanelsMap,
  routeToFeatureLayout,
  writePanelsMap,
  type FeatureLayoutKey,
  type LayoutPanelsApplyDetail,
} from "../../features/layout/panel-events";
import { Icon } from "../ui/icon";
import { ModuoMark } from "../ui/moduo-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceSwitcher } from "../workspace-switcher";
import { WorkspaceSettingsModal } from "../workspace-settings-modal";
import { IntegrationsModal } from "../integrations-modal";
import { UserMenu } from "../user-menu";
import { NotificationCenter } from "../notification-center";
import { baseModulesNavItems } from "./app-chrome-constants";
import type { ModuleNavItem } from "./app-chrome-types";
import { GlobalBottomBar } from "./global-bottom-bar";
import { GlobalCommandPalette } from "./global-command-palette";
import { SettingsModal } from "../../features/settings/settings-modal";
import { dispatchOpenSettings } from "../../features/settings/settings-events";
import { dispatchCreateNew } from "./create-events";
import { TrialBanner } from "../trial-banner";

type ModuleTabProps = {
  item: ModuleNavItem;
  active: boolean;
  index: number;
  onClick: () => void;
};

function ModuleTab({ item, active, index, onClick }: ModuleTabProps) {
  const shortcutId = `module-${index + 1}` as ShortcutId;
  const shortcut = SHORTCUTS.find((s) => s.id === shortcutId);
  const hint = shortcut ? formatShortcut(shortcut) : "";
  const ariaLabel = hint ? `${item.label} (${hint})` : item.label;
  return (
    <Tooltip>
      <TooltipTrigger
        data-slot="module-tab"
        data-active={active}
        aria-current={active ? "page" : undefined}
        aria-label={ariaLabel}
        onClick={onClick}
        className={`flex h-8 flex-row items-center gap-2 rounded-md px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${active ? "bg-accent text-foreground" : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"}`}
      >
        <Icon name={item.iconName} size={14} />
        <span data-slot="module-tab-label" className="text-sm">
          {item.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span>{item.label}</span>
        {hint ? <kbd className="ml-2 font-mono text-xs text-muted-foreground">{hint}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppChrome({ profileInitial }: { profileInitial: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  useGlobalShortcuts();
  // The Cmd-, shortcut is handled inside SettingsModal so it can toggle the
  // modal open / closed without bouncing through the /settings route. Keep
  // useShortcut wiring here for the rest.
  useShortcut("new-item", () => dispatchCreateNew());
  const { runtime, userEmail } = useAuth();
  const { loading, modulePermissions } = useWorkspace();
  const currentFeature = routeToFeatureLayout(pathname);
  const isEmailRoute = pathname.startsWith("/email");
  const isSettingsRoute = pathname.startsWith("/settings");

  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [featurePanels, setFeaturePanels] = useState(() => readPanelsMap());
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!runtime || typeof window === "undefined") return;

    const isMac =
      typeof navigator !== "undefined" &&
      (navigator.platform?.toLowerCase().includes("mac") ||
        navigator.userAgent?.toLowerCase().includes("mac os"));

    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if ((el as HTMLElement & { isContentEditable?: boolean }).isContentEditable) return true;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select";
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const shouldToggle =
        (isMac && event.metaKey && event.ctrlKey && key === "f") ||
        (!isMac && key === "f11");

      if (!shouldToggle) return;
      event.preventDefault();
      void runtime.window.toggleFullscreen();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [runtime]);

  // The host listener for the spine's deep-link event (FX-1 AC1). Every linked
  // row, entity-ref chip, and dashboard widget dispatches `moduo:entity:open`;
  // this is the one place that routes it. Unknown types get a quiet toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onEntityOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; id?: string }>).detail;
      if (!detail?.type || !detail.id) return;
      const target = entityOpenTarget(detail.type, detail.id);
      if (!target) {
        toast("Nothing to open yet", {
          description: `There's no page for "${detail.type}" yet.`,
        });
        return;
      }
      if (target.to === "/contacts") {
        void navigate({ to: "/contacts", search: target.search ?? {} });
      } else {
        void navigate({ to: target.to });
      }
    };
    window.addEventListener(ENTITY_OPEN_EVENT, onEntityOpen);
    return () => window.removeEventListener(ENTITY_OPEN_EVENT, onEntityOpen);
  }, [navigate]);

  const modulesNavItems = useMemo(
    () =>
      baseModulesNavItems.filter((tab) => {
        if (tab.module === "notes") return modulePermissions.notes !== "none";
        if (tab.module === "tasks") return modulePermissions.tasks !== "none";
        return true;
      }),
    [modulePermissions.notes, modulePermissions.tasks],
  );

  useEffect(() => {
    if (!isSettingsRoute && !modulesNavItems.some((tab) => tab.href === pathname)) {
      void navigate({ to: modulesNavItems[0]?.href ?? "/", replace: true });
    }
  }, [isSettingsRoute, navigate, pathname, modulesNavItems]);

  // ⌘1..⌘6 navigate to the Nth visible module tab. Six fixed useShortcut
  // calls keeps hook order stable across renders; handlers no-op when the
  // index exceeds the current visible list.
  const navigateToIndex = useCallback(
    (index: number) => {
      const item = modulesNavItems[index];
      if (!item) return;
      void navigate({ to: item.href });
    },
    [modulesNavItems, navigate],
  );
  useShortcut("module-1", useCallback(() => navigateToIndex(0), [navigateToIndex]));
  useShortcut("module-2", useCallback(() => navigateToIndex(1), [navigateToIndex]));
  useShortcut("module-3", useCallback(() => navigateToIndex(2), [navigateToIndex]));
  useShortcut("module-4", useCallback(() => navigateToIndex(3), [navigateToIndex]));
  useShortcut("module-5", useCallback(() => navigateToIndex(4), [navigateToIndex]));
  useShortcut("module-6", useCallback(() => navigateToIndex(5), [navigateToIndex]));

  useEffect(() => {
    writePanelsMap(featurePanels);
  }, [featurePanels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSetPanels = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (!detail?.feature) return;
      setFeaturePanels((current) => {
        const existing = current[detail.feature];
        if (existing && existing.left === detail.left && existing.right === detail.right)
          return current;
        return {
          ...current,
          [detail.feature]: { left: detail.left, right: detail.right },
        };
      });
    };
    window.addEventListener(LAYOUT_PANELS_SET_EVENT, onSetPanels);
    return () => window.removeEventListener(LAYOUT_PANELS_SET_EVENT, onSetPanels);
  }, []);

  const currentPanels = featurePanels[currentFeature];
  useEffect(() => {
    dispatchLayoutPanelsApply({
      feature: currentFeature,
      left: currentPanels.left,
      right: currentPanels.right,
    });
  }, [currentFeature, currentPanels.left, currentPanels.right]);

  useEffect(() => {
    if (!runtime || typeof document === "undefined") return;
    if (!isEmailRoute) return;
    const publishActivity = async () => {
      // Email workspace publishes account/folder-specific foreground state.
      // Outside of /email we avoid background email signals to prevent secret access.
      if (document.visibilityState !== "hidden") return;
      const mode = "appBackground";
      try {
        await runtime.email.setActivityState({
          mode,
          activeAccountId: null,
          activeFolder: null,
        });
      } catch {
        // best-effort signal only
      }
    };

    void publishActivity();
    const onVisibilityChange = () => {
      void publishActivity();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isEmailRoute, runtime]);

  useEffect(() => {
    if (!runtime || typeof document === "undefined" || typeof window === "undefined") return;
    if (!isEmailRoute) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void runtime.email.syncNow({ folder: "inbox" });
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isEmailRoute, runtime]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const readAvatar = async () => {
      const next = await readStoredAvatar(runtime);
      if (active) setAvatarDataUrl(next);
    };
    void readAvatar();
    const onStorage = () => {
      void readAvatar();
    };
    const onProfileUpdated = () => {
      void readAvatar();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    return () => {
      active = false;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    };
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    let active = true;
    const load = async () => {
      const { data } = await runtime.auth.getSession();
      if (!active) return;
      const name = data.session?.user?.email?.split("@")[0] ?? null;
      setDisplayName(name);
    };
    void load();
    const onProfileUpdated = () => {
      void load();
    };
    if (typeof window !== "undefined") {
      window.addEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
    }
    return () => {
      active = false;
      if (typeof window !== "undefined") {
        window.removeEventListener(PROFILE_UPDATED_EVENT, onProfileUpdated);
      }
    };
  }, [runtime]);

  const setPanelsForFeature = useMemo(
    () => (feature: FeatureLayoutKey, left: boolean, right: boolean) => {
      setFeaturePanels((current) => {
        const existing = current[feature];
        if (existing && existing.left === left && existing.right === right) return current;
        return {
          ...current,
          [feature]: { left, right },
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (currentFeature !== "settings") return;
    setPanelsForFeature("settings", true, false);
  }, [currentFeature, setPanelsForFeature]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading workspace...</span>
      </div>
    );
  }

  const derivedInitial =
    displayName?.trim().slice(0, 1).toUpperCase() ||
    userEmail?.trim().slice(0, 1).toUpperCase() ||
    profileInitial;

  const toggleLeftPanel = () => {
    if (isSettingsRoute) return;
    setPanelsForFeature(currentFeature, !currentPanels.left, currentPanels.right);
  };
  const toggleRightPanel = () => {
    if (isSettingsRoute) return;
    setPanelsForFeature(currentFeature, currentPanels.left, !currentPanels.right);
  };

  return (
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-background">
      <TrialBanner />
      <nav
        aria-label="Workspace navigation"
        className="relative grid w-full items-center bg-background px-5"
        style={{
          zIndex: "var(--z-header)",
          height: "var(--bar-h)",
          gridTemplateColumns: "1fr auto 1fr",
        }}
      >
        <div className="flex flex-row items-center justify-start gap-1">
          <ModuoMark className="h-8 w-8 shrink-0 text-foreground" />
          <WorkspaceSwitcher onOpenSettings={() => setWorkspaceSettingsOpen(true)} />
        </div>

        <div className="flex flex-row items-center justify-center gap-1">
          {modulesNavItems.map((tab, index) => {
            const active =
              pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
            return (
              <ModuleTab
                key={tab.href}
                item={tab}
                active={active}
                index={index}
                onClick={() => void navigate({ to: tab.href })}
              />
            );
          })}
        </div>

        <div className="flex flex-row items-center justify-end gap-2">
          <NotificationCenter />
          <UserMenu
            avatarDataUrl={avatarDataUrl}
            profileInitial={derivedInitial}
            onOpenSettings={() => dispatchOpenSettings()}
          />
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>

      <div
        className="relative flex flex-row items-center bg-background px-5"
        style={{ height: "var(--bar-h)" }}
      >
        <div className="flex flex-1 flex-row items-center justify-start">
          <Tooltip>
            <TooltipTrigger
              className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={toggleLeftPanel}
              aria-label={currentPanels.left ? "Collapse left panel" : "Expand left panel"}
            >
              {currentPanels.left ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
            </TooltipTrigger>
            <TooltipContent>
              {currentPanels.left ? "Collapse left panel" : "Expand left panel"}
            </TooltipContent>
          </Tooltip>
        </div>
        <GlobalBottomBar />
        <div className="flex flex-1 flex-row items-center justify-end">
          {!isSettingsRoute ? (
            <Tooltip>
              <TooltipTrigger
                className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                onClick={toggleRightPanel}
                aria-label={currentPanels.right ? "Collapse right panel" : "Expand right panel"}
              >
                {currentPanels.right ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              </TooltipTrigger>
              <TooltipContent>
                {currentPanels.right ? "Collapse right panel" : "Expand right panel"}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <GlobalCommandPalette />
      <SettingsModal />
      <WorkspaceSettingsModal
        visible={workspaceSettingsOpen}
        onClose={() => setWorkspaceSettingsOpen(false)}
      />
      <IntegrationsModal
        visible={integrationsOpen}
        onClose={() => setIntegrationsOpen(false)}
      />
    </div>
  );
}
