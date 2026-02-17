import { Text, View } from "../../src/tw";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";

export default function FilesScreen() {
  return (
    <FeaturePanelsShell
      feature="files"
      left={<Text className="text-[#8f8f8f] text-[13px]">Files tools coming soon.</Text>}
      center={
        <View className="flex-1 items-center justify-center">
          <Text className="text-[#d4d8e1] text-[32px] font-semibold">Files</Text>
          <Text className="text-[#7d8595] text-lg mt-2">Files feature coming soon</Text>
        </View>
      }
    />
  );
}
