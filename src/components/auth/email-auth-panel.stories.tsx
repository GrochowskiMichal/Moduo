import type { Meta, StoryObj } from "@storybook/react";
import { useContext } from "react";

import type { ModuoRuntime } from "@/lib/runtime";
import { AuthContext } from "@/providers/auth-provider";

import { EmailAuthPanel } from "./email-auth-panel";

// The shared preview mock has no runtime, which leaves the panel on its loading
// step. A cloud-auth stub puts it on the email step, where the notice shows.
const cloudRuntime = {
  capabilities: { hasLocalMnemonic: false },
  auth: { sendOtp: async () => ({ data: {}, error: null }) },
} as unknown as ModuoRuntime;

function WithCloudRuntime({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext);
  return (
    <AuthContext.Provider value={{ ...auth, isSignedIn: false, runtime: cloudRuntime }}>
      {children}
    </AuthContext.Provider>
  );
}

const meta: Meta<typeof EmailAuthPanel> = {
  title: "Components/auth/email-auth-panel",
  component: EmailAuthPanel,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <WithCloudRuntime>
        <div className="flex min-h-screen items-center justify-center bg-background px-5 py-8">
          <div className="w-full max-w-[480px] rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
            <Story />
          </div>
        </div>
      </WithCloudRuntime>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

/** After an emailed auth link was dropped at boot (src/lib/auth-url.ts). */
export const WithLinkNotice: Story = {
  args: { notice: "Links don't sign you in here. Enter your email to get a 6-digit code." },
};
