import { useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { useGlobalShortcuts, useShortcut } from "../../lib/shortcuts";
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
import { Pressable, Text, View } from "../../tw";
import { Icon } from "../ui/icon";
import { ModuoMark } from "../ui/moduo-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { WorkspaceSwitcher } from "../workspace-switcher";
import { WorkspaceSettingsModal } from "../workspace-settings-modal";
import { IntegrationsModal } from "../integrations-modal";
import { UserMenu } from "../user-menu";
import { baseModulesNavItems } from "./app-chrome-constants";
import { GlobalBottomBar } from "./global-bottom-bar";
import { GlobalCommandPalette } from "./global-command-palette";
import { SettingsModal } from "../../features/settings/settings-modal";
import { dispatchOpenSettings } from "../../features/settings/settings-events";
import { dispatchCreateNew } from "./create-events";
import { TrialBanner } from "../trial-banner";

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
    const publishActivity = async () => {
      if (document.visibilityState !== "hidden" && isEmailRoute) {
        // Email workspace publishes account/folder-specific foreground state.
        return;
      }
      const mode =
        document.visibilityState === "hidden" ? "appBackground" : "appForegroundNonMail";
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
    const timer = window.setInterval(() => {
      const shouldRefreshInboxes = document.visibilityState === "hidden" || !isEmailRoute;
      if (!shouldRefreshInboxes) return;
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
      const { data } = await runtime.auth.getLocalAuthState();
      if (!active) return;
      setDisplayName(data.displayName);
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
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-muted-foreground text-sm">Loading workspace...</Text>
      </View>
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
    <View className="flex h-screen min-h-screen flex-col overflow-hidden bg-background">
      <TrialBanner />
      <View
        className="relative px-5 bg-background flex flex-row items-center"
        style={{ zIndex: "var(--z-header)", height: "var(--bar-h)" }}
      >
        <View className="relative z-[1] flex w-full flex-row items-center justify-between gap-3">
          <View className="flex flex-row items-center gap-1">
            <ModuoMark className="h-8 w-8 shrink-0 text-foreground" />
            <WorkspaceSwitcher onOpenSettings={() => setWorkspaceSettingsOpen(true)} />
          </View>

          <View
            className="no-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-visible"
            style={{
              maskImage:
                "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)",
              WebkitMaskImage:
                "linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)",
            }}
          >
            <View className="flex min-w-max flex-row items-center gap-2 pr-2">
              {modulesNavItems.map((tab) => {
                const active =
                  pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
                return (
                  <Tooltip key={tab.href}>
                    <TooltipTrigger
                      data-slot="module-tab"
                      data-active={active}
                      className={`flex flex-row items-center gap-2 rounded-md px-3 py-2 ${active ? "bg-accent text-foreground" : "bg-transparent text-muted-foreground hover:bg-accent/60"}`}
                      onClick={() => void navigate({ to: tab.href })}
                      aria-label={tab.label}
                    >
                      <Icon name={tab.iconName} size={14} />
                      <Text data-slot="module-tab-label" className="text-sm">
                        {tab.label}
                      </Text>
                    </TooltipTrigger>
                    <TooltipContent>{tab.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </View>
          </View>

          <View className="flex flex-row items-center justify-end gap-2">
            <UserMenu
              avatarDataUrl={avatarDataUrl}
              profileInitial={derivedInitial}
              onOpenSettings={() => dispatchOpenSettings()}
            />
          </View>
        </View>
      </View>

      <View className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </View>

      <View
        className="relative px-5 bg-background flex flex-row items-center"
        style={{ height: "var(--bar-h)" }}
      >
        <View className="flex flex-1 flex-row items-center justify-start">
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
        </View>
        <GlobalBottomBar />
        <View className="flex flex-1 flex-row items-center justify-end">
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
        </View>
      </View>
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
    </View>
  );
}
