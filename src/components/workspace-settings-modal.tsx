import { useEffect, useMemo, useState } from "react";
import { Modal } from "react-native";
import { Pressable, Text, TextInput, View } from "../tw";
import { useWorkspace } from "../providers/workspace-provider";
import type { ModulePermission, WorkspaceRole } from "../features/workspaces/types";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const roleOptions: WorkspaceRole[] = ["viewer", "editor", "admin", "owner"];
const permissionOptions: ModulePermission[] = ["none", "view", "edit", "admin"];

export function WorkspaceSettingsModal({ visible, onClose }: Props) {
  const {
    selectedWorkspace,
    canManageWorkspace,
    members,
    invites,
    sendInvite,
    updateInvite,
    revokeInvite,
    updateMemberPermissions,
    refreshAccessData,
  } = useWorkspace();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [notesPermission, setNotesPermission] = useState<ModulePermission>("edit");
  const [tasksPermission, setTasksPermission] = useState<ModulePermission>("edit");
  const [itemAclJson, setItemAclJson] = useState("[]");

  useEffect(() => {
    if (!visible) return;
    void refreshAccessData();
  }, [refreshAccessData, visible]);

  const parsedItemAcl = useMemo(() => {
    try {
      const parsed = JSON.parse(itemAclJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [itemAclJson]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View className="absolute inset-x-0 top-10 mx-auto w-[min(980px,95vw)] max-h-[84vh] rounded-2xl border border-[#1e2533] bg-[#0f141d] p-4 z-[999]">
        <View className="flex-row items-center justify-between border-b border-[#1f2a3a] pb-3">
          <View>
            <Text className="text-[#edf1fa] text-[20px] font-semibold">Workspace Settings</Text>
            <Text className="text-[#91a0ba] text-[13px] mt-1">{selectedWorkspace?.name ?? "No workspace selected"}</Text>
          </View>
          <Pressable className="rounded-md border border-[#2c3547] px-3 py-2" onPress={onClose}>
            <Text className="text-[#d6ddeb] text-[13px]">Close</Text>
          </Pressable>
        </View>

        {!selectedWorkspace ? (
          <Text className="text-[#91a0ba] mt-4">Select a workspace first.</Text>
        ) : !canManageWorkspace ? (
          <Text className="text-[#91a0ba] mt-4">Only owners/admins can manage workspace members and invites.</Text>
        ) : (
          <View className="mt-4 gap-4">
            <View className="rounded-xl border border-[#1d2534] bg-[#111824] p-3">
              <Text className="text-[#dce3f2] text-[15px] font-semibold">Invite User</Text>
              <View className="mt-3 flex-row gap-2 items-center">
                <TextInput
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="email@example.com"
                  placeholderTextColor="#65738b"
                  autoCapitalize="none"
                  className="h-10 flex-1 rounded-md border border-[#2b3447] bg-[#0f141d] px-3 text-[#e5ebf7]"
                />
                <TextInput
                  value={inviteRole}
                  onChangeText={(value: string) =>
                    setInviteRole(roleOptions.includes(value as WorkspaceRole) ? (value as WorkspaceRole) : "viewer")
                  }
                  placeholder="role"
                  placeholderTextColor="#65738b"
                  className="h-10 w-[90px] rounded-md border border-[#2b3447] bg-[#0f141d] px-2 text-[#e5ebf7]"
                />
                <TextInput
                  value={notesPermission}
                  onChangeText={(value: string) =>
                    setNotesPermission(
                      permissionOptions.includes(value as ModulePermission) ? (value as ModulePermission) : "view"
                    )
                  }
                  placeholder="notes"
                  placeholderTextColor="#65738b"
                  className="h-10 w-[86px] rounded-md border border-[#2b3447] bg-[#0f141d] px-2 text-[#e5ebf7]"
                />
                <TextInput
                  value={tasksPermission}
                  onChangeText={(value: string) =>
                    setTasksPermission(
                      permissionOptions.includes(value as ModulePermission) ? (value as ModulePermission) : "view"
                    )
                  }
                  placeholder="tasks"
                  placeholderTextColor="#65738b"
                  className="h-10 w-[86px] rounded-md border border-[#2b3447] bg-[#0f141d] px-2 text-[#e5ebf7]"
                />
              </View>
              <TextInput
                value={itemAclJson}
                onChangeText={setItemAclJson}
                multiline
                numberOfLines={4}
                placeholder='Item ACL JSON (e.g. [{"module":"notes","resourceType":"note","resourceId":"...","effect":"deny","permission":"view"}])'
                placeholderTextColor="#65738b"
                className="mt-2 min-h-[72px] rounded-md border border-[#2b3447] bg-[#0f141d] px-3 py-2 text-[#e5ebf7]"
              />
              <Pressable
                className="mt-2 self-start rounded-md border border-[#2b476c] bg-[#16263a] px-3 py-2"
                onPress={async () => {
                  const email = inviteEmail.trim();
                  if (!email) return;
                  await sendInvite({
                    email,
                    role: inviteRole,
                    modulePermissions: {
                      notes: notesPermission,
                      tasks: tasksPermission,
                    },
                    itemAclTemplates: parsedItemAcl,
                  });
                  setInviteEmail("");
                  setItemAclJson("[]");
                }}
              >
                <Text className="text-[#dce7fb] text-[13px]">Send Invite</Text>
              </Pressable>
            </View>

            <View className="rounded-xl border border-[#1d2534] bg-[#111824] p-3">
              <Text className="text-[#dce3f2] text-[15px] font-semibold">Members</Text>
              <View className="mt-2 max-h-[220px]">
                {members.map((member) => (
                  <View key={member.id} className="mb-2 rounded-md border border-[#222d3f] px-3 py-2">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-[#d6deed] text-[13px]">{member.userId}</Text>
                      <Text className="text-[#94a5c2] text-[12px] uppercase">{member.role}</Text>
                    </View>
                    <View className="mt-2 flex-row gap-2">
                      {roleOptions.map((role) => (
                        <Pressable
                          key={`${member.id}-${role}`}
                          className="rounded-md border border-[#2a3448] px-2 py-1"
                          onPress={() =>
                            void updateMemberPermissions({
                              memberId: member.id,
                              role,
                              modulePermissions: {
                                notes: role === "viewer" ? "view" : role === "owner" || role === "admin" ? "admin" : "edit",
                                tasks: role === "viewer" ? "view" : role === "owner" || role === "admin" ? "admin" : "edit",
                              },
                            })
                          }
                        >
                          <Text className="text-[#c6d1e6] text-[11px] uppercase">{role}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View className="rounded-xl border border-[#1d2534] bg-[#111824] p-3">
              <Text className="text-[#dce3f2] text-[15px] font-semibold">Invites</Text>
              <View className="mt-2 max-h-[180px]">
                {invites.map((invite) => (
                  <View key={invite.id} className="mb-2 rounded-md border border-[#222d3f] px-3 py-2">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-[#d6deed] text-[13px]">{invite.email}</Text>
                      <Text className="text-[#94a5c2] text-[12px] uppercase">{invite.status}</Text>
                    </View>
                    <View className="mt-2 flex-row gap-2">
                      <Pressable
                        className="rounded-md border border-[#2a3448] px-2 py-1"
                        onPress={() =>
                          void updateInvite({
                            inviteId: invite.id,
                            role: invite.role,
                            modulePermissions: { notes: "view", tasks: "view" },
                          })
                        }
                      >
                        <Text className="text-[#c6d1e6] text-[11px]">Set View</Text>
                      </Pressable>
                      <Pressable
                        className="rounded-md border border-[#2a3448] px-2 py-1"
                        onPress={() =>
                          void updateInvite({
                            inviteId: invite.id,
                            role: invite.role,
                            modulePermissions: { notes: "edit", tasks: "edit" },
                          })
                        }
                      >
                        <Text className="text-[#c6d1e6] text-[11px]">Set Edit</Text>
                      </Pressable>
                      <Pressable
                        className="rounded-md border border-[#463333] px-2 py-1"
                        onPress={() => void revokeInvite(invite.id)}
                      >
                        <Text className="text-[#f5b7b7] text-[11px]">Revoke</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}
