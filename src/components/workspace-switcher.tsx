import { useMemo, useState } from "react";
import { Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View } from "../tw";
import { useWorkspace } from "../providers/workspace-provider";

type Props = {
  onOpenSettings?: () => void;
};

export function WorkspaceSwitcher({ onOpenSettings }: Props) {
  const {
    workspaces,
    selectedWorkspace,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    leaveWorkspace,
    softDeleteWorkspace,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const topBarPressableStyle = { backgroundColor: "transparent", borderWidth: 0 };

  const workspaceLabel = useMemo(() => selectedWorkspace?.name ?? "No workspace", [selectedWorkspace?.name]);

  return (
    <View className="relative">
      <Pressable
        className="h-9 min-w-[220px] max-w-[320px] px-1 flex-row items-center gap-2 bg-transparent border-0 rounded-none"
        style={topBarPressableStyle}
        onPress={() => setOpen((current) => !current)}
      >
        <Text className="text-[#e0e0e0] text-[14px] max-w-[290px]" numberOfLines={1}>
          {workspaceLabel}
        </Text>
        <Text className="text-[#9b9b9b] text-[11px]">▾</Text>
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1" onPress={() => setOpen(false)} />
        <View className="absolute top-16 left-[72px] w-[360px] rounded-xl bg-[#171717] p-2 z-[999]">
          <View className="flex-row items-center justify-between px-2 pb-2 pt-1 border-b border-[#262626] mb-2">
            <Text className="text-[#a0a0a0] text-xs">Workspaces</Text>
            <Pressable
              className="h-5 w-5 items-center justify-center"
              onPress={async () => {
                const name = typeof window === "undefined" ? "New Workspace" : window.prompt("Workspace name", "New Workspace");
                if (!name) return;
                const workspaceId = await createWorkspace(name);
                if (workspaceId) selectWorkspace(workspaceId);
                setOpen(false);
              }}
            >
              <Text className="text-[#d8d8d8] text-[14px]">+</Text>
            </Pressable>
          </View>
          <View className="max-h-[260px]">
            {workspaces.map((workspace) => {
              const active = workspace.id === selectedWorkspace?.id;
              return (
                <Pressable
                  key={workspace.id}
                  className={`rounded-lg px-3 py-2 ${active ? "bg-[#242424]" : "bg-transparent"}`}
                  onPress={() => {
                    selectWorkspace(workspace.id);
                    setOpen(false);
                  }}
                >
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className={`${active ? "text-white" : "text-[#d9d9d9]"} text-[14px] flex-1`} numberOfLines={1}>
                      {workspace.name} <Text className="text-[#959595]">({workspace.role})</Text>
                    </Text>
                    <View className="flex-row items-center gap-1">
                      <Pressable
                        className="h-6 w-6 items-center justify-center"
                        onPress={async (event: any) => {
                          event?.stopPropagation?.();
                          const nextName =
                            typeof window === "undefined"
                              ? workspace.name
                              : window.prompt("Rename workspace", workspace.name);
                          if (!nextName || nextName.trim() === workspace.name) return;
                          await renameWorkspace(workspace.id, nextName);
                        }}
                      >
                        <Feather name="edit-2" size={13} color="#d8d8d8" />
                      </Pressable>
                      <Pressable
                        className="h-6 w-6 items-center justify-center"
                        onPress={(event: any) => {
                          event?.stopPropagation?.();
                          selectWorkspace(workspace.id);
                          setOpen(false);
                          onOpenSettings?.();
                        }}
                      >
                        <Feather name="settings" size={13} color="#d8d8d8" />
                      </Pressable>
                      <Pressable
                        className="h-6 w-6 items-center justify-center"
                        onPress={async (event: any) => {
                          event?.stopPropagation?.();
                          await leaveWorkspace(workspace.id);
                          setOpen(false);
                        }}
                      >
                        <Feather name="log-out" size={13} color="#d8d8d8" />
                      </Pressable>
                      <Pressable
                        className="h-6 w-6 items-center justify-center"
                        onPress={async (event: any) => {
                          event?.stopPropagation?.();
                          const confirmed = typeof window === "undefined" ? false : window.confirm("Delete this workspace?");
                          if (!confirmed) return;
                          await softDeleteWorkspace(workspace.id);
                          setOpen(false);
                        }}
                      >
                        <Feather name="trash-2" size={13} color="#ffb0b0" />
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}
