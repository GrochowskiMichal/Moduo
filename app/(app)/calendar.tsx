import { Text, View } from "../../src/tw";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";
export default function CalendarScreen() {
  return (
    <FeaturePanelsShell
      feature="calendar"
      left={<Text className="text-[#8f8f8f] text-[13px]">Calendar tools coming soon.</Text>}
      center={<View className="flex-1 items-center justify-center">
        <Text className="text-[#d4d8e1] text-[32px] font-semibold">Calendar</Text>
        <Text className="text-[#7d8595] text-lg mt-2">Calendar placeholder screen</Text>
      </View>}
    />
  );
}
