import { Modal, Pressable, Text, TextInput, View } from "../../tw";
import { Icon } from "../ui/icon";
import type { BrainstormOption } from "../../features/brainstorm/storage/brainstorm-storage";
import type { GridSceneOption } from "../../features/dashboard/storage/dashboard-view-storage";
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
  grid: {
    open: boolean;
    anchor: MenuAnchor | null;
    scenes: GridSceneOption[];
    activeSceneId: string;
    isCreating: boolean;
    newName: string;
    deleteCandidateId: string | null;
    deleteInput: string;
    deleteSubmittingId: string | null;
    closeMenu: () => void;
    setActiveScene: (sceneId: string) => void;
    setIsCreating: (value: boolean) => void;
    setNewName: (value: string) => void;
    submitCreate: () => void;
    removeScene: (sceneId: string) => void;
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

export function AppChromeMenus({ grid, tasks, mindmap, brainstorm }: Props) {
  return (
    <>
      {grid.open && grid.anchor ? (
        <Modal transparent visible={grid.open} animationType="fade" onRequestClose={grid.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={grid.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl bg-[#171717] p-2" style={{ left: grid.anchor.left, top: grid.anchor.top }}>
            <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-[#a0a0a0] text-xs">All scenes</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    grid.setIsCreating(true);
                    grid.setNewName("New Scene");
                  }}
                >
                  <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {grid.isCreating ? (
                <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                  <TextInput
                    autoFocus
                    value={grid.newName}
                    onChangeText={grid.setNewName}
                    onKeyDown={(event: any) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        grid.submitCreate();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        grid.setIsCreating(false);
                      }
                    }}
                    className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={grid.submitCreate}>
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-[#2b2b2b]"
                      style={iconButtonStyle}
                      onPress={() => {
                        grid.setIsCreating(false);
                        grid.setNewName("New Scene");
                      }}
                    >
                      <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {grid.scenes.map((scene) => {
                const isActiveScene = scene.id === grid.activeSceneId;
                const isDeleteOpen = grid.deleteCandidateId === scene.id;
                const deleteMatches = grid.deleteInput.trim() === scene.name.trim();
                return (
                  <View key={scene.id} className={`rounded-lg px-3 py-2 ${isActiveScene ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}>
                    <Pressable
                      onPress={() => {
                        grid.setActiveScene(scene.id);
                        grid.closeMenu();
                      }}
                    >
                      <View style={itemRowStyle}>
                        <View style={itemNameWrapStyle}>
                          <Text
                            as="div"
                            className={`${isActiveScene ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {scene.name}
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
                                grid.setDeleteCandidateId(null);
                                grid.setDeleteInput("");
                                grid.setDeleteSubmittingId(null);
                              } else {
                                grid.setDeleteCandidateId(scene.id);
                                grid.setDeleteInput("");
                              }
                            }}
                            disabled={grid.scenes.length <= 1}
                          >
                            <Icon name="trash-2" size={13} color={grid.scenes.length > 1 ? "#ffb0b0" : "#6a6a6a"} />
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
                        Retype <Text className="font-semibold text-[#d9d9d9]">{scene.name}</Text> to delete this scene.
                      </Text>
                      <View className="mt-2" style={rowStyle}>
                        <TextInput
                          value={grid.deleteInput}
                          onChangeText={grid.setDeleteInput}
                          onKeyDown={(event: any) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              grid.setDeleteCandidateId(null);
                              grid.setDeleteInput("");
                              grid.setDeleteSubmittingId(null);
                            }
                            if (event.key === "Enter" && deleteMatches && grid.deleteSubmittingId !== scene.id) {
                              event.preventDefault();
                              grid.removeScene(scene.id);
                            }
                          }}
                          placeholder={scene.name}
                          className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                        />
                        <Pressable
                          className="ml-1 rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={() => {
                            grid.setDeleteCandidateId(null);
                            grid.setDeleteInput("");
                            grid.setDeleteSubmittingId(null);
                          }}
                        >
                          <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => grid.removeScene(scene.id)}
                          aria-disabled={!deleteMatches || grid.deleteSubmittingId === scene.id}
                        >
                          <Text
                            className={`text-[11px] font-semibold leading-none ${
                              deleteMatches && grid.deleteSubmittingId !== scene.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
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
