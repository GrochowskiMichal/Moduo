import { Text, View } from "../../src/tw";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";

export default function TimesheetScreen() {
  return (
    <FeaturePanelsShell
      feature="timesheet"
      left={<Text className="text-[#8f8f8f] text-[13px]">Timesheet tools coming soon.</Text>}
      center={
        <View className="flex-1 items-center justify-center">
          <Text className="text-[#d4d8e1] text-[32px] font-semibold">Timesheet</Text>
          <Text className="text-[#7d8595] text-lg mt-2">Timesheet feature coming soon</Text>
        </View>
      }
    />
  );
}
