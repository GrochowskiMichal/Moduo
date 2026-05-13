import { useEffect, useState } from "react";
import { Check, Copy, Crown, Mail, MoreHorizontal, Send, Shield, User, UserPlus, Users, X } from "lucide-react";
import { Modal, Pressable, Text, TextInput, View } from "../tw";
import { useWorkspace } from "../providers/workspace-provider";
import { useEntitlement } from "../hooks/use-entitlement";
import { UpgradeModal } from "./upgrade-modal";
import type { ModulePermission, WorkspaceRole } from "../features/workspaces/types";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const ROLE_META: Record<WorkspaceRole, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  owner:  { label: "Owner",  color: "text-amber-300",   bg: "bg-amber-500/10 border-amber-500/20",  icon: <Crown  size={11} /> },
  admin:  { label: "Admin",  color: "text-violet-300",  bg: "bg-violet-500/10 border-violet-500/20", icon: <Shield size={11} /> },
  editor: { label: "Editor", color: "text-sky-300",     bg: "bg-sky-500/10 border-sky-500/20",      icon: <User   size={11} /> },
  viewer: { label: "Viewer", color: "text-white/40",    bg: "bg-white/[0.04] border-white/10",      icon: <User   size={11} /> },
};

const ASSIGNABLE_ROLES: WorkspaceRole[] = ["viewer", "editor", "admin"];

function RoleBadge({ role }: { role: WorkspaceRole }) {
  const m = ROLE_META[role];
  return (
    <View className={`flex-row items-center gap-1 rounded-full border px-2 py-0.5 ${m.bg}`}>
      <Text className={`${m.color}`}>{m.icon}</Text>
      <Text className={`text-[11px] font-medium ${m.color}`}>{m.label}</Text>
    </View>
  );
}

function RolePicker({
  value,
  onChange,
  disabled,
}: {
  value: WorkspaceRole;
  onChange: (r: WorkspaceRole) => void;
  disabled?: boolean;
}) {
  return (
    <View className={`flex-row gap-1 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      {ASSIGNABLE_ROLES.map((role) => {
        const active = value === role;
        const m = ROLE_META[role];
        return (
          <Pressable
            key={role}
            onPress={() => onChange(role)}
            className={`rounded-full border px-3 py-1 transition-colors ${
              active ? m.bg : "border-white/8 bg-transparent"
            }`}
          >
            <Text className={`text-[12px] font-medium ${active ? m.color : "text-white/35"}`}>
              {m.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InitialAvatar({ name, email }: { name?: string; email?: string }) {
  const letter = (name ?? email ?? "?").trim().slice(0, 1).toUpperCase();
  return (
    <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 border border-white/10">
      <Text className="text-[13px] font-semibold text-white/60">{letter}</Text>
    </View>
  );
}

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
  const { allowed: canInvite } = useEntitlement("team_members");
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [sending, setSending] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const [openMemberMenu, setOpenMemberMenu] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    void refreshAccessData();
  }, [refreshAccessData, visible]);

  const handleSendInvite = async () => {
    if (!canInvite) { setUpgradeModalOpen(true); return; }
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    setSending(true);
    try {
      const invite = await sendInvite({
        email,
        role: inviteRole,
        modulePermissions: {
          notes: inviteRole === "viewer" ? "view" : inviteRole === "admin" ? "admin" : "edit",
          tasks: inviteRole === "viewer" ? "view" : inviteRole === "admin" ? "admin" : "edit",
        },
        itemAclTemplates: [],
      });
      if (invite?.token) {
        setLastIssuedToken(invite.token);
        await navigator.clipboard.writeText(invite.token).catch(() => {});
      }
      setInviteEmail("");
      setSentFlash(true);
      setTimeout(() => setSentFlash(false), 2000);
    } finally {
      setSending(false);
    }
  };

  const handleRoleChange = async (memberId: string, role: WorkspaceRole) => {
    setOpenMemberMenu(null);
    await updateMemberPermissions({
      memberId,
      role,
      modulePermissions: {
        notes: role === "viewer" ? "view" : role === "admin" || role === "owner" ? "admin" : "edit",
        tasks: role === "viewer" ? "view" : role === "admin" || role === "owner" ? "admin" : "edit",
      },
    });
  };

  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <>
      <UpgradeModal
        visible={upgradeModalOpen}
        feature="team_members"
        onClose={() => setUpgradeModalOpen(false)}
      />

      <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
        {/* Backdrop */}
        <Pressable
          className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          onPress={onClose}
        />

        {/* Sheet */}
        <View className="fixed inset-x-0 top-[5vh] mx-auto w-[min(560px,95vw)] max-h-[88vh] rounded-2xl border border-white/[0.08] bg-[#0c0c0c] shadow-2xl z-[999] overflow-hidden flex flex-col">

          {/* Header */}
          <div className="flex flex-row items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
            <div className="flex flex-row items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.08] shrink-0">
                <Users size={15} color="rgba(255,255,255,0.5)" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-[#f2f2f2] tracking-[-0.01em] m-0">
                  Workspace Members
                </p>
                <p className="text-[12px] text-white/35 mt-0.5 m-0">
                  {selectedWorkspace?.name ?? "—"}
                </p>
              </div>
            </div>
            <Pressable
              onPress={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] hover:bg-white/10 transition-colors shrink-0"
            >
              <X size={14} color="rgba(255,255,255,0.5)" />
            </Pressable>
          </div>

          {/* Body */}
          <View className="flex-1 overflow-y-auto px-6 py-5 gap-6">

            {!selectedWorkspace ? (
              <Text className="text-white/35 text-[14px]">Select a workspace first.</Text>
            ) : !canManageWorkspace ? (
              <Text className="text-white/35 text-[14px]">Only owners and admins can manage members.</Text>
            ) : (
              <>
                {/* ── Invite section ── */}
                <View>
                  <div className="flex flex-row items-center gap-2 mb-3">
                    <UserPlus size={13} color="rgba(255,255,255,0.3)" />
                    <p className="text-[12px] font-semibold uppercase tracking-widest text-white/30 m-0">
                      Invite
                    </p>
                  </div>

                  {!canInvite ? (
                    /* Paywall nudge */
                    <Pressable
                      onPress={() => setUpgradeModalOpen(true)}
                      className="flex flex-row items-center justify-between rounded-xl border border-dashed border-amber-500/25 bg-amber-500/[0.04] px-4 py-3.5 hover:bg-amber-500/[0.07] transition-colors"
                    >
                      <div className="flex flex-row items-center gap-3">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                          <Crown size={13} color="#f59e0b" />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-amber-300 m-0">Upgrade to Team to invite members</p>
                          <p className="text-[11px] text-white/30 mt-0.5 m-0">Collaborate with your team in real-time</p>
                        </div>
                      </div>
                      <p className="text-[12px] font-semibold text-amber-400 m-0 shrink-0 ml-3">Upgrade →</p>
                    </Pressable>
                  ) : (
                    <View className="gap-3">
                      {/* Email row */}
                      <div className="flex flex-row items-center gap-2">
                        <div className="relative flex-1">
                          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center justify-center">
                            <Mail size={14} color="rgba(255,255,255,0.25)" />
                          </div>
                          <TextInput
                            value={inviteEmail}
                            onChangeText={setInviteEmail}
                            placeholder="teammate@company.com"
                            placeholderTextColor="rgba(255,255,255,0.2)"
                            autoCapitalize="none"
                            keyboardType="email-address"
                            className="h-10 rounded-xl border border-white/[0.09] bg-white/[0.04] pl-9 pr-3 text-[14px] text-[#e8edf5] outline-none focus:border-white/20 transition-colors"
                          />
                        </div>
                        <Pressable
                          disabled={sending || !inviteEmail.trim()}
                          onPress={() => void handleSendInvite()}
                          className={`flex h-10 flex-row items-center gap-2 rounded-xl px-4 transition-colors ${
                            inviteEmail.trim() && !sending
                              ? "bg-[#f2f2f2] hover:bg-white"
                              : "bg-white/[0.06]"
                          }`}
                        >
                          <Send size={13} color={inviteEmail.trim() && !sending ? "#111" : "rgba(255,255,255,0.3)"} />
                          <Text className={`text-[13px] font-semibold ${inviteEmail.trim() && !sending ? "text-[#111]" : "text-white/25"}`}>
                            {sending ? "Sending…" : sentFlash ? "Sent!" : "Invite"}
                          </Text>
                        </Pressable>
                      </div>

                      {/* Role picker */}
                      <div className="flex flex-row items-center gap-2">
                        <p className="text-[12px] text-white/30 w-10 m-0 shrink-0">Role</p>
                        <RolePicker value={inviteRole} onChange={setInviteRole} />
                      </div>

                      {/* Invite code banner */}
                      {sentFlash && lastIssuedToken && (
                        <div className="flex flex-row items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5">
                          <Check size={12} color="#6ee7b7" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-emerald-300 m-0">Invite code copied — share it with your teammate:</p>
                            <p className="text-[11px] text-white/40 font-mono truncate mt-0.5 m-0">{lastIssuedToken}</p>
                          </div>
                          <Pressable
                            onPress={async () => {
                              await navigator.clipboard.writeText(lastIssuedToken).catch(() => {});
                            }}
                            className="shrink-0"
                          >
                            <Copy size={12} color="rgba(255,255,255,0.3)" />
                          </Pressable>
                        </div>
                      )}
                    </View>
                  )}
                </View>

                {/* ── Members ── */}
                <View>
                  <div className="flex flex-row items-center gap-2 mb-3">
                    <Users size={13} color="rgba(255,255,255,0.3)" />
                    <p className="text-[12px] font-semibold uppercase tracking-widest text-white/30 m-0">
                      Members · {members.length}
                    </p>
                  </div>

                  <View className="gap-1.5">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="flex flex-row items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="flex flex-row items-center gap-3">
                          <InitialAvatar email={member.userId} />
                          <p className="text-[13px] font-medium text-[#d8e0ee] m-0">
                            {member.userId.length > 20
                              ? `${member.userId.slice(0, 8)}…${member.userId.slice(-4)}`
                              : member.userId}
                          </p>
                        </div>

                        <div className="flex flex-row items-center gap-2">
                          <RoleBadge role={member.role} />
                          {member.role !== "owner" && (
                            <div className="relative">
                              <Pressable
                                onPress={() =>
                                  setOpenMemberMenu(openMemberMenu === member.id ? null : member.id)
                                }
                                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/8 transition-colors"
                              >
                                <MoreHorizontal size={14} color="rgba(255,255,255,0.3)" />
                              </Pressable>
                              {openMemberMenu === member.id && (
                                <div className="absolute right-0 top-7 z-50 w-36 rounded-xl border border-white/[0.08] bg-[#141414] py-1 shadow-xl">
                                  {ASSIGNABLE_ROLES.map((role) => (
                                    <Pressable
                                      key={role}
                                      onPress={() => void handleRoleChange(member.id, role)}
                                      className={`flex flex-row items-center gap-2 px-3 py-2 hover:bg-white/[0.05] ${
                                        member.role === role ? "bg-white/[0.04]" : ""
                                      }`}
                                    >
                                      <p className={`text-[13px] m-0 ${ROLE_META[role].color}`}>
                                        {ROLE_META[role].label}
                                      </p>
                                      {member.role === role && (
                                        <p className="ml-auto text-[10px] text-white/30 m-0">✓</p>
                                      )}
                                    </Pressable>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </View>
                </View>

                {/* ── Pending invites ── */}
                {pendingInvites.length > 0 && (
                  <View>
                  <div className="flex flex-row items-center gap-2 mb-3">
                    <Mail size={13} color="rgba(255,255,255,0.3)" />
                    <p className="text-[12px] font-semibold uppercase tracking-widest text-white/30 m-0">
                      Pending · {pendingInvites.length}
                    </p>
                  </div>

                    <View className="gap-1.5">
                      {pendingInvites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex flex-row items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                        >
                          <div className="flex flex-row items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-white/15">
                              <Mail size={12} color="rgba(255,255,255,0.3)" />
                            </div>
                            <div>
                              <p className="text-[13px] font-medium text-[#d8e0ee] m-0">{invite.email}</p>
                              <p className="text-[11px] text-white/30 mt-0.5 m-0">Invite pending</p>
                            </div>
                          </div>
                        <div className="flex flex-row items-center gap-2">
                            <RoleBadge role={invite.role} />
                            {invite.token && (
                              <Pressable
                                onPress={async () => {
                                  await navigator.clipboard.writeText(invite.token!).catch(() => {});
                                  setCopiedInviteId(invite.id);
                                  setTimeout(() => setCopiedInviteId(null), 2000);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-white/8 transition-colors"
                                title="Copy invite code"
                              >
                                {copiedInviteId === invite.id
                                  ? <Check size={12} color="rgba(100,220,100,0.8)" />
                                  : <Copy size={12} color="rgba(255,255,255,0.35)" />}
                              </Pressable>
                            )}
                            <Pressable
                              onPress={() => void revokeInvite(invite.id)}
                              className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-red-500/10 transition-colors"
                            >
                              <X size={13} color="rgba(255,100,100,0.6)" />
                            </Pressable>
                          </div>
                        </div>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}
