import { useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "../tw";
import { useWorkspace } from "../providers/workspace-provider";
import { Icon } from "./ui/icon";

export function NotificationCenter() {
  const {
    notifications,
    notificationsScope,
    notificationsLoading,
    unreadCountWorkspace,
    unreadCountGlobal,
    setNotificationsScope,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const topBarPressableStyle = { backgroundColor: "transparent", borderWidth: 0 };

  const activeUnread = useMemo(
    () => (notificationsScope === "workspace" ? unreadCountWorkspace : unreadCountGlobal),
    [notificationsScope, unreadCountGlobal, unreadCountWorkspace]
  );

  return (
    <View className="relative shrink-0">
      <Pressable
        className="flex h-10 w-10 shrink-0 items-center justify-center bg-transparent border-0 rounded-none"
        style={topBarPressableStyle}
        onPress={async () => {
          setOpen(true);
          await refreshNotifications();
        }}
      >
        <Icon name="bell" size={16} color="#9a9a9a" />
        {activeUnread > 0 ? (
          <View className="absolute -right-1 -top-1 min-w-[18px] h-[18px] rounded-full bg-[#f08f42] items-center justify-center px-1">
            <Text className="text-[#121212] text-[10px] font-semibold">{Math.min(activeUnread, 99)}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="fixed inset-0" onPress={() => setOpen(false)} />
        <View className="fixed right-8 top-16 w-[420px] max-h-[580px] rounded-xl bg-[#171717] p-3 z-[999]">
          <View className="flex-row items-center justify-between pb-2">
            <Text className="text-[#e5e5e5] text-[16px] font-semibold">Notifications</Text>
            <Pressable onPress={() => void markAllNotificationsRead()}>
              <Text className="text-[#a6a6a6] text-[13px]">Mark all read</Text>
            </Pressable>
          </View>

          <View className="mt-3 flex-row gap-2">
            <Pressable
              className={`rounded-md px-3 py-2 ${notificationsScope === "workspace" ? "bg-[#252525]" : "bg-[#191919]"}`}
              onPress={() => setNotificationsScope("workspace")}
            >
              <Text className="text-[#dfdfdf] text-[13px]">Workspace ({unreadCountWorkspace})</Text>
            </Pressable>
            <Pressable
              className={`rounded-md px-3 py-2 ${notificationsScope === "global" ? "bg-[#252525]" : "bg-[#191919]"}`}
              onPress={() => setNotificationsScope("global")}
            >
              <Text className="text-[#dfdfdf] text-[13px]">Global ({unreadCountGlobal})</Text>
            </Pressable>
          </View>

          <View className="mt-3 max-h-[460px] overflow-y-auto">
            {notificationsLoading ? (
              <Text className="text-[#a0a0a0] text-[13px]">Loading notifications...</Text>
            ) : notifications.length === 0 ? (
              <Text className="text-[#a0a0a0] text-[13px]">No notifications yet.</Text>
            ) : (
              notifications.map((notification) => (
                <Pressable
                  key={notification.id}
                  className={`mb-2 rounded-lg px-3 py-2 ${notification.readAt ? "bg-[#161616]" : "bg-[#1d1d1d]"}`}
                  onPress={async () => {
                    if (!notification.readAt) {
                      await markNotificationRead(notification.id);
                    }
                  }}
                >
                  <Text className="text-[#e2e2e2] text-[13px]">{notification.eventType}</Text>
                  <Text className="text-[#a4a4a4] text-[12px] mt-1" numberOfLines={2}>
                    {JSON.stringify(notification.payload)}
                  </Text>
                  <Text className="text-[#878787] text-[11px] mt-1">{new Date(notification.createdAt).toLocaleString()}</Text>
                </Pressable>
              ))
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
