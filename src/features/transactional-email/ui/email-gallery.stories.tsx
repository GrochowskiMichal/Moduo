import { BUILT_EMAIL_KINDS, type BuiltEmailKind, renderTemplate } from "@email/index";
import { EMAIL_FIXTURES, EMAIL_LABELS } from "@email/templates/fixtures";
import type { Meta, StoryObj } from "@storybook/react";

import { EmailPreview, type EmailPreviewMode } from "./email-preview";

/**
 * Every built transactional email (specs/transactional-email.md), rendered by
 * the same kit the Edge Functions send with. The ratified copy and look are in
 * `.design/transactional-email/email-set.html`; this is the real output to
 * check against it. The logo shows as a broken image until the brand
 * pipeline's (BRAND-1) PNGs are deployed to app.moduo.app/email: until then
 * that URL answers with the app's HTML page, not a 404.
 */

function Preview({ kind, mode }: { kind: BuiltEmailKind; mode: EmailPreviewMode }) {
  const email = renderTemplate(kind, EMAIL_FIXTURES[kind], {
    // Force the look, so the light preview stays light in a dark Storybook.
    colorScheme: mode === "dark" ? "dark" : "light",
  });
  return (
    <EmailPreview
      title={`${EMAIL_LABELS[kind]} · ${email.subject}`}
      html={email.html}
      text={email.text}
      mode={mode}
    />
  );
}

const meta: Meta<typeof Preview> = {
  title: "Email/Transactional emails",
  component: Preview,
  args: { kind: BUILT_EMAIL_KINDS[0], mode: "light" },
  argTypes: {
    kind: { control: "select", options: BUILT_EMAIL_KINDS },
    mode: { control: "inline-radio", options: ["light", "dark", "text"] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** One email; pick it and the mode in the controls. */
export const Single: Story = {};

/** Every built email in light, dark and plain text, side by side. */
export const Gallery: Story = {
  render: () => (
    <div className="flex flex-col gap-12">
      {BUILT_EMAIL_KINDS.map((kind) => (
        <section key={kind} className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Preview kind={kind} mode="light" />
          <Preview kind={kind} mode="dark" />
          <Preview kind={kind} mode="text" />
        </section>
      ))}
    </div>
  ),
};
