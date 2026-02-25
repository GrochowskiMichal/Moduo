import { useMemo, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "../tw";
import { useWorkspace } from "../providers/workspace-provider";
import { Icon } from "./ui/icon";

type Props = {
  onOpenSettings?: () => void;
};

export function WorkspaceSwitcher({ onOpenSettings }: Props) {
  const {
    workspaces,
    selectedWorkspace,
    selectWorkspace,
    createWorkspace,
    softDeleteWorkspace,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("New Workspace");
  const [deleteCandidateWorkspaceId, setDeleteCandidateWorkspaceId] = useState<string | null>(null);
  const [deleteWorkspaceInput, setDeleteWorkspaceInput] = useState("");
  const [deleteSubmittingWorkspaceId, setDeleteSubmittingWorkspaceId] = useState<string | null>(null);
  const topBarPressableStyle = { backgroundColor: "transparent", borderWidth: 0 };
  const formatWorkspaceLabel = (name: string) => name.replace(/\s+workspace$/i, "").trim() || name;
  const rowStyle = { display: "flex", flexDirection: "row" as const, alignItems: "center" };
  const workspaceRowStyle = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 8,
    minHeight: 32,
  } as const;
  const workspaceNameWrapStyle = { minWidth: 0, display: "flex", alignItems: "center", height: 28 } as const;
  const workspaceActionsStyle = { display: "flex", alignItems: "center", gap: 4, height: 28 } as const;
  const iconButtonStyle = { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28 } as const;
  const plusButtonStyle = { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24 } as const;
  const deleteRevealBaseStyle = { overflow: "hidden", transition: "max-height 220ms ease, opacity 180ms ease, transform 180ms ease, margin-top 180ms ease" } as const;

  const submitCreateWorkspace = async () => {
    const name = newWorkspaceName.trim() || "New Workspace";
    const workspaceId = await createWorkspace(name);
    if (workspaceId) {
      selectWorkspace(workspaceId);
      setIsCreatingWorkspace(false);
      setNewWorkspaceName("New Workspace");
      setOpen(false);
    }
  };

  const workspaceLabel = useMemo(
    () => (selectedWorkspace?.name ? formatWorkspaceLabel(selectedWorkspace.name) : "No workspace"),
    [selectedWorkspace?.name]
  );

  const cancelDeleteIntent = () => {
    setDeleteCandidateWorkspaceId(null);
    setDeleteWorkspaceInput("");
    setDeleteSubmittingWorkspaceId(null);
  };
  const closeModal = () => {
    setOpen(false);
    setIsCreatingWorkspace(false);
    setNewWorkspaceName("New Workspace");
    cancelDeleteIntent();
  };

  return (
    <View className="relative">
      <Pressable
        className="flex h-9 min-w-[220px] max-w-[320px] flex-row items-center gap-2 rounded-none border-0 bg-transparent px-1"
        style={topBarPressableStyle}
        onPress={() => setOpen((current) => !current)}
      >
        <View className="min-w-0 flex-1">
          <Text as="div" className="truncate text-[14px] text-[#e0e0e0]">
            {workspaceLabel}
          </Text>
        </View>
        <Text className="shrink-0 text-[11px] text-[#9b9b9b] leading-none">▾</Text>
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={closeModal}>
        <Pressable className="fixed inset-0" onPress={closeModal} />
        <View className="fixed top-16 left-[72px] w-[360px] rounded-xl bg-[#171717] p-2 z-[999]">
          <View className="mb-2 border-b border-[#262626] px-2 pb-2 pt-1" style={rowStyle}>
            <View className="min-w-0 flex flex-1 gap-2" style={rowStyle}>
              <Text className="text-[#a0a0a0] text-xs">Workspaces</Text>
              <Pressable
                className="rounded-md"
                style={plusButtonStyle}
                onPress={async (event: any) => {
                  event?.stopPropagation?.();
                  setIsCreatingWorkspace(true);
                  setNewWorkspaceName("New Workspace");
                }}
              >
                <Text className="text-[#d8d8d8] text-[16px] leading-none">+</Text>
              </Pressable>
            </View>
          </View>
          <View className="max-h-[260px] overflow-y-auto">
            {isCreatingWorkspace ? (
              <View className="mb-2 rounded-lg border border-[#2a2a2a] bg-[#1b1b1b] px-2 py-2" style={rowStyle}>
                <TextInput
                  autoFocus
                  value={newWorkspaceName}
                  onChangeText={setNewWorkspaceName}
                  onKeyDown={(event: any) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitCreateWorkspace();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setIsCreatingWorkspace(false);
                    }
                  }}
                  className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[13px] text-[#e5e5e5] outline-none"
                />
                <View className="ml-1" style={rowStyle}>
                  <Pressable className="rounded-md hover:bg-[#2b2b2b]" style={iconButtonStyle} onPress={() => void submitCreateWorkspace()}>
                    <Text className="text-[14px] leading-none text-[#d8d8d8]">✓</Text>
                  </Pressable>
                  <Pressable
                    className="rounded-md hover:bg-[#2b2b2b]"
                    style={iconButtonStyle}
                    onPress={() => {
                      setIsCreatingWorkspace(false);
                      setNewWorkspaceName("New Workspace");
                    }}
                  >
                    <Text className="text-[14px] leading-none text-[#d8d8d8]">×</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {workspaces.map((workspace) => {
              const active = workspace.id === selectedWorkspace?.id;
              const nameLabel = formatWorkspaceLabel(workspace.name);
              const isDeleteOpen = deleteCandidateWorkspaceId === workspace.id;
              const deleteMatches = deleteWorkspaceInput.trim() === nameLabel.trim();
              return (
                <View
                  key={workspace.id}
                  className={`rounded-lg px-3 py-2 ${active ? "bg-[#242424]" : "bg-transparent hover:bg-[#1f1f1f]"}`}
                >
                  <Pressable
                    onPress={() => {
                      selectWorkspace(workspace.id);
                      setOpen(false);
                    }}
                  >
                    <View style={workspaceRowStyle}>
                      <View style={workspaceNameWrapStyle}>
                        <Text
                          as="div"
                          className={`${active ? "text-white" : "text-[#d9d9d9]"} text-[14px]`}
                          style={{ lineHeight: "28px" }}
                          numberOfLines={1}
                        >
                          {nameLabel}
                        </Text>
                      </View>
                      <View className="shrink-0" style={workspaceActionsStyle}>
                        <Pressable
                          className="rounded-md hover:bg-[#2b2b2b]"
                          style={iconButtonStyle}
                          onPress={(event: any) => {
                            event?.stopPropagation?.();
                            selectWorkspace(workspace.id);
                            setOpen(false);
                            onOpenSettings?.();
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
                              cancelDeleteIntent();
                            } else {
                              setDeleteCandidateWorkspaceId(workspace.id);
                              setDeleteWorkspaceInput("");
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
                      Retype <Text className="text-[#d9d9d9] font-semibold">{nameLabel}</Text> to delete this workspace.
                    </Text>
                    <View className="mt-2" style={rowStyle}>
                      <TextInput
                        value={deleteWorkspaceInput}
                        onChangeText={setDeleteWorkspaceInput}
                        onKeyDown={(event: any) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelDeleteIntent();
                          }
                          if (event.key === "Enter" && deleteMatches && deleteSubmittingWorkspaceId !== workspace.id) {
                            event.preventDefault();
                            void (async () => {
                              setDeleteSubmittingWorkspaceId(workspace.id);
                              await softDeleteWorkspace(workspace.id);
                              cancelDeleteIntent();
                            })();
                          }
                        }}
                        placeholder={nameLabel}
                        className="h-8 flex-1 rounded-md border border-[#333] bg-[#151515] px-2 text-[12px] text-[#e5e5e5] outline-none"
                      />
                      <Pressable
                        className="ml-1 rounded-md hover:bg-[#2b2b2b]"
                        style={iconButtonStyle}
                        onPress={cancelDeleteIntent}
                      >
                        <Text className="text-[12px] leading-none text-[#d0d0d0]">×</Text>
                      </Pressable>
                      <Pressable
                        className="ml-1 rounded-md"
                        style={iconButtonStyle}
                        onPress={async () => {
                          if (!deleteMatches || deleteSubmittingWorkspaceId === workspace.id) return;
                          setDeleteSubmittingWorkspaceId(workspace.id);
                          await softDeleteWorkspace(workspace.id);
                          cancelDeleteIntent();
                        }}
                        aria-disabled={!deleteMatches || deleteSubmittingWorkspaceId === workspace.id}
                      >
                        <Text
                          className={`text-[11px] font-semibold leading-none ${
                            deleteMatches && deleteSubmittingWorkspaceId !== workspace.id ? "text-[#ffb0b0]" : "text-[#6a6a6a]"
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
    </View>
  );
}
