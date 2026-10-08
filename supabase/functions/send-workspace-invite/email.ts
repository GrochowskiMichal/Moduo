// The invite email itself. Kept out of index.ts so the escaping is unit-tested.
// inviterName and workspaceName are typed by users: every value goes through
// singleLine (subject) or escapeHtml (body) before it is interpolated.

import { escapeHtml, singleLine } from '../_shared/escape.ts'

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function inviteSubject(opts: { inviterName: string; workspaceName: string }): string {
  return `${singleLine(opts.inviterName)} invited you to join "${singleLine(opts.workspaceName)}" on Moduo`
}

export function buildHtml(opts: {
  inviterName: string
  workspaceName: string
  acceptUrl: string
  expiresAt: string
}): string {
  const inviterName = escapeHtml(singleLine(opts.inviterName))
  const workspaceName = escapeHtml(singleLine(opts.workspaceName))
  const acceptUrl = escapeHtml(opts.acceptUrl)
  const expires = escapeHtml(formatDate(opts.expiresAt))
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Workspace Invitation</title>
</head>
<body style="margin:0;padding:0;background:#0e0e0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0e;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;">
          <tr><td style="padding-bottom:28px;"><span style="font-size:20px;font-weight:700;color:#e0e0e0;letter-spacing:-0.5px;">moduo</span></td></tr>
          <tr>
            <td style="background:#141414;border:1px solid #222;border-radius:16px;padding:32px;">
              <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#e8e8e8;">You're invited</p>
              <p style="margin:0 0 28px;font-size:13px;color:#666;">${inviterName} has invited you to join a workspace on Moduo.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;vertical-align:top;"><span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Workspace</span></td>
                  <td style="padding:6px 0 6px 16px;vertical-align:top;text-align:right;"><span style="font-size:13px;color:#c0c0c0;">${workspaceName}</span></td>
                </tr>
                <tr>
                  <td style="padding:6px 0;vertical-align:top;"><span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Invited by</span></td>
                  <td style="padding:6px 0 6px 16px;vertical-align:top;text-align:right;"><span style="font-size:13px;color:#c0c0c0;">${inviterName}</span></td>
                </tr>
                <tr>
                  <td style="padding:6px 0;vertical-align:top;"><span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Expires</span></td>
                  <td style="padding:6px 0 6px 16px;vertical-align:top;text-align:right;"><span style="font-size:13px;color:#c0c0c0;">${expires}</span></td>
                </tr>
              </table>
              <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
              <p style="margin:0 0 16px;font-size:13px;color:#888;">Click the button below to accept and open Moduo.</p>
              <a href="${acceptUrl}" style="display:inline-block;background:#1a1a1a;border:1px solid #333;color:#e0e0e0;text-decoration:none;border-radius:10px;padding:14px 28px;font-size:14px;font-weight:600;">Accept invitation →</a>
              <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
              <p style="margin:0;font-size:11px;color:#444;">If you weren't expecting this invitation you can safely ignore this email.</p>
            </td>
          </tr>
          <tr><td style="padding-top:24px;text-align:center;"><p style="margin:0;font-size:11px;color:#444;">Powered by <a href="https://moduo.app" style="color:#666;text-decoration:none;">Moduo</a></p></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
