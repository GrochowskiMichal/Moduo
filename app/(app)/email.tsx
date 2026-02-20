import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";
import { useAuth } from "../../src/providers/auth-provider";
import { useWorkspace } from "../../src/providers/workspace-provider";
import { useEmail } from "../../src/features/email/hooks/use-email";
import { EmailWorkspace } from "../../src/features/email/ui/email-workspace";
import { Text, View } from "../../src/tw";

export default function EmailScreen() {
  const { supabase, userId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const email = useEmail({ supabase, userId, workspaceId: selectedWorkspaceId });

  return (
    <FeaturePanelsShell
      feature="email"
      left={
        <View>
          <Text className="text-[#d4d8e1] text-[16px] font-semibold">Email Accounts</Text>
          <Text className="text-[#8f8f8f] text-[12px] mt-1">
            Connect Gmail, Outlook, Apple or custom SMTP/IMAP/POP3.
          </Text>
        </View>
      }
      center={<EmailWorkspace email={email} />}
      right={
        <View>
          <Text className="text-[#d4d8e1] text-[16px] font-semibold">Connection Status</Text>
          <Text className="text-[#8f8f8f] text-[12px] mt-1">Status, reauth prompts and sync diagnostics are shown inline.</Text>
        </View>
      }
    />
  );
}
