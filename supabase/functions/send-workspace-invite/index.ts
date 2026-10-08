import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

import { appOrigin, workspaceInviteUrl } from '../_shared/app-origin.ts'
import { parseJsonBody, workspaceInviteWebhookBodySchema } from '../_shared/contracts/http-bodies.ts'
import { singleLine } from '../_shared/escape.ts'
import { getDefaultSecretKey } from '../_shared/secret-keys.ts'
import { buildHtml, inviteSubject } from './email.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Moduo <noreply@moduo.app>'
// The signed-in app, not the marketing site: /join only exists on the app hosts.
const APP_ORIGIN = appOrigin(Deno.env.get('APP_URL'))
const WEBHOOK_SECRET = Deno.env.get('WORKSPACE_INVITE_WEBHOOK_SECRET') ?? ''

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  getDefaultSecretKey(),
)

Deno.serve(async (req: Request) => {
  if (!WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Webhook authentication is not configured' }), { status: 503 })
  }
  const sig = req.headers.get('x-webhook-secret') ?? ''
  if (sig !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 })
  }
  const parsed = parseJsonBody(workspaceInviteWebhookBodySchema, json)
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 })
  }
  const token = (parsed.data.record?.token ?? parsed.data.token ?? '').trim()
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

  const workspaceName = singleLine(workspace?.name ?? '') || 'a workspace'
  const inviterName = singleLine(inviterProfile?.display_name ?? '') || 'Someone'

  const acceptUrl = workspaceInviteUrl(APP_ORIGIN, token)

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
      subject: inviteSubject({ inviterName, workspaceName }),
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
