import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Image, Text, View } from "../../tw";
import { useAuth } from "../../providers/auth-provider";
import { EmailAuthPanel } from "../../components/auth/email-auth-panel";
import authAiHero from "../../../assets/image.jpg";

export function AuthPage() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isSignedIn) {
      void navigate({ to: "/" });
    }
  }, [isSignedIn, navigate]);

  return (
    <View className="relative min-h-screen overflow-hidden bg-[#111111]">
      <View className="relative mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-1 bg-[#111111] lg:grid-cols-[1.1fr_0.9fr]">
        <View className="hidden bg-[#111111] p-8 lg:flex">
          <View className="relative w-full rounded-[34px] bg-[linear-gradient(145deg,rgba(255,255,255,0.12)_0%,rgba(255,255,255,0.03)_24%,rgba(255,255,255,0.02)_76%,rgba(255,255,255,0.09)_100%)] p-[1px] shadow-[0_16px_34px_rgba(0,0,0,0.42),0_2px_10px_rgba(0,0,0,0.3)]">
            <View className="pointer-events-none absolute -inset-[1px] rounded-[35px] border border-[#ffffff1f]" />
            <View className="relative h-full overflow-hidden rounded-[33px] border border-[#2b343f] bg-[#0b0c10] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-18px_48px_rgba(0,0,0,0.35)]">
              <Image source={authAiHero} contentFit="cover" className="absolute inset-0 h-full w-full scale-[1.02] auth-hero-float" />
              <View className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,6,8,0.42)_0%,rgba(5,6,8,0.74)_50%,rgba(5,6,8,0.95)_100%)]" />
              <View className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_42%)]" />

              <View className="relative flex h-full items-end p-8">
                <View className="mt-auto space-y-5">
                  <Text as="div" className="auth-hero-title max-w-[560px] text-[50px] font-semibold leading-[1.03] tracking-[-0.03em] text-[#f0f0f0]">
                    Built for the way YOUR brain works. Not Ours.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <View className="auth-right relative flex min-h-screen items-center justify-center bg-[#111111] px-4 py-10 sm:px-8 lg:px-12">
          <EmailAuthPanel />
        </View>
      </View>
    </View>
  );
}
