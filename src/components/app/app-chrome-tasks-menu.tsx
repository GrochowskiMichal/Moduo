import { Modal, Pressable, Text, TextInput, View } from "../../tw";
import { Icon } from "../ui/icon";
import type { AppChromeMenusProps } from "./app-chrome-menu-types";
import {
  deleteRevealBaseStyle,
  iconButtonStyle,
  itemActionsStyle,
  itemNameWrapStyle,
  itemRowStyle,
  plusButtonStyle,
  rowStyle,
} from "./app-chrome-constants";

type TasksProjectMenuProps = {
  tasks: AppChromeMenusProps["tasks"];
};

export function TasksProjectMenu({ tasks }: TasksProjectMenuProps) {
  return tasks.open && tasks.anchor ? (
        <Modal transparent visible={tasks.open} animationType="fade" onRequestClose={tasks.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={tasks.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl border border-border bg-popover p-1 text-popover-foreground" style={{ left: tasks.anchor.left, top: tasks.anchor.top }}>
            <View className="mb-2 border-b border-border px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-muted-foreground text-xs uppercase tracking-wide">All projects</Text>
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
                  <Text className={`text-base leading-none ${tasks.canEditTasks ? "text-foreground" : "text-muted-foreground/50"}`}>+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {tasks.isCreating && tasks.canEditTasks ? (
                <View className="mb-2 rounded-md border border-border bg-muted px-2 py-2" style={rowStyle}>
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
                    className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-accent" style={iconButtonStyle} onPress={() => void tasks.submitCreate()}>
                      <Text className="text-sm leading-none text-foreground">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-accent"
                      style={iconButtonStyle}
                      onPress={() => {
                        tasks.setIsCreating(false);
                        tasks.setNewName("New Project");
                      }}
                    >
                      <Text className="text-sm leading-none text-foreground">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View className={`rounded-md px-3 py-2 ${tasks.selectedProjectId === null ? "bg-accent text-accent-foreground" : "bg-transparent hover:bg-accent"}`}>
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
                        className={`${tasks.selectedProjectId === null ? "text-foreground" : "text-popover-foreground"} text-sm`}
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
                  <View key={project.id} className={`rounded-md px-3 py-2 ${isActiveProject ? "bg-accent text-accent-foreground" : "bg-transparent hover:bg-accent"}`}>
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
                            className={`${isActiveProject ? "text-foreground" : "text-popover-foreground"} text-sm`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {project.name}
                          </Text>
                        </View>
                        <View className="shrink-0" style={itemActionsStyle}>
                          <Pressable
                            className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                            }}
                            disabled={!tasks.canEditTasks}
                          >
                            <Icon name="settings" size={13} className={tasks.canEditTasks ? undefined : "text-muted-foreground/50"} />
                          </Pressable>
                          <Pressable
                            className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
                            <Icon name="trash-2" size={13} className={tasks.canEditTasks ? "text-destructive" : "text-muted-foreground/50"} />
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
                      <Text className="text-xs text-muted-foreground">
                        Retype <Text className="font-semibold text-foreground">{project.name}</Text> to delete this project.
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
                          className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                        />
                        <Pressable className="ml-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" style={iconButtonStyle} onPress={tasks.cancelDeleteIntent}>
                          <Text className="text-xs leading-none text-foreground">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => void tasks.removeProject(project.id)}
                          aria-disabled={!deleteMatches || tasks.deleteSubmittingId === project.id}
                        >
                          <Text
                            className={`text-xs font-semibold leading-none ${
                              deleteMatches && tasks.deleteSubmittingId !== project.id ? "text-destructive" : "text-muted-foreground/50"
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
      ) : null;
}
