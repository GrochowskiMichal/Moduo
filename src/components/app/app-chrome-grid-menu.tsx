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

type GridSceneMenuProps = {
  grid: AppChromeMenusProps["grid"];
};

export function GridSceneMenu({ grid }: GridSceneMenuProps) {
  return grid.open && grid.anchor ? (
        <Modal transparent visible={grid.open} animationType="fade" onRequestClose={grid.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={grid.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl border border-border bg-popover p-1 text-popover-foreground" style={{ left: grid.anchor.left, top: grid.anchor.top }}>
            <View className="mb-2 border-b border-border px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-muted-foreground text-xs uppercase tracking-wide">All scenes</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    grid.setIsCreating(true);
                    grid.setNewName("New Scene");
                  }}
                >
                  <Text className="text-foreground text-base leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {grid.isCreating ? (
                <View className="mb-2 rounded-md border border-border bg-muted px-2 py-2" style={rowStyle}>
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
                    className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-accent" style={iconButtonStyle} onPress={grid.submitCreate}>
                      <Text className="text-sm leading-none text-foreground">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-accent"
                      style={iconButtonStyle}
                      onPress={() => {
                        grid.setIsCreating(false);
                        grid.setNewName("New Scene");
                      }}
                    >
                      <Text className="text-sm leading-none text-foreground">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {grid.scenes.map((scene) => {
                const isActiveScene = scene.id === grid.activeSceneId;
                const isDeleteOpen = grid.deleteCandidateId === scene.id;
                const deleteMatches = grid.deleteInput.trim() === scene.name.trim();
                return (
                  <View key={scene.id} className={`rounded-md px-3 py-2 ${isActiveScene ? "bg-accent text-accent-foreground" : "bg-transparent hover:bg-accent"}`}>
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
                            className={`${isActiveScene ? "text-foreground" : "text-popover-foreground"} text-sm`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {scene.name}
                          </Text>
                        </View>
                        <View className="shrink-0" style={itemActionsStyle}>
                          <Pressable
                            className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                            style={iconButtonStyle}
                            onPress={(event: any) => {
                              event?.stopPropagation?.();
                            }}
                          >
                            <Icon name="settings" size={13} />
                          </Pressable>
                          <Pressable
                            className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
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
                            <Icon name="trash-2" size={13} className={grid.scenes.length > 1 ? "text-destructive" : "text-muted-foreground/50"} />
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
                        Retype <Text className="font-semibold text-foreground">{scene.name}</Text> to delete this scene.
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
                          className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                        />
                        <Pressable
                          className="ml-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                          style={iconButtonStyle}
                          onPress={() => {
                            grid.setDeleteCandidateId(null);
                            grid.setDeleteInput("");
                            grid.setDeleteSubmittingId(null);
                          }}
                        >
                          <Text className="text-xs leading-none text-foreground">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => grid.removeScene(scene.id)}
                          aria-disabled={!deleteMatches || grid.deleteSubmittingId === scene.id}
                        >
                          <Text
                            className={`text-xs font-semibold leading-none ${
                              deleteMatches && grid.deleteSubmittingId !== scene.id ? "text-destructive" : "text-muted-foreground/50"
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
