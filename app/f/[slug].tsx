import { Text, View } from "../../src/tw";

export default function PublicFormNativeFallback() {
  return (
    <View className="flex-1 items-center justify-center bg-[#090b10] px-6">
      <Text className="text-[#dbe3f5] text-[22px] font-semibold">Public form link</Text>
      <Text className="mt-2 text-center text-[#9aa6bf]">
        Open this link in web to submit the form.
      </Text>
    </View>
  );
}
