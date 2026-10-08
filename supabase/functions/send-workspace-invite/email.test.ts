import { describe, expect, it } from "@rstest/core";

import { appOrigin, workspaceInviteUrl } from "../_shared/app-origin.ts";
import { buildHtml, inviteSubject } from "./email.ts";

const base = {
  inviterName: "Ana",
  workspaceName: "Studio",
  acceptUrl: workspaceInviteUrl(appOrigin(undefined), "tok+/="),
  expiresAt: "2026-10-14T12:00:00.000Z",
};

describe("invite email", () => {
  it("links to /join?invite= on the app origin", () => {
    expect(buildHtml(base)).toContain('href="https://app.moduo.app/join?invite=tok%2B%2F%3D"');
  });

  it("escapes user-typed names in the body", () => {
    const html = buildHtml({
      ...base,
      inviterName: '<img src=x onerror="alert(1)">',
      workspaceName: '</span><a href="https://evil.example">Verify your account</a>',
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;/span&gt;&lt;a href=&quot;https://evil.example&quot;&gt;");
  });

  it("keeps the accept link inside its attribute", () => {
    const html = buildHtml({ ...base, acceptUrl: 'https://app.moduo.app/join?invite=a"onclick="x' });
    expect(html).not.toContain('"onclick="');
    expect(html).toContain("invite=a&quot;onclick=&quot;x");
  });

  it("keeps the subject on one line", () => {
    const subject = inviteSubject({
      inviterName: "Eve\r\nBcc: victim@example.com",
      workspaceName: "Team\nHQ",
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('Eve Bcc: victim@example.com invited you to join "Team HQ" on Moduo');
  });
});
