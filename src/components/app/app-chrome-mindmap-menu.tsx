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

type MindmapMenuProps = {
  mindmap: AppChromeMenusProps["mindmap"];
};

export function MindmapMenu({ mindmap }: MindmapMenuProps) {
  return mindmap.open && mindmap.anchor ? (
        <Modal transparent visible={mindmap.open} animationType="fade" onRequestClose={mindmap.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={mindmap.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl border border-border bg-popover p-1 text-popover-foreground" style={{ left: mindmap.anchor.left, top: mindmap.anchor.top }}>
            <View className="mb-2 border-b border-border px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-muted-foreground text-xs uppercase tracking-wide">All mindmaps</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    mindmap.setIsCreating(true);
                    mindmap.setNewName("New Mindmap");
                  }}
                >
                  <Text className="text-foreground text-base leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {mindmap.isCreating ? (
                <View className="mb-2 rounded-md border border-border bg-muted px-2 py-2" style={rowStyle}>
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
                    className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-accent" style={iconButtonStyle} onPress={() => void mindmap.submitCreate()}>
                      <Text className="text-sm leading-none text-foreground">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-accent"
                      style={iconButtonStyle}
                      onPress={() => {
                        mindmap.setIsCreating(false);
                        mindmap.setNewName("New Mindmap");
                      }}
                    >
                      <Text className="text-sm leading-none text-foreground">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {mindmap.mindmaps.length === 0 ? (
                <View className="px-3 py-2">
                  <Text className="text-sm text-muted-foreground">No mindmaps yet.</Text>
                </View>
              ) : null}

              {mindmap.mindmaps.map((map) => {
                const isActiveMindmap = mindmap.selectedMindmapId === map.id;
                const isDeleteOpen = mindmap.deleteCandidateId === map.id;
                const deleteMatches = mindmap.deleteInput.trim() === map.name.trim();
                return (
                  <View key={map.id} className={`rounded-md px-3 py-2 ${isActiveMindmap ? "bg-accent text-accent-foreground" : "bg-transparent hover:bg-accent"}`}>
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
                            className={`${isActiveMindmap ? "text-foreground" : "text-popover-foreground"} text-sm`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {map.name}
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
                                mindmap.cancelDeleteIntent();
                              } else {
                                mindmap.setDeleteCandidateId(map.id);
                                mindmap.setDeleteInput("");
                              }
                            }}
                          >
                            <Icon name="trash-2" size={13} className="text-destructive" />
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
                        Retype <Text className="font-semibold text-foreground">{map.name}</Text> to delete this mindmap.
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
                          className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                        />
                        <Pressable className="ml-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" style={iconButtonStyle} onPress={mindmap.cancelDeleteIntent}>
                          <Text className="text-xs leading-none text-foreground">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => void mindmap.removeMindmap(map.id)}
                          aria-disabled={!deleteMatches || mindmap.deleteSubmittingId === map.id}
                        >
                          <Text
                            className={`text-xs font-semibold leading-none ${
                              deleteMatches && mindmap.deleteSubmittingId !== map.id ? "text-destructive" : "text-muted-foreground/50"
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
