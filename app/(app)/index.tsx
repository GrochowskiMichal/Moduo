import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { Text, View } from "../../src/tw";
import { useWorkspace } from "../../src/providers/workspace-provider";
import {
  DASHBOARD_VIEW_CHANGE_EVENT,
  type DashboardViewChangeDetail,
} from "../../src/features/dashboard/ui/layout-events";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";

export default function HomeScreen() {
  const { selectedWorkspace, modulePermissions } = useWorkspace();
  const noModuleAccess = modulePermissions.notes === "none" && modulePermissions.tasks === "none";
  const [activeView, setActiveView] = useState<DashboardViewChangeDetail>({
    viewId: "main",
    viewName: "Main Dashboard",
  });
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onViewChange = (event: Event) => {
      const detail = (event as CustomEvent<DashboardViewChangeDetail>).detail;
      if (!detail?.viewId || !detail?.viewName) return;
      Animated.sequence([
        Animated.timing(fade, {
          toValue: 0,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(fade, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      setActiveView(detail);
    };

    window.addEventListener(DASHBOARD_VIEW_CHANGE_EVENT, onViewChange);
    return () => window.removeEventListener(DASHBOARD_VIEW_CHANGE_EVENT, onViewChange);
  }, [fade]);

  return (
    <FeaturePanelsShell
      feature="dashboard"
      left={<Text className="text-[#8f8f8f] text-[13px]">Dashboard controls coming soon.</Text>}
      center={
        <View className="flex-1">
      <Animated.View
        style={{
          opacity: fade,
          transform: [
            {
              translateY: fade.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        }}
      >
        <View className="rounded-2xl bg-[#0f141d] p-6">
          <Text className="text-[#94a6cc] text-[12px] uppercase tracking-[1.6px]">Dashboard View</Text>
          <Text className="text-[#e5ecff] text-[34px] mt-3 font-semibold">{activeView.viewName}</Text>
          <Text className="text-[#7f8ca7] text-[15px] mt-2">
            View key: <Text className="text-[#a8b7d4]">{activeView.viewId}</Text>
          </Text>
          <View className="mt-6 rounded-xl bg-[#0c1321] p-4">
            <Text className="text-[#c8d5ee] text-[15px]">
              This space is now interactive and switches with top-bar dashboard views.
            </Text>
          </View>
        </View>
      </Animated.View>
      <Text className="text-[#7d8595] text-lg mt-5">
        {selectedWorkspace ? `Workspace: ${selectedWorkspace.name}` : "No workspace selected"}
      </Text>
      {noModuleAccess ? (
        <Text className="text-[#9a9a9a] text-[15px] mt-3 text-center max-w-[520px]">
          Your current workspace does not grant Notes or Tasks access. Ask an owner/admin to update permissions.
        </Text>
      ) : null}
        </View>
      }
    />
  );
}
