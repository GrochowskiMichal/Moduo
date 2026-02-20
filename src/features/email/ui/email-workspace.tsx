import { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView } from "react-native";
import { Pressable, Text, TextInput, View } from "../../../tw";
import type { EmailProvider } from "../types";
import type { useEmail } from "../hooks/use-email";

type EmailState = ReturnType<typeof useEmail>;

function ProviderButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable className="px-3 py-2 rounded-lg bg-[#202020]" onPress={onPress}>
      <Text className="text-[#ececec] text-[12px]">{label}</Text>
    </Pressable>
  );
}

export function EmailWorkspace({ email }: { email: EmailState }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [customEmail, setCustomEmail] = useState("");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customSmtpHost, setCustomSmtpHost] = useState("");
  const [customSmtpPort, setCustomSmtpPort] = useState("587");
  const [customSmtpUsername, setCustomSmtpUsername] = useState("");
  const [customSmtpPassword, setCustomSmtpPassword] = useState("");
  const [customImapHost, setCustomImapHost] = useState("");
  const [customImapPort, setCustomImapPort] = useState("993");
  const [customImapUsername, setCustomImapUsername] = useState("");
  const [customImapPassword, setCustomImapPassword] = useState("");
  const [customPop3Host, setCustomPop3Host] = useState("");
  const [customPop3Port, setCustomPop3Port] = useState("995");
  const [customPop3Username, setCustomPop3Username] = useState("");
  const [customPop3Password, setCustomPop3Password] = useState("");
  const [customMode, setCustomMode] = useState<"smtp_imap" | "smtp_pop3">("smtp_imap");

  const selectedMessages = useMemo(() => email.messages, [email.messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as any;
      if (!payload || payload.source !== "moduo-email-oauth") return;
      const provider = payload.provider as EmailProvider | undefined;
      const code = payload.code as string | undefined;
      if (!provider || !code) return;

      void email
        .connectWithToken({
          provider,
          authorizationCode: code,
          idToken: typeof payload.idToken === "string" ? payload.idToken : undefined,
          emailAddress: typeof payload.email === "string" ? payload.email : undefined,
          displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
        })
        .then(() => {
          setOauthError(null);
          setConnectOpen(false);
        })
        .catch((error: any) => {
          const message =
            error?.context?.json?.error?.message ??
            error?.message ??
            `Failed to finish ${provider} connection`;
          setOauthError(message);
          console.warn(message);
        });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [email]);

  const connectOAuth = async (provider: EmailProvider) => {
    try {
      setOauthError(null);
      await email.connectProvider(provider);
    } catch (error: any) {
      if (typeof window !== "undefined") {
        const message =
          error?.context?.json?.error?.message ??
          error?.message ??
          `Failed to start ${provider} connection`;
        setOauthError(message);
        console.warn(message);
      }
    }
  };

  const connectCustom = async () => {
    await email.connectCustom({
      provider: "custom",
      authMode: customMode,
      emailAddress: customEmail,
      displayName: customDisplayName || null,
      smtpHost: customSmtpHost,
      smtpPort: Number(customSmtpPort),
      smtpUsername: customSmtpUsername,
      smtpPassword: customSmtpPassword,
      imapHost: customImapHost,
      imapPort: Number(customImapPort),
      imapUsername: customImapUsername,
      imapPassword: customImapPassword,
      pop3Host: customPop3Host,
      pop3Port: Number(customPop3Port),
      pop3Username: customPop3Username,
      pop3Password: customPop3Password,
    });
    setConnectOpen(false);
  };

  return (
    <>
      <View className="h-full min-h-0">
        {email.loading ? <Text className="text-[#8f8f8f] text-[12px]">Loading email...</Text> : null}
        {email.error ? <Text className="text-[#ff9b9b] text-[12px] mt-2">{email.error}</Text> : null}

        <View className="mt-3 flex-row items-center gap-2">
          <Pressable className="px-3 py-2 rounded-lg bg-[#202020]" onPress={() => setConnectOpen(true)}>
            <Text className="text-[#ececec] text-[12px]">Connect account</Text>
          </Pressable>
          <Pressable className="px-3 py-2 rounded-lg bg-[#202020]" onPress={email.syncNow}>
            <Text className="text-[#ececec] text-[12px]">Sync now</Text>
          </Pressable>
          <Text className="text-[#9d9d9d] text-[12px]">{email.syncStatus}</Text>
        </View>

        <View className="mt-4 flex-row gap-4 min-h-0 flex-1">
          <View className="w-[24%] rounded-xl bg-[#171717] p-3 min-h-0">
            <Text className="text-[#d9d9d9] text-[13px] mb-2">Accounts</Text>
            <ScrollView className="min-h-0">
              {email.accounts.map((account) => (
                <Pressable
                  key={account.id}
                  className={`rounded-lg p-2 mb-1 ${account.id === email.selectedAccountId ? "bg-[#2a2a2a]" : "bg-transparent"}`}
                  onPress={() => email.setSelectedAccountId(account.id)}
                >
                  <Text className="text-[#ececec] text-[12px]" numberOfLines={1}>
                    {account.displayName || account.emailAddress}
                  </Text>
                  <Text className="text-[#9c9c9c] text-[11px]">{account.provider} • {account.status}</Text>
                  <Pressable className="mt-2 self-start px-2 py-1 rounded bg-[#282828]" onPress={() => email.disconnect(account.id)}>
                    <Text className="text-[#f0adad] text-[10px]">Disconnect</Text>
                  </Pressable>
                </Pressable>
              ))}
            </ScrollView>

            <Text className="text-[#d9d9d9] text-[13px] mt-3 mb-2">Folders</Text>
            <ScrollView className="min-h-0">
              {email.folders.map((folder) => (
                <Pressable
                  key={folder.id}
                  className={`rounded-lg px-2 py-1.5 mb-1 ${folder.id === email.selectedFolderId ? "bg-[#2a2a2a]" : "bg-transparent"}`}
                  onPress={() => email.setSelectedFolderId(folder.id)}
                >
                  <Text className="text-[#d7d7d7] text-[12px]" numberOfLines={1}>
                    {folder.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View className="w-[30%] rounded-xl bg-[#171717] p-3 min-h-0">
            <Text className="text-[#d9d9d9] text-[13px] mb-2">Threads</Text>
            <ScrollView className="min-h-0">
              {email.threads.map((thread) => (
                <Pressable
                  key={thread.id}
                  className={`rounded-lg p-2 mb-1 border ${thread.id === email.selectedThreadId ? "bg-[#2a2a2a] border-[#3a3a3a]" : "bg-transparent border-transparent"}`}
                  onPress={() => email.setSelectedThreadId(thread.id)}
                >
                  <Text className={`text-[12px] ${thread.isUnread ? "text-[#f0f0f0]" : "text-[#c5c5c5]"}`} numberOfLines={1}>
                    {thread.subject || "(No subject)"}
                  </Text>
                  <Text className="text-[#9d9d9d] text-[11px]" numberOfLines={1}>
                    {thread.fromName || thread.fromEmail || "Unknown sender"}
                  </Text>
                  <Text className="text-[#8e8e8e] text-[11px]" numberOfLines={2}>
                    {thread.snippet || ""}
                  </Text>
                </Pressable>
              ))}
              {email.threadsCursor ? (
                <Pressable className="px-2 py-2 rounded-lg bg-[#202020]" onPress={email.loadMoreThreads}>
                  <Text className="text-[#d8d8d8] text-[12px]">Load more</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>

          <View className="flex-1 rounded-xl bg-[#171717] p-3 min-h-0">
            <Text className="text-[#d9d9d9] text-[13px] mb-2">{email.selectedThread?.subject || "Thread"}</Text>
            <ScrollView className="min-h-0 max-h-[45%]">
              {selectedMessages.map((message) => (
                <View key={message.id} className="rounded-lg border border-[#272727] p-2 mb-2">
                  <Text className="text-[#ececec] text-[12px]" numberOfLines={1}>
                    {message.from?.name || message.from?.email || "Unknown"}
                  </Text>
                  <Text className="text-[#8f8f8f] text-[11px] mb-1">{message.sentAt || ""}</Text>
                  <Text className="text-[#c9c9c9] text-[12px]">{message.bodyText || "(HTML message)"}</Text>
                </View>
              ))}
            </ScrollView>

            <View className="mt-3 border-t border-[#262626] pt-3">
              <Text className="text-[#d9d9d9] text-[13px] mb-2">Compose</Text>
              <TextInput
                className="h-9 px-2 rounded-md bg-[#111111] text-[#e8e8e8] text-[12px] mb-2"
                placeholder="To: email1@example.com,email2@example.com"
                placeholderTextColor="#7f7f7f"
                value={email.composeDraft.to}
                onChangeText={(value: string) => email.setComposeDraft((current) => ({ ...current, to: value }))}
              />
              <TextInput
                className="h-9 px-2 rounded-md bg-[#111111] text-[#e8e8e8] text-[12px] mb-2"
                placeholder="Cc"
                placeholderTextColor="#7f7f7f"
                value={email.composeDraft.cc}
                onChangeText={(value: string) => email.setComposeDraft((current) => ({ ...current, cc: value }))}
              />
              <TextInput
                className="h-9 px-2 rounded-md bg-[#111111] text-[#e8e8e8] text-[12px] mb-2"
                placeholder="Bcc"
                placeholderTextColor="#7f7f7f"
                value={email.composeDraft.bcc}
                onChangeText={(value: string) => email.setComposeDraft((current) => ({ ...current, bcc: value }))}
              />
              <TextInput
                className="h-9 px-2 rounded-md bg-[#111111] text-[#e8e8e8] text-[12px] mb-2"
                placeholder="Subject"
                placeholderTextColor="#7f7f7f"
                value={email.composeDraft.subject}
                onChangeText={(value: string) => email.setComposeDraft((current) => ({ ...current, subject: value }))}
              />
              <TextInput
                className="min-h-[120px] px-2 py-2 rounded-md bg-[#111111] text-[#e8e8e8] text-[12px] mb-2"
                multiline
                textAlignVertical="top"
                placeholder="Message"
                placeholderTextColor="#7f7f7f"
                value={email.composeDraft.bodyText}
                onChangeText={(value: string) => email.setComposeDraft((current) => ({ ...current, bodyText: value }))}
              />
              <Pressable className="self-start px-4 py-2 rounded-lg bg-[#2a2a2a]" onPress={email.send}>
                <Text className="text-[#ececec] text-[12px]">{email.sending ? "Sending..." : "Send"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <Modal transparent visible={connectOpen} animationType="fade" onRequestClose={() => setConnectOpen(false)}>
        <Pressable className="flex-1 bg-[#000000aa] items-center justify-center" onPress={() => setConnectOpen(false)}>
          <Pressable className="w-[760px] max-w-[95%] max-h-[92%] rounded-xl bg-[#151515] p-4" onPress={() => {}}>
            <Text className="text-[#ececec] text-[16px] mb-3">Connect Email Account</Text>
            {oauthError ? (
              <Text className="text-[#ff9b9b] text-[12px] mb-2">{oauthError}</Text>
            ) : null}
            <View className="flex-row items-center gap-2 mb-4">
              <ProviderButton label="Gmail" onPress={() => void connectOAuth("gmail")} />
              <ProviderButton label="Outlook" onPress={() => void connectOAuth("outlook")} />
              <ProviderButton label="Apple" onPress={() => void connectOAuth("apple")} />
            </View>

            <Text className="text-[#cfcfcf] text-[13px] mb-2">Custom SMTP/IMAP/POP3</Text>
            <ScrollView>
              <View className="flex-row gap-2 mb-2">
                <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="Email" placeholderTextColor="#787878" value={customEmail} onChangeText={setCustomEmail} />
                <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="Display name" placeholderTextColor="#787878" value={customDisplayName} onChangeText={setCustomDisplayName} />
              </View>

              <View className="flex-row gap-2 mb-2">
                <Pressable className={`px-3 py-2 rounded-lg ${customMode === "smtp_imap" ? "bg-[#2d2d2d]" : "bg-[#1d1d1d]"}`} onPress={() => setCustomMode("smtp_imap")}>
                  <Text className="text-[#dfdfdf] text-[12px]">SMTP + IMAP</Text>
                </Pressable>
                <Pressable className={`px-3 py-2 rounded-lg ${customMode === "smtp_pop3" ? "bg-[#2d2d2d]" : "bg-[#1d1d1d]"}`} onPress={() => setCustomMode("smtp_pop3")}>
                  <Text className="text-[#dfdfdf] text-[12px]">SMTP + POP3</Text>
                </Pressable>
              </View>

              <Text className="text-[#bfbfbf] text-[12px] mb-1">SMTP</Text>
              <View className="flex-row gap-2 mb-2">
                <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="SMTP host" placeholderTextColor="#787878" value={customSmtpHost} onChangeText={setCustomSmtpHost} />
                <TextInput className="w-[110px] h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="Port" placeholderTextColor="#787878" value={customSmtpPort} onChangeText={setCustomSmtpPort} keyboardType="numeric" />
              </View>
              <View className="flex-row gap-2 mb-2">
                <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="SMTP username" placeholderTextColor="#787878" value={customSmtpUsername} onChangeText={setCustomSmtpUsername} />
                <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="SMTP password" placeholderTextColor="#787878" secureTextEntry value={customSmtpPassword} onChangeText={setCustomSmtpPassword} />
              </View>

              {customMode === "smtp_imap" ? (
                <>
                  <Text className="text-[#bfbfbf] text-[12px] mb-1">IMAP</Text>
                  <View className="flex-row gap-2 mb-2">
                    <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="IMAP host" placeholderTextColor="#787878" value={customImapHost} onChangeText={setCustomImapHost} />
                    <TextInput className="w-[110px] h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="Port" placeholderTextColor="#787878" value={customImapPort} onChangeText={setCustomImapPort} keyboardType="numeric" />
                  </View>
                  <View className="flex-row gap-2 mb-2">
                    <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="IMAP username" placeholderTextColor="#787878" value={customImapUsername} onChangeText={setCustomImapUsername} />
                    <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="IMAP password" placeholderTextColor="#787878" secureTextEntry value={customImapPassword} onChangeText={setCustomImapPassword} />
                  </View>
                </>
              ) : (
                <>
                  <Text className="text-[#bfbfbf] text-[12px] mb-1">POP3</Text>
                  <View className="flex-row gap-2 mb-2">
                    <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="POP3 host" placeholderTextColor="#787878" value={customPop3Host} onChangeText={setCustomPop3Host} />
                    <TextInput className="w-[110px] h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="Port" placeholderTextColor="#787878" value={customPop3Port} onChangeText={setCustomPop3Port} keyboardType="numeric" />
                  </View>
                  <View className="flex-row gap-2 mb-2">
                    <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="POP3 username" placeholderTextColor="#787878" value={customPop3Username} onChangeText={setCustomPop3Username} />
                    <TextInput className="flex-1 h-9 px-2 rounded-md bg-[#0f0f0f] text-[#e8e8e8] text-[12px]" placeholder="POP3 password" placeholderTextColor="#787878" secureTextEntry value={customPop3Password} onChangeText={setCustomPop3Password} />
                  </View>
                </>
              )}
            </ScrollView>

            <View className="flex-row justify-end mt-3 gap-2">
              <Pressable className="px-3 py-2 rounded-lg bg-[#202020]" onPress={() => setConnectOpen(false)}>
                <Text className="text-[#d2d2d2] text-[12px]">Cancel</Text>
              </Pressable>
              <Pressable className="px-3 py-2 rounded-lg bg-[#2d2d2d]" onPress={() => void connectCustom()}>
                <Text className="text-[#ededed] text-[12px]">Connect custom</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
