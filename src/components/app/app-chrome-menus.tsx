import { Modal, Pressable, Text, TextInput, View } from "../../tw";
import { Icon } from "../ui/icon";
import type { BrainstormOption } from "../../features/brainstorm/storage/brainstorm-storage";
import type { DashboardViewOption } from "../../features/dashboard/storage/dashboard-view-storage";
import type { MindmapOption } from "../../features/mindmap/ui/mindmap-storage";
import type { MenuAnchor, TaskProjectOption } from "./app-chrome-types";
import {
  deleteRevealBaseStyle,
  iconButtonStyle,
  itemActionsStyle,
  itemNameWrapStyle,
  itemRowStyle,
  plusButtonStyle,
  rowStyle,
} from "./app-chrome-constants";

type Props = {
  dashboard: {
    open: boolean;
    anchor: MenuAnchor | null;
    views: DashboardViewOption[];
    activeViewId: string;
    isCreating: boolean;
    newName: string;
    deleteCandidateId: string | null;
    deleteInput: string;
    deleteSubmittingId: string | null;
    closeMenu: () => void;
    setActiveView: (viewId: string) => void;
    setIsCreating: (value: boolean) => void;
    setNewName: (value: string) => void;
    submitCreate: () => void;
    removeView: (viewId: string) => void;
    setDeleteCandidateId: (value: string | null) => void;
    setDeleteInput: (value: string) => void;
    setDeleteSubmittingId: (value: string | null) => void;
  };
  tasks: {
    open: boolean;
    anchor: MenuAnchor | null;
    canEditTasks: boolean;
    projects: TaskProjectOption[];
    selectedProjectId: string | null;
    isCreating: boolean;
    newName: string;
    deleteCandidateId: string | null;
    deleteInput: string;
    deleteSubmittingId: string | null;
    closeMenu: () => void;
    setSelectedProjectId: (projectId: string | null) => void;
    setIsCreating: (value: boolean) => void;
    setNewName: (value: string) => void;
    submitCreate: () => Promise<void>;
    removeProject: (projectId: string) => Promise<void>;
    cancelDeleteIntent: () => void;
    setDeleteCandidateId: (value: string | null) => void;
    setDeleteInput: (value: string) => void;
  };
  mindmap: {
    open: boolean;
    anchor: MenuAnchor | null;
    mindmaps: MindmapOption[];
    selectedMindmapId: string | null;
    selectedWorkspaceId: string | null;
    isCreating: boolean;
    newName: string;
    deleteCandidateId: string | null;
    deleteInput: string;
    deleteSubmittingId: string | null;
    closeMenu: () => void;
    setSelectedMindmapId: (mindmapId: string | null) => void;
    setIsCreating: (value: boolean) => void;
    setNewName: (value: string) => void;
    submitCreate: () => Promise<void>;
    removeMindmap: (mindmapId: string) => Promise<void>;
    cancelDeleteIntent: () => void;
    setDeleteCandidateId: (value: string | null) => void;
    setDeleteInput: (value: string) => void;
    writeStoredActiveMindmap: (workspaceId: string | null, mindmapId: string | null) => void;
    dispatchMindmapSelectMap: (mindmapId: string | null, name?: string) => void;
  };
  brainstorm: {
    open: boolean;
    anchor: MenuAnchor | null;
    brainstorms: BrainstormOption[];
    selectedBrainstormId: string | null;
    selectedWorkspaceId: string | null;
    isCreating: boolean;
    newName: string;
    deleteCandidateId: string | null;
    deleteInput: string;
    deleteSubmittingId: string | null;
    closeMenu: () => void;
    setSelectedBrainstormId: (brainstormId: string | null) => void;
    setIsCreating: (value: boolean) => void;
    setNewName: (value: string) => void;
    submitCreate: () => Promise<void>;
    removeBrainstorm: (brainstormId: string) => Promise<void>;
    cancelDeleteIntent: () => void;
    setDeleteCandidateId: (value: string | null) => void;
    setDeleteInput: (value: string) => void;
    writeStoredActiveBrainstorm: (workspaceId: string | null, brainstormId: string | null) => void;
    dispatchBrainstormSelectView: (brainstormId: string | null, name?: string) => void;
  };
};

export function AppChromeMenus({ dashboard, tasks, mindmap, brainstorm }: Props) {
  return (
    <>
      {dashboard.open && dashboard.anchor ? (
        <Modal transparent visible={dashboard.open} animationType="fade" onRequestClose={dashboard.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={dashboard.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: dashboard.anchor.left, top: dashboard.anchor.top }}>
            <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-[#a0a0a0] text-xs">All views</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    dashboard.setIsCreating(true);
                    dashboard.setNewName("New Dashboard View");
                  }}
                >
                  <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {dashboard.isCreating ? (
                <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                  <TextInput
                    autoFocus
                    value={dashboard.newName}
                    onChangeText={dashboard.setNewName}
                    onKeyDown={(event: any) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        dashboard.submitCreate();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        dashboard.setIsCreating(false);
                      }
                    }}
                    className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={dashboard.submitCreate}>
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-[#2b2b2b]"
                      style={iconButtonStyle}
                      onPress={() => {
                        dashboard.setIsCreating(false);
                        dashboard.setNewName("New Dashboard View");
                      }}
                    >
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {dashboard.views.map((view) => {
                const isActiveView = view.id === dashboard.activeViewId;
                const isDeleteOpen = dashboard.deleteCandidateId === view.id;
                const deleteMatches = dashboard.deleteInput.trim() === view.name.trim();
                return (
                  <View key={view.id} className={`rounded-lg px-3 py-2 ${isActiveView ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                    <Pressable
                      onPress={() => {
                        dashboard.setActiveView(view.id);
                        dashboard.closeMenu();
                      }}
                    >
                      <View style={itemRowStyle}>
                        <View style={itemNameWrapStyle}>
                          <Text
                            as="div"
                            className={`${isActiveView ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {view.name}
                          </Text>
                        </View>
                        <View className="shrink-0" style={itemActionsStyle}>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                            }}
                          >
                            <Icon name="settings" size={13} color="#d8d8d8" />
                          </Pressable>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                              if (isDeleteOpen) {
                                dashboard.setDeleteCandidateId(null);
                                dashboard.setDeleteInput("");
                                dashboard.setDeleteSubmittingId(null);
                              } else {
                                dashboard.setDeleteCandidateId(view.id);
                                dashboard.setDeleteInput("");
                              }
                            }}
                            disabled={dashboard.views.length <= 1}
                          >
                            <Icon name="trash-2" size={13} color={dashboard.views.length > 1 ? "#ffb0b0" : "#6a6a6a"} />
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>

                    <View
                      style={{
                        ...deleteRevealBaseStyle,
                        maxHeight: isDeleteOpen ? 116 : 0,
                        opacity: isDeleteOpen ? 1 : 0,
                        transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                        marginTop: isDeleteOpen ? 8 : 0,
                      }}
                    >
                      <Text className="text-[11px] text-[#9a9a9a]">
                        Retype <Text className="font-semibold text-[#d9d9d9]">{view.name}</Text> to delete this view.
                      </Text>
                      <View className="mt-2" style={rowStyle}>
                        <TextInput
                          value={dashboard.deleteInput}
                          onChangeText={dashboard.setDeleteInput}
                          onKeyDown={(event: any) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              dashboard.setDeleteCandidateId(null);
                              dashboard.setDeleteInput("");
                              dashboard.setDeleteSubmittingId(null);
                            }
                            if (event.key === "Enter" && deleteMatches && dashboard.deleteSubmittingId !== view.id) {
                              event.preventDefault();
                              dashboard.removeView(view.id);
                            }
                          }}
                          placeholder={view.name}
                          className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                        />
                        <Pressable
                          className="ml-1 rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={() => {
                            dashboard.setDeleteCandidateId(null);
                            dashboard.setDeleteInput("");
                            dashboard.setDeleteSubmittingId(null);
                          }}
                        >
                          <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => dashboard.removeView(view.id)}
                          aria-disabled={!deleteMatches || dashboard.deleteSubmittingId === view.id}
                        >
                          <Text
                            className={`text-[11px] font-semibold leading-none ${
                              deleteMatches && dashboard.deleteSubmittingId !== view.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                            }`}
                          >
                            Del
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </Modal>
      ) : null}

      {tasks.open && tasks.anchor ? (
        <Modal transparent visible={tasks.open} animationType="fade" onRequestClose={tasks.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={tasks.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: tasks.anchor.left, top: tasks.anchor.top }}>
            <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-[#a0a0a0] text-xs">All projects</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    if (!tasks.canEditTasks) return;
                    tasks.setIsCreating(true);
                    tasks.setNewName("New Project");
                  }}
                  disabled={!tasks.canEditTasks}
                >
                  <Text className={`text-[16px] leading-none ${tasks.canEditTasks ? "text-[#d8d8d8]" : "text-[#6a6a6a]"}`}>+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {tasks.isCreating && tasks.canEditTasks ? (
                <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                  <TextInput
                    autoFocus
                    value={tasks.newName}
                    onChangeText={tasks.setNewName}
                    onKeyDown={(event: any) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void tasks.submitCreate();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        tasks.setIsCreating(false);
                      }
                    }}
                    className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void tasks.submitCreate()}>
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-[#2b2b2b]"
                      style={iconButtonStyle}
                      onPress={() => {
                        tasks.setIsCreating(false);
                        tasks.setNewName("New Project");
                      }}
                    >
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View className={`rounded-lg px-3 py-2 ${tasks.selectedProjectId === null ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                <Pressable
                  onPress={() => {
                    tasks.setSelectedProjectId(null);
                    tasks.closeMenu();
                  }}
                >
                  <View style={itemRowStyle}>
                    <View style={itemNameWrapStyle}>
                      <Text
                        as="div"
                        className={`${tasks.selectedProjectId === null ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                        style={{ lineHeight: "28px" }}
                        numberOfLines={1}
                      >
                        All projects
                      </Text>
                    </View>
                  </View>
                </Pressable>
              </View>

              {tasks.projects.map((project) => {
                const isActiveProject = tasks.selectedProjectId === project.id;
                const isDeleteOpen = tasks.deleteCandidateId === project.id;
                const deleteMatches = tasks.deleteInput.trim() === project.name.trim();
                return (
                  <View key={project.id} className={`rounded-lg px-3 py-2 ${isActiveProject ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                    <Pressable
                      onPress={() => {
                        tasks.setSelectedProjectId(project.id);
                        tasks.closeMenu();
                      }}
                    >
                      <View style={itemRowStyle}>
                        <View style={itemNameWrapStyle}>
                          <Text
                            as="div"
                            className={`${isActiveProject ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {project.name}
                          </Text>
                        </View>
                        <View className="shrink-0" style={itemActionsStyle}>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                            }}
                            disabled={!tasks.canEditTasks}
                          >
                            <Icon name="settings" size={13} color={tasks.canEditTasks ? "#d8d8d8" : "#6a6a6a"} />
                          </Pressable>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                              if (isDeleteOpen) {
                                tasks.cancelDeleteIntent();
                              } else {
                                tasks.setDeleteCandidateId(project.id);
                                tasks.setDeleteInput("");
                              }
                            }}
                            disabled={!tasks.canEditTasks}
                          >
                            <Icon name="trash-2" size={13} color={tasks.canEditTasks ? "#ffb0b0" : "#6a6a6a"} />
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>

                    <View
                      style={{
                        ...deleteRevealBaseStyle,
                        maxHeight: isDeleteOpen ? 116 : 0,
                        opacity: isDeleteOpen ? 1 : 0,
                        transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                        marginTop: isDeleteOpen ? 8 : 0,
                      }}
                    >
                      <Text className="text-[11px] text-[#9a9a9a]">
                        Retype <Text className="font-semibold text-[#d9d9d9]">{project.name}</Text> to delete this project.
                      </Text>
                      <View className="mt-2" style={rowStyle}>
                        <TextInput
                          value={tasks.deleteInput}
                          onChangeText={tasks.setDeleteInput}
                          onKeyDown={(event: any) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              tasks.cancelDeleteIntent();
                            }
                            if (event.key === "Enter" && deleteMatches && tasks.deleteSubmittingId !== project.id) {
                              event.preventDefault();
                              void tasks.removeProject(project.id);
                            }
                          }}
                          placeholder={project.name}
                          className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                        />
                        <Pressable className="ml-1 rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={tasks.cancelDeleteIntent}>
                          <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => void tasks.removeProject(project.id)}
                          aria-disabled={!deleteMatches || tasks.deleteSubmittingId === project.id}
                        >
                          <Text
                            className={`text-[11px] font-semibold leading-none ${
                              deleteMatches && tasks.deleteSubmittingId !== project.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                            }`}
                          >
                            Del
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </Modal>
      ) : null}

      {mindmap.open && mindmap.anchor ? (
        <Modal transparent visible={mindmap.open} animationType="fade" onRequestClose={mindmap.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={mindmap.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: mindmap.anchor.left, top: mindmap.anchor.top }}>
            <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-[#a0a0a0] text-xs">All mindmaps</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    mindmap.setIsCreating(true);
                    mindmap.setNewName("New Mindmap");
                  }}
                >
                  <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {mindmap.isCreating ? (
                <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                  <TextInput
                    autoFocus
                    value={mindmap.newName}
                    onChangeText={mindmap.setNewName}
                    onKeyDown={(event: any) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void mindmap.submitCreate();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        mindmap.setIsCreating(false);
                      }
                    }}
                    className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void mindmap.submitCreate()}>
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-[#2b2b2b]"
                      style={iconButtonStyle}
                      onPress={() => {
                        mindmap.setIsCreating(false);
                        mindmap.setNewName("New Mindmap");
                      }}
                    >
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {mindmap.mindmaps.length === 0 ? (
                <View className="px-3 py-2">
                  <Text className="text-[13px] text-[#8f8f8f]">No mindmaps yet.</Text>
                </View>
              ) : null}

              {mindmap.mindmaps.map((map) => {
                const isActiveMindmap = mindmap.selectedMindmapId === map.id;
                const isDeleteOpen = mindmap.deleteCandidateId === map.id;
                const deleteMatches = mindmap.deleteInput.trim() === map.name.trim();
                return (
                  <View key={map.id} className={`rounded-lg px-3 py-2 ${isActiveMindmap ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                    <Pressable
                      onPress={() => {
                        mindmap.setSelectedMindmapId(map.id);
                        mindmap.writeStoredActiveMindmap(mindmap.selectedWorkspaceId, map.id);
                        mindmap.dispatchMindmapSelectMap(map.id, map.name);
                        mindmap.closeMenu();
                      }}
                    >
                      <View style={itemRowStyle}>
                        <View style={itemNameWrapStyle}>
                          <Text
                            as="div"
                            className={`${isActiveMindmap ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {map.name}
                          </Text>
                        </View>
                        <View className="shrink-0" style={itemActionsStyle}>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                            }}
                          >
                            <Icon name="settings" size={13} color="#d8d8d8" />
                          </Pressable>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                              if (isDeleteOpen) {
                                mindmap.cancelDeleteIntent();
                              } else {
                                mindmap.setDeleteCandidateId(map.id);
                                mindmap.setDeleteInput("");
                              }
                            }}
                          >
                            <Icon name="trash-2" size={13} color="#ffb0b0" />
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>

                    <View
                      style={{
                        ...deleteRevealBaseStyle,
                        maxHeight: isDeleteOpen ? 116 : 0,
                        opacity: isDeleteOpen ? 1 : 0,
                        transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                        marginTop: isDeleteOpen ? 8 : 0,
                      }}
                    >
                      <Text className="text-[11px] text-[#9a9a9a]">
                        Retype <Text className="font-semibold text-[#d9d9d9]">{map.name}</Text> to delete this mindmap.
                      </Text>
                      <View className="mt-2" style={rowStyle}>
                        <TextInput
                          value={mindmap.deleteInput}
                          onChangeText={mindmap.setDeleteInput}
                          onKeyDown={(event: any) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              mindmap.cancelDeleteIntent();
                            }
                            if (event.key === "Enter" && deleteMatches && mindmap.deleteSubmittingId !== map.id) {
                              event.preventDefault();
                              void mindmap.removeMindmap(map.id);
                            }
                          }}
                          placeholder={map.name}
                          className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                        />
                        <Pressable className="ml-1 rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={mindmap.cancelDeleteIntent}>
                          <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => void mindmap.removeMindmap(map.id)}
                          aria-disabled={!deleteMatches || mindmap.deleteSubmittingId === map.id}
                        >
                          <Text
                            className={`text-[11px] font-semibold leading-none ${
                              deleteMatches && mindmap.deleteSubmittingId !== map.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                            }`}
                          >
                            Del
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </Modal>
      ) : null}

      {brainstorm.open && brainstorm.anchor ? (
        <Modal transparent visible={brainstorm.open} animationType="fade" onRequestClose={brainstorm.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={brainstorm.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: brainstorm.anchor.left, top: brainstorm.anchor.top }}>
            <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-[#a0a0a0] text-xs">All sessions</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    brainstorm.setIsCreating(true);
                    brainstorm.setNewName("New Brainstorm");
                  }}
                >
                  <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {brainstorm.isCreating ? (
                <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                  <TextInput
                    autoFocus
                    value={brainstorm.newName}
                    onChangeText={brainstorm.setNewName}
                    onKeyDown={(event: any) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void brainstorm.submitCreate();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        brainstorm.setIsCreating(false);
                      }
                    }}
                    className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void brainstorm.submitCreate()}>
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-[#2b2b2b]"
                      style={iconButtonStyle}
                      onPress={() => {
                        brainstorm.setIsCreating(false);
                        brainstorm.setNewName("New Brainstorm");
                      }}
                    >
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {brainstorm.brainstorms.length === 0 ? (
                <View className="px-3 py-2">
                  <Text className="text-[13px] text-[#8f8f8f]">No brainstorm sessions yet.</Text>
                </View>
              ) : null}

              {brainstorm.brainstorms.map((bs) => {
                const isActive = brainstorm.selectedBrainstormId === bs.id;
                const isDeleteOpen = brainstorm.deleteCandidateId === bs.id;
                const deleteMatches = brainstorm.deleteInput.trim() === bs.name.trim();
                return (
                  <View key={bs.id} className={`rounded-lg px-3 py-2 ${isActive ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                    <Pressable
                      onPress={() => {
                        brainstorm.setSelectedBrainstormId(bs.id);
                        brainstorm.writeStoredActiveBrainstorm(brainstorm.selectedWorkspaceId, bs.id);
                        brainstorm.dispatchBrainstormSelectView(bs.id, bs.name);
                        brainstorm.closeMenu();
                      }}
                    >
                      <View style={itemRowStyle}>
                        <View style={itemNameWrapStyle}>
                          <Text
                            as="div"
                            className={`${isActive ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {bs.name}
                          </Text>
                        </View>
                        <View className="shrink-0" style={itemActionsStyle}>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                            }}
                          >
                            <Icon name="settings" size={13} color="#d8d8d8" />
                          </Pressable>
                          <Pressable
                            className="rounded-md hover:bg-[#2b2b2b]"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                              if (isDeleteOpen) {
                                brainstorm.cancelDeleteIntent();
                              } else {
                                brainstorm.setDeleteCandidateId(bs.id);
                                brainstorm.setDeleteInput("");
                              }
                            }}
                          >
                            <Icon name="trash-2" size={13} color="#ffb0b0" />
                          </Pressable>
                        </View>
                      </View>
                    </Pressable>

                    <View
                      style={{
                        ...deleteRevealBaseStyle,
                        maxHeight: isDeleteOpen ? 116 : 0,
                        opacity: isDeleteOpen ? 1 : 0,
                        transform: isDeleteOpen ? "translateY(0)" : "translateY(-4px)",
                        marginTop: isDeleteOpen ? 8 : 0,
                      }}
                    >
                      <Text className="text-[11px] text-[#9a9a9a]">
                        Retype <Text className="font-semibold text-[#d9d9d9]">{bs.name}</Text> to delete this session.
                      </Text>
                      <View className="mt-2" style={rowStyle}>
                        <TextInput
                          value={brainstorm.deleteInput}
                          onChangeText={brainstorm.setDeleteInput}
                          onKeyDown={(event: any) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              brainstorm.cancelDeleteIntent();
                            }
                            if (event.key === "Enter" && deleteMatches && brainstorm.deleteSubmittingId !== bs.id) {
                              event.preventDefault();
                              void brainstorm.removeBrainstorm(bs.id);
                            }
                          }}
                          placeholder={bs.name}
                          className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                        />
                        <Pressable className="ml-1 rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={brainstorm.cancelDeleteIntent}>
                          <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => void brainstorm.removeBrainstorm(bs.id)}
                          aria-disabled={!deleteMatches || brainstorm.deleteSubmittingId === bs.id}
                        >
                          <Text
                            className={`text-[11px] font-semibold leading-none ${
                              deleteMatches && brainstorm.deleteSubmittingId !== bs.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
                            }`}
                          >
                            Del
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
