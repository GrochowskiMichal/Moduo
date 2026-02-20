import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Modal, ScrollView } from "react-native";
import { usePathname, useRouter, Slot } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { useDashboardContext } from "../../features/dashboard/providers/dashboard-provider";
import { NotificationCenter } from "../notification-center";
import { WorkspaceSwitcher } from "../workspace-switcher";
import { WorkspaceSettingsModal } from "../workspace-settings-modal";
import { Image, Pressable, Text, View } from "../../tw";
import {
  dispatchNotesCreateKind,
  dispatchNotesFocusSearch,
} from "../../features/notes/ui/layout-events";
import { dispatchDashboardViewChange } from "../../features/dashboard/ui/layout-events";
import {
  dispatchTasksCreateEntity,
  dispatchTasksFocusSearch,
  dispatchTasksSelectProject,
} from "../../features/tasks/ui/layout-events";
import {
  dispatchLayoutPanelsApply,
  readPanelsMap,
  routeToFeatureLayout,
  writePanelsMap,
  type FeatureLayoutKey,
} from "../../features/layout/panel-events";
import type { NoteKind } from "../../features/notes/types";

type TabItem = { label: string; iconName: string; href: string; module?: "notes" | "tasks" };
type TaskProjectOption = { id: string; name: string };

const baseTabs: TabItem[] = [
  { label: "Dashboard", iconName: "grid", href: "/" },
  { label: "Calendar", iconName: "calendar", href: "/calendar" },
  { label: "Notes", iconName: "file-text", href: "/notes", module: "notes" },
  { label: "Email", iconName: "mail", href: "/email" },
  { label: "Tasks", iconName: "check-square", href: "/tasks", module: "tasks" },
  { label: "Tags", iconName: "tag", href: "/tags" },
  { label: "Form", iconName: "edit-3", href: "/form" },
  { label: "Timesheet", iconName: "clock", href: "/timesheet" },
  { label: "Whiteboard", iconName: "pen-tool", href: "/whiteboard" },
  { label: "Mindmap", iconName: "git-branch", href: "/mindmap" },
  { label: "Files", iconName: "folder", href: "/files" },
  { label: "Stats", iconName: "bar-chart-2", href: "/stats" },
  { label: "Budget", iconName: "dollar-sign", href: "/budget" },
];

const notesCreateActions: Array<{ label: string; kind: NoteKind; icon: string }> = [
  { label: "New Section", kind: "category", icon: "▣" },
  { label: "New Note Folder", kind: "folder", icon: "▢" },
  { label: "New Note", kind: "note", icon: "☰" },
];

const tasksCreateActions: Array<{ label: string; entity: "task" | "project"; icon: string }> = [
  { label: "New Task", entity: "task", icon: "☑" },
  { label: "New Project", entity: "project", icon: "◫" },
];

export function AppChrome({ profileInitial }: { profileInitial: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut, supabase, userId } = useAuth();
  const { loading, modulePermissions, selectedWorkspaceId } = useWorkspace();
  const { 
    views: dashboardViews, 
    activeViewId: activeDashboardViewId, 
    setActiveViewId: setActiveDashboardViewId,
    createView: createDashboardView,
    updateView: updateDashboardView,
    deleteView: deleteDashboardView
  } = useDashboardContext();

  const isDashboardRoute = pathname === "/";
  const isNotesRoute = pathname === "/notes";
  const isTasksRoute = pathname === "/tasks";
  const currentFeature = routeToFeatureLayout(pathname);

  const [notesCreateMenuOpen, setNotesCreateMenuOpen] = useState(false);
  const [tasksCreateMenuOpen, setTasksCreateMenuOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [taskProjectMenuOpen, setTaskProjectMenuOpen] = useState(false);
  const [dashboardViewMenuOpen, setDashboardViewMenuOpen] = useState(false);
  const [taskProjects, setTaskProjects] = useState<TaskProjectOption[]>([]);
  const [taskProjectsLoaded, setTaskProjectsLoaded] = useState(false);
  const [selectedTaskProjectId, setSelectedTaskProjectId] = useState<string | null>(null);

  const [hoveredDashboardViewId, setHoveredDashboardViewId] = useState<string | null>(null);
  const [hoveredTaskProjectId, setHoveredTaskProjectId] = useState<string | null>(null);
  const [showDashboardTabControls, setShowDashboardTabControls] = useState(isDashboardRoute);
  const [showTasksTabControls, setShowTasksTabControls] = useState(isTasksRoute);
  const [featurePanels, setFeaturePanels] = useState(() => readPanelsMap());
  const dashboardTabControlsAnim = useRef(new Animated.Value(isDashboardRoute ? 1 : 0)).current;
  const tasksTabControlsAnim = useRef(new Animated.Value(isTasksRoute ? 1 : 0)).current;

  useEffect(() => {
    if (!isNotesRoute) setNotesCreateMenuOpen(false);
  }, [isNotesRoute]);

  useEffect(() => {
    if (!isDashboardRoute) setDashboardViewMenuOpen(false);
  }, [isDashboardRoute]);

  useEffect(() => {
    if (!isTasksRoute) {
      setTasksCreateMenuOpen(false);
      setTaskProjectMenuOpen(false);
    }
  }, [isTasksRoute]);

  useEffect(() => {
    if (isDashboardRoute) {
      setShowDashboardTabControls(true);
      Animated.timing(dashboardTabControlsAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(dashboardTabControlsAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
      
    }).start(({ finished }) => {
      if (finished) setShowDashboardTabControls(false);
    });
  }, [dashboardTabControlsAnim, isDashboardRoute]);

  useEffect(() => {
    if (isTasksRoute) {
      setShowTasksTabControls(true);
      Animated.timing(tasksTabControlsAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(tasksTabControlsAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShowTasksTabControls(false);
    });
  }, [isTasksRoute, tasksTabControlsAnim]);

  // Dispatch event when active dashboard view changes
  useEffect(() => {
    if (activeDashboardViewId) {
      const view = dashboardViews.find(v => v.id === activeDashboardViewId);
      if (view) {
        dispatchDashboardViewChange(activeDashboardViewId, view.name);
      }
    }
  }, [activeDashboardViewId, dashboardViews]);

  const refreshTaskProjects = useCallback(async () => {
    if (!selectedWorkspaceId || !supabase || !isTasksRoute) {
      setTaskProjects([]);
      setSelectedTaskProjectId(null);
      setTaskProjectsLoaded(false);
      return;
    }
    setTaskProjectsLoaded(false);

    const { data } = await supabase
      .from("task_projects")
      .select("id,name")
      .eq("workspace_id", selectedWorkspaceId)
      .is("deleted_at", null)
      .order("position", { ascending: true });

    const next = ((data ?? []) as TaskProjectOption[]).filter((project) => !!project.id);
    setTaskProjects(next);
    setSelectedTaskProjectId((current) =>
      current === null ? null : next.find((project) => project.id === current)?.id ?? next[0]?.id ?? null
    );
    setTaskProjectsLoaded(true);
  }, [isTasksRoute, selectedWorkspaceId, supabase]);

  useEffect(() => {
    void refreshTaskProjects();
  }, [refreshTaskProjects]);

  useEffect(() => {
    if (!isTasksRoute) return;
    dispatchTasksSelectProject(selectedTaskProjectId);
  }, [isTasksRoute, selectedTaskProjectId]);

  useEffect(() => {
    writePanelsMap(featurePanels);
  }, [featurePanels]);

  useEffect(() => {
    const current = featurePanels[currentFeature];
    dispatchLayoutPanelsApply({
      feature: currentFeature,
      left: current.left,
      right: current.right,
    });
  }, [currentFeature, featurePanels]);

  const tabs = useMemo(
    () =>
      baseTabs.filter((tab) => {
        if (tab.module === "notes") return modulePermissions.notes !== "none";
        if (tab.module === "tasks") return modulePermissions.tasks !== "none";
        return true;
      }),
    [modulePermissions.notes, modulePermissions.tasks]
  );

  const noModuleAccess = modulePermissions.notes === "none" && modulePermissions.tasks === "none";
  const canEditNotes = modulePermissions.notes === "edit" || modulePermissions.notes === "admin";
  const canEditTasks = modulePermissions.tasks === "edit" || modulePermissions.tasks === "admin";

  useEffect(() => {
    if (!tabs.some((tab) => tab.href === pathname)) {
      router.replace("/" as any);
    }
  }, [pathname, router, tabs]);

  const supportsLeftPanelToggle = true;
  const supportsRightPanelToggle = true;

  const selectedTaskProjectLabel =
    selectedTaskProjectId === null
      ? "All projects"
      : taskProjects.find((project) => project.id === selectedTaskProjectId)?.name ?? "No projects";
  const activeDashboardViewName =
    dashboardViews.find((view) => view.id === activeDashboardViewId)?.name ?? "No views";
  const topBarPressableStyle = { backgroundColor: "transparent", borderWidth: 0 };
  const setPanelsForFeature = useCallback((feature: FeatureLayoutKey, left: boolean, right: boolean) => {
    setFeaturePanels((current) => ({
      ...current,
      [feature]: { left, right },
    }));
  }, []);

  const setActiveDashboardView = (viewId: string) => {
    setActiveDashboardViewId(viewId);
    // Event dispatch is handled by useEffect
  };

  const setActiveTaskProject = (projectId: string | null) => {
    setSelectedTaskProjectId(projectId);
    dispatchTasksSelectProject(projectId);
  };

  const addTaskProject = async () => {
    if (!supabase || !selectedWorkspaceId || !userId || !canEditTasks) return;
    const inputName = typeof window === "undefined" ? "New Project" : window.prompt("Project name", "New Project");
    if (!inputName || !inputName.trim()) return;
    const name = inputName.trim();
    const position = `m${Date.now().toString(36)}`;

    const { data, error } = await supabase
      .from("task_projects")
      .insert({
        workspace_id: selectedWorkspaceId,
        owner_id: userId,
        name,
        description: "",
        position,
      })
      .select("id,name")
      .single();
    if (error || !data?.id) return;

    const nextProject = { id: data.id as string, name: (data.name as string) ?? name };
    setTaskProjects((current) => [...current, nextProject]);
    setActiveTaskProject(nextProject.id);
    setTaskProjectMenuOpen(false);
  };

  const renameTaskProject = async (projectId: string) => {
    if (!supabase || !selectedWorkspaceId || !canEditTasks) return;
    const current = taskProjects.find((project) => project.id === projectId);
    if (!current) return;
    const nextName =
      typeof window === "undefined" ? current.name : window.prompt("Rename project", current.name);
    if (!nextName || !nextName.trim() || nextName.trim() === current.name) return;
    const name = nextName.trim();

    const { error } = await supabase
      .from("task_projects")
      .update({ name })
      .eq("workspace_id", selectedWorkspaceId)
      .eq("id", projectId);
    if (error) return;

    setTaskProjects((items) => items.map((project) => (project.id === projectId ? { ...project, name } : project)));
  };

  const removeTaskProject = async (projectId: string) => {
    if (!supabase || !selectedWorkspaceId || !canEditTasks) return;
    const { error } = await supabase
      .from("task_projects")
      .update({ deleted_at: new Date().toISOString() })
      .eq("workspace_id", selectedWorkspaceId)
      .eq("id", projectId);
    if (error) return;

    const next = taskProjects.filter((project) => project.id !== projectId);
    setTaskProjects(next);
    if (selectedTaskProjectId === projectId) {
      const fallback = next[0]?.id ?? null;
      setActiveTaskProject(fallback);
    }
  };

  const addDashboardView = async () => {
    const inputName = typeof window === "undefined" ? "New View" : window.prompt("Dashboard view name", "New View");
    if (!inputName || !inputName.trim()) return;
    await createDashboardView(inputName.trim());
    setDashboardViewMenuOpen(false);
  };

  const renameDashboardView = async (viewId: string) => {
    const existing = dashboardViews.find((view) => view.id === viewId);
    if (!existing) return;
    const nextName =
      typeof window === "undefined" ? existing.name : window.prompt("Rename dashboard view", existing.name);
    if (!nextName || !nextName.trim() || nextName.trim() === existing.name) return;
    await updateDashboardView(viewId, { name: nextName.trim() });
  };

  const removeDashboardView = async (viewId: string) => {
    if (dashboardViews.length <= 1) return;
    await deleteDashboardView(viewId);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-[#0C0C0C] items-center justify-center">
        <Text className="text-[#a0a0a0] text-[14px]">Loading workspace...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#0C0C0C]">
      <View className="px-5 pt-4 pb-2 bg-[#0C0C0C]">
        <View className="flex-row items-center gap-3">
          <View className="flex-row items-center gap-3 min-w-[330px]">
            <Image source={require("../../../assets/moduo_favicon.png")} className="w-8 h-8" contentFit="contain" />
            <WorkspaceSwitcher onOpenSettings={() => setWorkspaceSettingsOpen(true)} />
          </View>

          <View className="flex-1">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", gap: 8, paddingRight: 12 }}>
              {tabs.map((tab) => {
                const active =
                  pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href));
                const isDashboardTab = tab.href === "/";
                const isTasksTab = tab.href === "/tasks";
                return (
                  <View key={tab.label} className="flex-row items-center gap-2">
                    {isDashboardTab ? (
                      <View className="relative">
                        <View className="flex-row items-center">
                          <Pressable
                            className="px-3 py-2.5 flex-row items-center gap-2 bg-transparent border-0 rounded-none"
                            style={topBarPressableStyle}
                            onPress={() => router.replace(tab.href as any)}
                          >
                            <Feather name={tab.iconName as any} size={14} color={active ? "#f2f2f2" : "#9a9a9a"} />
                            <Text className={`${active ? "text-[#f5f5f5]" : "text-[#a3a3a3]"} text-[14px]`}>
                              {tab.label}
                            </Text>
                          </Pressable>

                          {showDashboardTabControls ? (
                            <Animated.View
                              style={{
                                opacity: dashboardTabControlsAnim,
                                transform: [
                                  {
                                    translateX: dashboardTabControlsAnim.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [-8, 0],
                                    }),
                                  },
                                ],
                              }}
                            >
                              <View className="pl-1 pr-2 py-1.5 flex-row items-center gap-2">
                                <Pressable
                                  className="h-6 flex-row items-center gap-1 bg-transparent border-0 rounded-none"
                                  style={topBarPressableStyle}
                                  onPress={() => setDashboardViewMenuOpen((current) => !current)}
                                >
                                  <Text className="text-[#a3a3a3] text-[12px] max-w-[140px]" numberOfLines={1}>
                                    {activeDashboardViewName}
                                  </Text>
                                  <Text
                                    className="text-[#b7b7b7] text-[11px]"
                                    style={{ transform: [{ rotate: dashboardViewMenuOpen ? "180deg" : "0deg" }] }}
                                  >
                                    ▾
                                  </Text>
                                </Pressable>
                              </View>
                            </Animated.View>
                          ) : null}
                        </View>

                      </View>
                    ) : (
                      <Pressable
                        className="px-3 py-2.5 flex-row items-center gap-2 bg-transparent border-0 rounded-none"
                        style={topBarPressableStyle}
                        onPress={() => router.replace(tab.href as any)}
                      >
                        <Feather name={tab.iconName as any} size={14} color={active ? "#f2f2f2" : "#9a9a9a"} />
                        <Text className={`${active ? "text-[#f5f5f5]" : "text-[#a3a3a3]"} text-[14px]`}>
                          {tab.label}
                        </Text>
                      </Pressable>
                    )}

                    {isTasksTab && showTasksTabControls ? (
                      <Animated.View
                        style={{
                          opacity: tasksTabControlsAnim,
                          transform: [
                            {
                              translateX: tasksTabControlsAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [-8, 0],
                                }),
                            },
                          ],
                        }}
                      >
                        <View className="pl-1 pr-2 py-1.5 flex-row items-center gap-2">
                          {!taskProjectsLoaded ? (
                            <>
                              <Text className="text-[#8b8b8b] text-[12px]">...</Text>
                            </>
                          ) : (
                            <>
                              <Pressable
                                className="h-6 flex-row items-center gap-1 bg-transparent border-0 rounded-none"
                                style={topBarPressableStyle}
                                onPress={() => setTaskProjectMenuOpen((current) => !current)}
                              >
                                <Text className="text-[#a3a3a3] text-[12px] max-w-[140px]" numberOfLines={1}>
                                  {selectedTaskProjectLabel}
                                </Text>
                                <Text
                                  className="text-[#b7b7b7] text-[11px]"
                                  style={{ transform: [{ rotate: taskProjectMenuOpen ? "180deg" : "0deg" }] }}
                                >
                                  ▾
                                </Text>
                              </Pressable>
                            </>
                          )}
                        </View>
                      </Animated.View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              className="h-10 w-10 items-center justify-center bg-transparent border-0 rounded-none"
              style={topBarPressableStyle}
              onPress={() => {
                const currentPanels = featurePanels[currentFeature];
                if (!currentPanels.left) {
                  setPanelsForFeature(currentFeature, true, currentPanels.right);
                }
                if (isNotesRoute) {
                  dispatchNotesFocusSearch();
                  return;
                }
                if (isTasksRoute) dispatchTasksFocusSearch();
              }}
            >
              <Feather name="search" size={14} color="#9a9a9a" />
            </Pressable>

            <Pressable
              className="h-10 w-10 items-center justify-center bg-transparent border-0 rounded-none"
              style={topBarPressableStyle}
              onPress={() => {
                if (typeof window !== "undefined") window.alert("AI tools panel is next in queue.");
              }}
            >
              <Image source={require("../../../assets/brightness_1.svg")} className="w-[28px] h-[28px]" contentFit="contain" />
            </Pressable>

            <NotificationCenter />

            <Pressable
              className="h-10 w-10 rounded-full border border-[#2f2f2f] items-center justify-center bg-transparent"
              onPress={() => setProfileMenuOpen((current) => !current)}
            >
              <Text className="text-[#ededed] text-[14px] font-semibold">{profileInitial}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {profileMenuOpen ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setProfileMenuOpen(false)}>
          <Pressable className="flex-1" onPress={() => setProfileMenuOpen(false)} />
          <View className="absolute top-16 right-5 bg-[#181818] rounded-xl py-1 min-w-[190px] z-[999]">
            <Pressable
              className="px-4 py-3"
              onPress={() => {
                setProfileMenuOpen(false);
                setWorkspaceSettingsOpen(true);
              }}
            >
              <Text className="text-[#e6e6e6]">Settings</Text>
            </Pressable>
            <Pressable
              className="px-4 py-3"
              onPress={async () => {
                setProfileMenuOpen(false);
                try {
                  await signOut();
                } finally {
                  router.replace("/(auth)");
                }
              }}
            >
              <Text className="text-[#ffb0b0]">Logout</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}

      {dashboardViewMenuOpen ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setDashboardViewMenuOpen(false)}>
          <Pressable className="flex-1" onPress={() => setDashboardViewMenuOpen(false)} />
          <View className="absolute top-16 left-[360px] w-[280px] rounded-xl bg-[#171717] p-2 z-[999]">
            <View className="flex-row items-center justify-between px-2 pb-2 pt-1 border-b border-[#262626] mb-2">
              <Text className="text-[#a0a0a0] text-xs">Dashboard Views</Text>
              <Pressable className="h-5 w-5 items-center justify-center" onPress={addDashboardView}>
                <Text className="text-[#d8d8d8] text-[14px]">+</Text>
              </Pressable>
            </View>
            {dashboardViews.length === 0 ? (
              <Text className="text-[#878787] text-[12px] px-2 pb-2">No views yet.</Text>
            ) : (
              dashboardViews.map((view) => {
                const dashboardViewActive = view.id === activeDashboardViewId;
                const showActions = hoveredDashboardViewId === view.id || dashboardViewActive;
                return (
                  <Pressable
                    key={view.id}
                    className={`rounded-lg px-3 py-2 flex-row items-center justify-between ${
                      dashboardViewActive ? "bg-[#2f2f2f]" : "bg-transparent"
                    }`}
                    onPress={() => {
                      setActiveDashboardView(view.id);
                      setDashboardViewMenuOpen(false);
                    }}
                    onHoverIn={() => setHoveredDashboardViewId(view.id)}
                    onHoverOut={() => setHoveredDashboardViewId((current) => (current === view.id ? null : current))}
                  >
                    <Text
                      className={`${dashboardViewActive ? "text-[#f1f1f1]" : "text-[#cfcfcf]"} text-[13px] flex-1 pr-2`}
                      numberOfLines={1}
                    >
                      {view.name}
                    </Text>
                    <View className={`w-[44px] flex-row items-center justify-end gap-1 ${showActions ? "opacity-100" : "opacity-0"}`}>
                      <Pressable
                        className="h-4 w-4 items-center justify-center"
                        disabled={!showActions}
                        onPress={() => renameDashboardView(view.id)}
                      >
                        <Text className="text-[#bdbdbd] text-[11px]">✎</Text>
                      </Pressable>
                      <Pressable
                        className="w-4 h-4 items-center justify-center"
                        disabled={dashboardViews.length <= 1 || !showActions}
                        onPress={() => removeDashboardView(view.id)}
                      >
                        <Text className={`${dashboardViews.length > 1 ? "text-[#c8c8c8]" : "text-[#6c6c6c]"} text-[11px]`}>×</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </Modal>
      ) : null}

      {taskProjectMenuOpen ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setTaskProjectMenuOpen(false)}>
          <Pressable className="flex-1" onPress={() => setTaskProjectMenuOpen(false)} />
          <View className="absolute top-16 left-[640px] w-[280px] rounded-xl bg-[#171717] p-2 z-[999]">
            <View className="flex-row items-center justify-between px-2 pb-2 pt-1 border-b border-[#262626] mb-2">
              <Text className="text-[#a0a0a0] text-xs">Projects</Text>
              <Pressable className="h-5 w-5 items-center justify-center" onPress={addTaskProject}>
                <Text className="text-[#d8d8d8] text-[14px]">+</Text>
              </Pressable>
            </View>
            <Pressable
              className={`rounded-lg px-3 py-2 flex-row items-center justify-between ${
                selectedTaskProjectId === null ? "bg-[#2f2f2f]" : "bg-transparent"
              }`}
              onPress={() => {
                setActiveTaskProject(null);
                setTaskProjectMenuOpen(false);
              }}
            >
              <Text
                className={`${selectedTaskProjectId === null ? "text-[#f1f1f1]" : "text-[#cfcfcf]"} text-[13px] flex-1 pr-2`}
                numberOfLines={1}
              >
                All projects
              </Text>
            </Pressable>
            {taskProjects.length === 0 ? (
              <Text className="text-[#878787] text-[12px] px-2 pb-2">No projects yet.</Text>
            ) : (
              taskProjects.map((project) => {
                const projectActive = project.id === selectedTaskProjectId;
                const showActions = hoveredTaskProjectId === project.id || projectActive;
                return (
                  <Pressable
                    key={project.id}
                    className={`rounded-lg px-3 py-2 flex-row items-center justify-between ${
                      projectActive ? "bg-[#2f2f2f]" : "bg-transparent"
                    }`}
                    onPress={() => {
                      setActiveTaskProject(project.id);
                      setTaskProjectMenuOpen(false);
                    }}
                    onHoverIn={() => setHoveredTaskProjectId(project.id)}
                    onHoverOut={() => setHoveredTaskProjectId((current) => (current === project.id ? null : current))}
                  >
                    <Text
                      className={`${projectActive ? "text-[#f1f1f1]" : "text-[#cfcfcf]"} text-[13px] flex-1 pr-2`}
                      numberOfLines={1}
                    >
                      {project.name}
                    </Text>
                    <View className={`w-[44px] flex-row items-center justify-end gap-1 ${showActions ? "opacity-100" : "opacity-0"}`}>
                      <Pressable
                        className="h-4 w-4 items-center justify-center"
                        disabled={!showActions}
                        onPress={() => renameTaskProject(project.id)}
                      >
                        <Text className="text-[#bdbdbd] text-[11px]">✎</Text>
                      </Pressable>
                      <Pressable
                        className="w-4 h-4 items-center justify-center"
                        disabled={!showActions}
                        onPress={() => removeTaskProject(project.id)}
                      >
                        <Text className="text-[#c8c8c8] text-[11px]">×</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </Modal>
      ) : null}

      {noModuleAccess ? (
        <View className="px-8 pt-2">
          <View className="rounded-lg bg-[#1a1a1a] px-3 py-2">
            <Text className="text-[#cfcfcf] text-[13px]">
              You currently have no Notes/Tasks module access in this workspace. Ask an owner/admin to grant permissions.
            </Text>
          </View>
        </View>
      ) : null}

      <View className="flex-1">
        <Slot />
      </View>

      <WorkspaceSettingsModal visible={workspaceSettingsOpen} onClose={() => setWorkspaceSettingsOpen(false)} />

      <View className="items-center pb-5 bg-[#0C0C0C]">
        {isNotesRoute && notesCreateMenuOpen && canEditNotes ? (
          <View className="absolute bottom-[72px] rounded-2xl bg-[#171717] px-2 py-2 min-w-[320px]">
            {notesCreateActions.map((entry) => (
              <Pressable
                key={entry.kind}
                className="flex-row items-center justify-between px-3 py-3 rounded-lg"
                onPress={() => {
                  dispatchNotesCreateKind(entry.kind);
                  setNotesCreateMenuOpen(false);
                }}
              >
                <View className="flex-row items-center gap-3">
                  <Text className="text-[#f08f42] text-base">{entry.icon}</Text>
                  <Text className="text-[#d8d8d8] text-[18px]">{entry.label}</Text>
                </View>
                <Text className="text-[#a8a8a8] text-2xl">+</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {isTasksRoute && tasksCreateMenuOpen && canEditTasks ? (
          <View className="absolute bottom-[72px] rounded-2xl bg-[#171717] px-2 py-2 min-w-[320px]">
            {tasksCreateActions.map((entry) => (
              <Pressable
                key={entry.entity}
                className="flex-row items-center justify-between px-3 py-3 rounded-lg"
                onPress={() => {
                  dispatchTasksCreateEntity(entry.entity);
                  setTasksCreateMenuOpen(false);
                }}
              >
                <View className="flex-row items-center gap-3">
                  <Text className="text-[#f08f42] text-base">{entry.icon}</Text>
                  <Text className="text-[#d8d8d8] text-[18px]">{entry.label}</Text>
                </View>
                <Text className="text-[#a8a8a8] text-2xl">+</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View className="w-full flex-row items-center justify-between px-4 py-2">
          <Pressable
            className="w-10 h-10 items-center justify-center"
            disabled={!supportsLeftPanelToggle}
            onPress={() => {
              const next = featurePanels[currentFeature];
              setPanelsForFeature(currentFeature, !next.left, next.right);
            }}
          >
            <Text className={`text-2xl ${supportsLeftPanelToggle ? "text-[#9a9a9a]" : "text-[#4b4b4b]"}`}>«</Text>
          </Pressable>

          <View />

          <Pressable
            className="w-10 h-10 items-center justify-center"
            disabled={!supportsRightPanelToggle}
            onPress={() => {
              const next = featurePanels[currentFeature];
              setPanelsForFeature(currentFeature, next.left, !next.right);
            }}
          >
            <Text className={`text-2xl ${supportsRightPanelToggle ? "text-[#9a9a9a]" : "text-[#4b4b4b]"}`}>»</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
