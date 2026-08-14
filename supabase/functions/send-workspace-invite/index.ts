import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { getDefaultSecretKey } from '../_shared/secret-keys.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Moduo <noreply@moduo.app>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://moduo.app'
const WEBHOOK_SECRET = Deno.env.get('WORKSPACE_INVITE_WEBHOOK_SECRET') ?? ''

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  getDefaultSecretKey(),
)

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function buildHtml(opts: {
  inviterName: string
  workspaceName: string
  acceptUrl: string
  expiresAt: string
}): string {
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
              <p style="margin:0 0 28px;font-size:13px;color:#666;">${opts.inviterName} has invited you to join a workspace on Moduo.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:6px 0;vertical-align:top;"><span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Workspace</span></td>
                  <td style="padding:6px 0 6px 16px;vertical-align:top;text-align:right;"><span style="font-size:13px;color:#c0c0c0;">${opts.workspaceName}</span></td>
                </tr>
                <tr>
                  <td style="padding:6px 0;vertical-align:top;"><span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Invited by</span></td>
                  <td style="padding:6px 0 6px 16px;vertical-align:top;text-align:right;"><span style="font-size:13px;color:#c0c0c0;">${opts.inviterName}</span></td>
                </tr>
                <tr>
                  <td style="padding:6px 0;vertical-align:top;"><span style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Expires</span></td>
                  <td style="padding:6px 0 6px 16px;vertical-align:top;text-align:right;"><span style="font-size:13px;color:#c0c0c0;">${formatDate(opts.expiresAt)}</span></td>
                </tr>
              </table>
              <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
              <p style="margin:0 0 16px;font-size:13px;color:#888;">Click the button below to accept and open Moduo.</p>
              <a href="${opts.acceptUrl}" style="display:inline-block;background:#1a1a1a;border:1px solid #333;color:#e0e0e0;text-decoration:none;border-radius:10px;padding:14px 28px;font-size:14px;font-weight:600;">Accept invitation →</a>
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

Deno.serve(async (req: Request) => {
  if (!WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Webhook authentication is not configured' }), { status: 503 })
  }
  const sig = req.headers.get('x-webhook-secret') ?? ''
  if (sig !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let body: { record?: { token?: string }; token?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 })
  }

  const token = (body.record?.token ?? body.token ?? '').trim()
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token' }), { status: 400 })
  }

  // Look up invite
  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from('workspace_invites')
    .select('id, status, expires_at, email, workspace_id, created_by')
    .eq('token', token)
    .single()

  if (inviteErr || !invite) {
    return new Response(JSON.stringify({ error: 'Invite not found' }), { status: 404 })
  }
  if (invite.status !== 'pending') {
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 })
  }
  if (new Date(invite.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: 'Invite expired' }), { status: 410 })
  }

  const [{ data: workspace }, { data: inviterProfile }] = await Promise.all([
    supabaseAdmin.from('workspaces').select('name').eq('id', invite.workspace_id).single(),
    invite.created_by
      ? supabaseAdmin.from('profiles').select('display_name').eq('id', invite.created_by).single()
      : Promise.resolve({ data: null }),
  ])

  const workspaceName = workspace?.name ?? 'a workspace'
  const inviterName =
    inviterProfile?.display_name?.trim() || 'Someone'

  const acceptUrl = `${SITE_URL}/workspace/join?token=${encodeURIComponent(token)}`

  const html = buildHtml({ inviterName, workspaceName, acceptUrl, expiresAt: invite.expires_at })

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: invite.email,
      subject: `${inviterName} invited you to join "${workspaceName}" on Moduo`,
      html,
    }),
  })

  if (!sendRes.ok) {
    const err = await sendRes.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: 'Failed to send email', detail: err }), { status: 502 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
