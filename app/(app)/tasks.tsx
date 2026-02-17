import { Text, View } from "../../src/tw";

export default function TasksScreen() {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-[#d4d8e1] text-[30px] font-semibold">Tasks</Text>
      <Text className="text-[#7d8595] text-lg mt-2 text-center">
        Linear-like Tasks v2 is currently optimized for web and desktop.
      </Text>
    </View>
  );
}
