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

type BrainstormMenuProps = {
  brainstorm: AppChromeMenusProps["brainstorm"];
};

export function BrainstormMenu({ brainstorm }: BrainstormMenuProps) {
  return brainstorm.open && brainstorm.anchor ? (
        <Modal transparent visible={brainstorm.open} animationType="fade" onRequestClose={brainstorm.closeMenu}>
          <Pressable className="fixed inset-0 z-[998]" onPress={brainstorm.closeMenu} />
          <View className="fixed z-[1000] w-[360px] rounded-xl border border-border bg-popover p-1 text-popover-foreground" style={{ left: brainstorm.anchor.left, top: brainstorm.anchor.top }}>
            <View className="mb-2 border-b border-border px-2 pb-2 pt-1" style={rowStyle}>
              <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
                <Text className="text-muted-foreground text-xs uppercase tracking-wide">All sessions</Text>
                <Pressable
                  className="rounded-md"
                  style={plusButtonStyle}
                  onPress={(event: any) => {
                    event?.stopPropagation?.();
                    brainstorm.setIsCreating(true);
                    brainstorm.setNewName("New Brainstorm");
                  }}
                >
                  <Text className="text-foreground text-base leading-none">+</Text>
                </Pressable>
              </View>
            </View>
            <View className="max-h-[260px] overflow-y-auto">
              {brainstorm.isCreating ? (
                <View className="mb-2 rounded-md border border-border bg-muted px-2 py-2" style={rowStyle}>
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
                    className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                  />
                  <View className="ml-1" style={rowStyle}>
                    <Pressable className="rounded-md hover:bg-accent" style={iconButtonStyle} onPress={() => void brainstorm.submitCreate()}>
                      <Text className="text-sm leading-none text-foreground">✓</Text>
                    </Pressable>
                    <Pressable
                      className="rounded-md hover:bg-accent"
                      style={iconButtonStyle}
                      onPress={() => {
                        brainstorm.setIsCreating(false);
                        brainstorm.setNewName("New Brainstorm");
                      }}
                    >
                      <Text className="text-sm leading-none text-foreground">×</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {brainstorm.brainstorms.length === 0 ? (
                <View className="px-3 py-2">
                  <Text className="text-sm text-muted-foreground">No brainstorm sessions yet.</Text>
                </View>
              ) : null}

              {brainstorm.brainstorms.map((bs) => {
                const isActive = brainstorm.selectedBrainstormId === bs.id;
                const isDeleteOpen = brainstorm.deleteCandidateId === bs.id;
                const deleteMatches = brainstorm.deleteInput.trim() === bs.name.trim();
                return (
                  <View key={bs.id} className={`rounded-md px-3 py-2 ${isActive ? "bg-accent text-accent-foreground" : "bg-transparent hover:bg-accent"}`}>
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
                            className={`${isActive ? "text-foreground" : "text-popover-foreground"} text-sm`}
                            style={{ lineHeight: "28px" }}
                            numberOfLines={1}
                          >
                            {bs.name}
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
                                brainstorm.cancelDeleteIntent();
                              } else {
                                brainstorm.setDeleteCandidateId(bs.id);
                                brainstorm.setDeleteInput("");
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
                        Retype <Text className="font-semibold text-foreground">{bs.name}</Text> to delete this session.
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
                          className="h-8 flex-1 rounded-md border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
                        />
                        <Pressable className="ml-1 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" style={iconButtonStyle} onPress={brainstorm.cancelDeleteIntent}>
                          <Text className="text-xs leading-none text-foreground">×</Text>
                        </Pressable>
                        <Pressable
                          className="ml-1 rounded-md"
                          style={iconButtonStyle}
                          onPress={() => void brainstorm.removeBrainstorm(bs.id)}
                          aria-disabled={!deleteMatches || brainstorm.deleteSubmittingId === bs.id}
                        >
                          <Text
                            className={`text-xs font-semibold leading-none ${
                              deleteMatches && brainstorm.deleteSubmittingId !== bs.id ? "text-destructive" : "text-muted-foreground/50"
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
