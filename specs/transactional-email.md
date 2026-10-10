# Spec: Transactional email (every email Moduo sends)

> Status: **In progress — TX-1 done 2026-10-08; TX-2 built and merged into maciej 2026-10-08 (PR #310), going live per [docs/email-runbook.md](../docs/email-runbook.md) once the app promotion puts the logo files on app.moduo.app and the policy lines (PR #319) are on moduo.app; TX-3 built and live 2026-10-09 (PR #321: worker + webhook deployed, migration applied, outbox test sent); the Resend webhook is Maciej's runbook §TX-3 step 4** · Owner: maciej · Planned 2026-10-07/08 (`/s1`, session "[Platform] Transactional email system plan")
> **The ratified copy and look of every email is [`.design/transactional-email/email-set.html`](../.design/transactional-email/email-set.html)** (open it in a browser; also published as the private artifact "Moduo email set"). It is the source of truth for subjects, preheaders, body copy, footers and the shell. This spec is the execution contract: behavior, triggers, data, acceptance criteria, tests and blocks. Do not restate or re-word the copy here; if a block needs a copy change, change the HTML file and say so in the block report.

## Scope

Moduo sends emails from five unrelated places today (Supabase Auth through Mike's Hostinger mailbox, three hand-rolled Resend `fetch`es, Google Calendar, Stripe), with no shared look, no log, no retries, two broken links, one silently failing trigger and promises on the landing page and in the privacy policy that nothing fulfils (the waitlist invite, the build-updates confirmation, invite emails). This spec replaces all of Moduo's own sending with **one system**: one template kit, one sender (Resend), one outbox that logs, retries, schedules and de-duplicates, and 21 designed emails across account, getting in, bookings, trial/welcome and announcements. It also delivers the product pieces those emails need: invite-only by allow-list (so invitees sign in with the normal code on web *and* desktop), waitlist invites from the Supabase dashboard, booking reminders and host-side cancellation, email preferences, founder access grants and build-update subscriptions.

**Why now:** sign-in codes are capped at 30 per hour for all of Moduo and depend on one person's mailbox password, and there is no way to send the waitlist invite at all. TX-1 → TX-4 are the gate for inviting the first people from the waitlist (Q57).

## What exists today (audit, 2026-10-07/08)

| Email | Today | Problem |
| --- | --- | --- |
| Sign-in code | Supabase Auth, custom SMTP `smtp.hostinger.com:587` logged in as `mike@moduo.app`, shown as "Moduo &lt;hello@moduo.app&gt;"; Supabase's stock template edited to include the 6-digit code; `rate_limit.email_sent = 30`/h project-wide; `max_frequency = 1m`; OTP expiry 1 h (default); `enable_signup = false` | 30/h cap, single mailbox dependency, template only in the dashboard. The repo docs (`BUILD_ORDER` /s1 ALPHA, HANDOFF) wrongly say "Supabase's default sender". |
| Dashboard invite ("Add user → Send invitation") | Supabase template, link to Site URL `https://app.moduo.app` | Link can't open the desktop app; a separate lane from the waitlist. |
| Workspace invite | Prod trigger `on_workspace_invite_inserted` → `trigger_send_workspace_invite()` → `net.http_post` to `send-workspace-invite` **without** the `x-webhook-secret` header; `WORKSPACE_INVITE_WEBHOOK_SECRET` is not set, so the function answers 503 every time. The trigger is in no migration. | Every invite email silently fails; link would be `moduo.app/workspace/join?token=` (wrong host, path and param); names unescaped. UI shows copy-link only. Privacy policy says we email invites. |
| Booking confirmation (guest) | `booking-public` `sendGuestEmail`, 4 lines of plain text, `noreply@` | Cancel link built from the request `origin` (fixed by PR #250, merged 2026-10-08); no host email, no bell, no cancel emails, Zoom-only extra guests get nothing, booking page promises a calendar invite on Zoom-only links. |
| Founder coupon | `issue-founder-coupon` (admin): forever-free Pro promo code, amber HTML, 🚀 subject, link to a missing `#pricing` anchor | Off-brand; a different product from "support founders for some time". |
| Waitlist | Nothing sent. 4 pending rows in prod. `updates_requested` stored without confirmation. | Landing promises "One email when your invite is ready"; policy promises a confirmation before the first build update. |
| Google Calendar | Invites/cancellations from the host's Google identity (`sendUpdates=all`) | Not ours; stays. |
| Stripe | Whatever the Stripe dashboard sends | Not ours; configured at paid launch (Q45). |

Infra facts: DNS for `moduo.app` is Vercel DNS; MX is Hostinger; `resend._domainkey.moduo.app` and `send.moduo.app` (SES eu-west-1) exist, so **`moduo.app` is already a verified Resend domain sending from Ireland**; DMARC `p=none`. Prod has `pg_cron` (only job: `stripe-sync-worker` every minute), `pg_net`, `pgmq` and Vault installed. 7 auth users. Edge Function secrets include `RESEND_API_KEY`, `RESEND_FROM`, `SITE_URL`.

## Ratified designer calls (2026-10-07/08)

Round 1 Q1–Q58 and round 2 S1–S3, F1–F2, R1–R5, the newsletter address and the Q17 reading were all accepted **as recommended**, with these specifics:

- **Sender:** "Moduo &lt;hello@moduo.app&gt;" for everything; replies reach hello@ (a real Hostinger mailbox). Build updates only: "Moduo &lt;updates@news.moduo.app&gt;", reply-to hello@. Booking emails to guests: "&lt;Host name&gt; via Moduo &lt;hello@moduo.app&gt;", reply-to the host; host emails reply-to the guest; workspace invites "&lt;Inviter&gt; via Moduo", reply-to the inviter.
- **Voice:** system emails unsigned; invite, welcome and founder emails signed "Maciej & Mike". English only, built for later localisation. Footer: one "why you got this" line + "Moduo · Ringdove sp. z o.o., Fatimska 41A/310, 31-831 Kraków, Poland" + Privacy (+ Notification settings / Unsubscribe where they apply).
- **Look:** light, monochrome, switching to dark where the mail app supports it; the drawn Moduo lockup top-left as one image (host's face on guest booking emails, with "Scheduled with Moduo" in the footer — brand brief §13); ≤1 near-black button; text-first single column; visual references to the app (Geist, the code box, small-caps labels, the booking sentence with underlined fixed words). Dates day-month, 24-hour ("Friday 16 October at 14:00"); booking emails in the zone the guest saw, named ("Warsaw time"). **Brand brief deltas (2026-10-08, `.design/brand/BRAND_BRIEF.md` §7, §9, §11, §13):** dark canvas is Reading black `oklch(0.2 0 0)`; copy is American English ("canceled") and avoids the banned words (just, simply, easy, please…); the example cast is Tom Becker, Anna Carter, Northwind Studio.
- **Sign-in code:** code in the subject; works 10 minutes, once; 60-second resend countdown; code only, no link; same email for a first sign-in; "Didn't ask for this?" line.
- **Getting in:** no waitlist-join email; invites sent **from the Supabase dashboard** (Q17), FCFS by default, ≤50 per batch, never expire, no reminder; no friend referrals; a workspace invite lets a brand-new person in (Q26) **only for the invited address** (S1); owners/admins only, ≤20 per workspace per day (S2); a deleted account needs a new invite (S3); workspace invites expire after 7 days (already the DB default); accept → bell only for the inviter; email only for "you're now the owner" and "you were removed".
- **Bookings:** host email + bell on every booking (toggle); guest confirmation always; .ics only when Google isn't inviting; extra guests get a confirmation when Google isn't inviting them; cancels notify both ways; host cancel → guest email with "Pick another time" even when Google also notifies; **reminders are a per-link setting** Off / 1 h / 24 h, default 24 h (Q36, matching Calendly/Cal.com/SavvyCal); fix the Zoom-only copy.
- **Trial:** trials run in the beta (14 days Pro → Free, never charged); welcome note; "trial ends in 3 days"; **"trial ended" email: yes** (Q44); Stripe owns receipts; no plan-change emails.
- **Founder access (F1/F2):** a set time per founder (default 12 months), on Pro, Duo or Team, switched on directly, no code, no card. Replaces the forever-free coupon.
- **Account:** "account deleted" email; no new-device alerts.
- **Announcements:** one template for policy/terms changes, beta ending, company handover; build updates: plumbing + template now, issues written later; users can opt in in Settings.
- **Not doing:** mentions/assignments by email (bell only; digest parked), chat/Meet emails (booking emails carry the Meet link when MEET-4 lands).
- **Settings:** an "Email" group with Bookings (on), Trial and billing reminders (on), Build updates (off); everything else always sends.
- **Order (Q56/Q57):** sign-in codes → waitlist invites (the gate) → bookings → workspace invites → welcome and trial → announcements and build updates.

## Product behavior & UX

### The catalog

IDs match the ratified HTML. "Stream" = which sender/reputation. "Off" = the switch that stops it (none = always sends).

| ID | Email | Trigger | To | Off | Block |
| --- | --- | --- | --- | --- | --- |
| A1 | Sign-in code | Code requested (web/desktop), incl. a new invitee's first sign-in | person signing in | — | TX-2 |
| A2 | Account deleted | `delete-account` finished with `status: "deleted"` | the deleted address | — | TX-8 |
| B1 | Waitlist invite | waitlist row set to `invited` (dashboard) | waitlist address | — | TX-4 |
| B2 | Build-updates confirmation | landing opt-in ticked | that address | — | TX-10 |
| B3 | Workspace invite | `workspace_invites` insert (owner/admin) | invited address | — | TX-7 |
| B4 | You're the owner now | `workspace_op_transfer_ownership` | new owner | — | TX-7 |
| B5 | Removed from a workspace | `workspace_op_remove_member` (not self-leave) | removed person | — | TX-7 |
| C1 | Booking confirmed (guest) | `book` succeeded | booker | — | TX-5 |
| C2 | Added to a booking | `book` with extra guests and no Google invite | each extra guest | — | TX-5 |
| C3 | New booking (host) | `book` succeeded | host | Bookings | TX-5 |
| C4 | Guest cancelled (host) | guest `cancel` | host | Bookings | TX-5 |
| C5 | You cancelled (guest) | guest `cancel` | booker | — | TX-5 |
| C6 | Host cancelled (guest) | host deletes the booked event in Moduo, or it disappears from the synced Google calendar | booker + extra guests | — | TX-6 |
| C7 | Meeting reminder | `start − link.guest_reminder_minutes` | booker + extra guests | per link | TX-6 |
| D1 | Welcome | 5 min after a user's first workspace is created | new user | — (once ever) | TX-9a |
| D2 | Trial ends in 3 days | 3 days before `trial_end`, no plan chosen | trial owner | Trial & billing | TX-9a |
| D3 | Trial ended | trial ends without a plan | trial owner | Trial & billing | TX-9a |
| D4 | Founder access | founder grant added (dashboard) | founder | — | TX-9b |
| D5 | Founder access ending | 14 days before grant end | founder | Trial & billing | TX-9b |
| E1 | Announcement | campaign sent by hand | all users (+ waitlist where relevant) | — (legal notices) | TX-10 |
| E2 | Build update | campaign sent by hand | confirmed subscribers | Unsubscribe / Settings | TX-10 |
| — | Ops alert (internal) | email failures (§T19) | hello@moduo.app | — | TX-3 |

### Flows

**1. Signing in (A1, TX-2/TX-4).** The person types their email → Moduo asks Supabase for a code → Supabase calls our hook → A1 lands within seconds. The screen says "Enter the six-digit code we sent. It works for 10 minutes." "Resend code" is disabled with "Resend in 0:59" counting down after each send. A wrong or expired code shows the existing error. After TX-4, an address that is not invited sees "Moduo is invite-only right now. Join the waitlist at moduo.app, or ask the person who invited you to use this address." No account, no email. If our sender fails, the screen says "We couldn't send your code. Try again in a minute." Existing users notice nothing except the new look.

**2. Inviting from the waitlist (B1, TX-4) — the dashboard procedure (Q17).**
- *One person:* Supabase → Table Editor → `waitlist` → set `status` to `invited` → save. B1 goes out within a minute. `invited_at` fills itself.
- *A batch, first come first served:* SQL editor → `select public.waitlist_invite_next(20);` (oldest pending first, max 50 per call; returns the invited addresses).
- *Someone not on the list:* `select public.waitlist_invite_email('name@example.com');` (adds them as source `manual` and invites).
- *Re-send:* `select public.waitlist_resend_invite('name@example.com');`.
- The invitee opens app.moduo.app (or the Mac app), types the address, gets A1, signs in, lands in onboarding. Their waitlist row is then deleted (the policy keeps it only "until you join"); a build-updates choice survives in `email_subscriptions`. Invited rows never used are deleted 12 months after `invited_at`.

**3. Workspace invites (B3, TX-7).** An owner/admin invites `tom@becker.studio` in Settings → Members and access. The panel still shows the copy-link; B3 also goes out (from "Anna Carter via Moduo", reply-to Anna). Tom clicks "Accept invite" → `app.moduo.app/join?invite=…`.
- Signed out: "You've been invited / Sign in to accept" → `/auth` → code → **straight into the workspace** (the pending join is honoured before onboarding; today it is lost). A brand-new Tom gets an account because the pending invite is on the allow-list.
- Signed in as another address: "This invite is for t•••@becker.studio. Sign in with that address to join." with a "Sign out" action.
- Expired/revoked: the existing "Invalid or expired invite".
- The 21st invite in 24 h from one workspace: "You've sent 20 invites today. You can send more tomorrow."
- Revoking a pending invite also removes that address's allow-list entry (it simply stops matching).

**4. Bookings (C1–C7, TX-5/TX-6).**
- *Book:* guest gets C1 (Google invite separately when Google is connected; a calendar file otherwise); extra guests get C2 only when Google isn't inviting them; host gets C3 + a bell line ("Tom Becker booked Intro call · Fri 16 Oct, 14:00"). The booking page's confirmation copy says what is actually coming (Google: "A calendar invite from Google and a short email with a way to cancel are on their way to {email}"; Zoom-only: "A short email with the details and a calendar file is on its way to {email}").
- *Guest cancels:* host gets C4 + bell ("Tom Becker canceled Intro call · Fri 16 Oct"); guest gets C5; Zoom-only recipients' emails carry a cancelling calendar file so the event leaves their calendar; any queued reminder is cancelled.
- *Host cancels:* host deletes the booked meeting in Moduo (native event), or cancels it in Google and the mirror sync removes it → the booking is released (slot opens), reminders are cancelled, and after **2 minutes** guests get C6. Undo in Moduo within those 2 minutes restores the booking and nothing is sent.
- *Meeting moved:* if the linked event's time changes (Google sync or a Moduo edit), the booking's time follows and the reminder moves with it. No "rescheduled" email in this spec (that is MEET-4's reschedule).
- *Reminder:* booking link editor → Limits → "Remind guests" (Off · 1 hour before · 24 hours before; new and existing links start at 24 hours). C7 goes to booker + extra guests; skipped if booked inside the window.

**5. Welcome and trial (D1–D3, TX-9a).** D1 five minutes after the first workspace (greeting uses the first word of the display name; no greeting line if empty). D2 three days before a no-card trial ends, unless a plan is active or trial reminders are off. D3 when a trial ends without a plan, never when it ended through account deletion. Onboarding says 14 days.

**6. Founder access (D4/D5, TX-9b).** Dashboard → `plan_grants` → add a row (email, plan `pro|duo|team`, `ends_at`, note; default Pro and 12 months). The address is allowed in (no waitlist needed), gets the plan from first sign-in (or at once if already a user), and gets D4. D5 14 days before the end. At the end the account moves to Free on its own. Settings → Billing reads "Pro, free until 8 October 2027".

**7. Account deleted (A2, TX-8).** After deletion succeeds, A2 goes out once (direct send, not queued), then every email record of the address is erased.

**8. Build updates and announcements (B2/E1/E2, TX-10).** Landing opt-in → B2 → the person opens `moduo.app/email` and presses "Yes, send me updates" → subscribed. Settings → Email → Build updates: on subscribes at once (verified address), off unsubscribes. Sending (dashboard): insert an `email_campaigns` row (kind `announcement` or `build_update`, subject, preheader, Markdown body, audience) → set `status = 'test'` (sends to hello@) → check the inbox → set `status = 'send'` → one email per recipient, exactly once. Build updates carry Unsubscribe (page + mail-app one-click).

**9. Settings → Preferences → Email (TX-8).** A new "Email" group next to "Notifications": Bookings — "When someone books or cancels on your links" (on); Trial and billing reminders (on); Build updates — "About once a month" (off). Switches save to the server, so another device or an older build never resets them.

### App changes that come with it

Sign-in countdown and copy (TX-2), invite-only message (TX-4), booking page copy (TX-5), booking link "Remind guests" select (TX-6), join page email-mismatch state + pending-join fix + daily cap message (TX-7), Settings Email group (TX-8), onboarding "14-day" (TX-9a), billing line for grants (TX-9b), privacy policy updates (TX-2, TX-8, TX-9b, TX-10).

## Edge cases

- **Hook down / Resend down:** A1 can't be sent → the screen's "couldn't send" message; the failure is logged; ops alert (§T19). Rollback = turn the Send Email Hook off in the dashboard (Hostinger SMTP config is kept untouched as the fallback).
- **Template bug in A1:** a plain-text fallback code email is sent instead (never block sign-in on design).
- **Code requested twice within a minute:** Supabase's `max_frequency` refuses; the countdown prevents it in the UI.
- **Typos on the waitlist / bounces:** hard bounce → address suppressed; the dashboard row keeps `status = invited`; re-inviting a suppressed address is refused with a notice in the SQL result.
- **Spam complaint:** suppresses everything except A1.
- **Same person on the waitlist and invited to a workspace:** either source allows sign-in; one account; waitlist row deleted at sign-up.
- **Invite email typo'd by the inviter:** only the inviter's name and workspace name leak; the link works only for that address (S1).
- **Invite link forwarded to a colleague:** they see the mismatch message; the inviter must invite them.
- **Invitee already a member:** the existing "You're already a member" message.
- **Workspace at its seat cap:** the existing RLS refusal ("There are no free seats on this plan…"); no email is queued.
- **Booking with an invalid time zone string:** falls back to the host's zone; the email names that zone; the booking never 500s after confirming.
- **Booking inside the reminder window:** no reminder.
- **Meeting already past and guest uses cancel link:** today allowed; keep, but send no emails for a cancel after the meeting started.
- **Host deletes a booked event and undoes within 2 minutes:** booking restored, C6 not sent; after 2 minutes the undo restores the event but the booking stays cancelled (the guest was told); the event then behaves as a normal event.
- **Google-connected host cancels in Google:** Google mails its cancellation; Moduo's sync removes the mirror → booking released → C6 after 2 min (rebooking link).
- **Collective links (hidden, `COLLECTIVE_LINKS_ENABLED = false`):** co-host notifications are not built here; PERM-8b owns them.
- **Trial ends while account is being deleted:** no D3 (cancellation comment "Moduo account deleted").
- **Founder grant for an address that is already paying in Stripe:** the higher tier wins (`recompute_entitlement`); D4 still sent; Stripe keeps billing (the grant doesn't cancel Stripe) — the D4 copy doesn't mention billing.
- **Grant ends while a Stripe subscription is active:** user keeps the Stripe tier; no D5 if a paid subscription is active.
- **Older app build writes preferences:** email switches are in their own server table, unaffected.
- **Two workers running at once:** rows are claimed with `FOR UPDATE SKIP LOCKED`; Resend gets the row's `Idempotency-Key`, so a crash between send and update never double-sends.
- **Campaign sent twice by mistake (status flipped back and forth):** per-recipient dedupe key `E:<campaign>:<email>` makes the second run a no-op.
- **Link scanners in corporate mail:** confirm and unsubscribe need a button press on the page (GET never changes anything); one-click unsubscribe uses the RFC 8058 POST that mail apps send.
- **Someone ticks build updates for another person's address:** that person gets one B2; ignoring it subscribes nobody.
- **Deleted account signs up again:** not on any allow-list source → invite-only message (S3).

## Acceptance criteria

**Kit (TX-1)**
- **AC1** — Every email renders from one shared shell matching the ratified HTML: header (the lockup image, or a host/workspace block), content blocks, at most one button, footer with the reason line, the Ringdove address and Privacy (+ Notification settings / Unsubscribe where they apply).
- **AC2** — Every email has a plain-text version produced from the same content, with every link written out in full.
- **AC3** — Names, workspace names, notes and any other user-supplied text are escaped and length-limited; a name containing HTML or a line break renders as plain text on one line, and a sender display name can't break the From header.
- **AC4** — Email colours come from one email palette derived from `src/styles/tokens.css`; changing a mirrored token without updating the palette fails the tests.
- **AC5** — Emails are light by default and switch to the dark palette (including a light logo) in mail apps that support dark mode.
- **AC6** — The designer can review every built email in Storybook in light, dark and plain text.

**Sign-in codes (TX-2)**
- **AC7** — Requesting a code on web or desktop delivers A1 from "Moduo &lt;hello@moduo.app&gt;" through Resend, subject "&lt;code&gt; is your Moduo code".
- **AC8** — A code works once, for 10 minutes; the email and the sign-in screen both say so.
- **AC9** — After each send, "Resend code" is disabled and shows a countdown from 60 seconds; rate-limit refusals never show Supabase's raw text.
- **AC10** — If the designed email fails to render, a plain-text code email still goes out; if sending fails, the screen shows "We couldn't send your code. Try again in a minute." and the failure is recorded.
- **AC11** — More than 30 people can receive codes within one hour.
- **AC12** — No stored record ever contains a sign-in code.
- **AC13** — Turning the hook off in the Supabase dashboard puts sign-in emails back on the previous path (documented and exercised once).

**Outbox (TX-3)**
- **AC14** — An email queued by any feature is sent within about a minute of becoming due, and never more than once per event, even if the worker runs twice or crashes mid-send.
- **AC15** — A scheduled email is sent within a minute of its time; a cancelled one is never sent.
- **AC16** — Temporary failures are retried with growing delays up to 5 attempts, then marked failed.
- **AC17** — After a hard bounce or spam complaint, no further email goes to that address except sign-in codes.
- **AC18** — Email records older than 30 days are deleted automatically.
- **AC19** — If any sign-in code fails, or 3 or more emails fail within 10 minutes, hello@ gets one alert email (at most one per 30 minutes).

**Gate + waitlist invite (TX-4)**
- **AC20** — An address that is invited (waitlist `invited`, a pending unexpired workspace invite, an active founder grant, or a founder) can sign in with a code and gets an account; any other address sees the invite-only message and no account or email is created.
- **AC21** — Setting a waitlist row to `invited` in the dashboard sends B1 exactly once; `waitlist_invite_next(n)` invites the n oldest pending rows (max 50); `waitlist_invite_email(addr)` invites an address not on the list; `waitlist_resend_invite(addr)` sends it again.
- **AC22** — When an invited person's account is created, their waitlist row is deleted and any build-updates choice is kept.
- **AC23** — Invited rows unused 12 months after `invited_at` are deleted.
- **AC24** — Existing users sign in exactly as before.

**Bookings (TX-5)**
- **AC25** — A booking sends C1 from "&lt;Host&gt; via Moduo", reply-to the host, with the time in the guest's zone and the zone named, the join button, the cancel link, the extra guests, and never the guest's note; a calendar file is attached only when Google isn't sending an invite.
- **AC26** — Extra guests get C2 with a calendar file only when Google isn't inviting them.
- **AC27** — The host gets C3 (reply-to the guest, host's zone, note and answers included) and a bell notification for the booking; C3 respects the Bookings switch once TX-8 lands (default on).
- **AC28** — A guest cancel sends C4 + a bell notification to the host and C5 to the guest; Zoom-only recipients get a cancelling calendar file; queued reminders are cancelled; no emails for a cancel after the meeting started.
- **AC29** — The booking page confirmation describes exactly what is on its way for Google-connected and Zoom-only links.
- **AC30** — An invalid time zone from the booking page no longer fails a confirmed booking; the host's zone is used and named.

**Reminders + host cancel (TX-6)**
- **AC31** — The booking link editor has "Remind guests: Off / 1 hour before / 24 hours before"; new and existing links start at 24 hours.
- **AC32** — C7 reaches the booker and extra guests at that time; it is skipped when booked inside the window, cancelled when the booking is cancelled, and moved when the meeting's time changes.
- **AC33** — When the host deletes a booked meeting in Moduo, or it is cancelled in Google and synced away, the booking is released, its slot opens, reminders are cancelled, and C6 goes to the guests 2 minutes later; undoing within those 2 minutes restores the booking and sends nothing.

**Workspace (TX-7)**
- **AC34** — Inviting someone sends B3 from "&lt;Inviter&gt; via Moduo", reply-to the inviter, with a working `app.moduo.app/join?invite=…` link; the copy link still shows.
- **AC35** — An invite only works for the address it was sent to; a different signed-in address sees "This invite is for t•••@becker.studio. Sign in with that address to join."
- **AC36** — A brand-new person can open the invite, sign in with a code and land in the workspace without being sent through onboarding first.
- **AC37** — Only owners and admins can invite, at most 20 per workspace per 24 hours; the next one shows "You've sent 20 invites today. You can send more tomorrow."
- **AC38** — Transferring ownership sends B4 to the new owner; removing a member sends B5 to them; leaving a workspace yourself sends nothing.
- **AC39** — The old invite function and its failing trigger are gone.

**Account + preferences (TX-8)**
- **AC40** — Settings → Preferences shows an "Email" group with Bookings (on), Trial and billing reminders (on) and Build updates (off); changes persist across devices and are never reset by an older build.
- **AC41** — Bookings off stops C3/C4; Trial and billing off stops D2/D3/D5; neither stops an always-send email.
- **AC42** — Turning Build updates on in Settings subscribes immediately with no confirmation email; off unsubscribes.
- **AC43** — After a successful account deletion, A2 is sent once, then the address is removed from the email log, subscriptions, suppressions and preferences.

**Welcome + trial (TX-9a)**
- **AC44** — D1 is sent about 5 minutes after a user's first workspace is created, once ever; it greets by first name, or has no greeting line when the name is empty.
- **AC45** — D2 is sent once, about 3 days before a no-card trial ends, unless a plan is active or trial reminders are off.
- **AC46** — D3 is sent once when a trial ends without a plan, and never when the trial ended because the account was deleted.
- **AC47** — Onboarding says "14-day trial".

**Founder access (TX-9b)**
- **AC48** — Adding a `plan_grants` row (default Pro, 12 months) lets that address in without a waitlist invite, gives it the plan from first sign-in (or at once if it's already a user), and sends D4 once.
- **AC49** — 14 days before the end D5 is sent unless a paid plan is active; at the end the account moves to Free on its own.
- **AC50** — Settings → Billing reads "&lt;Plan&gt;, free until &lt;date&gt;" for a grant.
- **AC51** — The coupon tool is retired and the privacy policy describes founder access instead of codes.

**Build updates + announcements (TX-10)**
- **AC52** — Ticking build updates on the landing sends B2; nobody is subscribed until they press the confirm button on `moduo.app/email`.
- **AC53** — Every build update has Unsubscribe in the footer (page) and in the mail app (one-click); unsubscribing stops further updates at once.
- **AC54** — An announcement or build update written as an `email_campaigns` row can be test-sent to hello@ and then sent to its audience exactly once per recipient.
- **AC55** — Build updates come from updates@news.moduo.app (replies to hello@); announcements come from hello@ and have no unsubscribe.

## Tests that prove them

Layer key: **unit** = Rstest (`bun run verify`); **db** = a rolled-back round trip against prod inside one transaction (`begin; … rollback;`) run in-session before the migration is applied (Maciej's standing preference: verify, then apply in the same session), recorded in the block's testing doc; **live** = a real send to a real inbox, recorded in `docs/testing/<branch>.md`; **drift** = the existing drift-gate test pattern reading migrations.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `_shared/email/render.test.ts` · "every kind renders the shell" | AC1 | Each template has the header, ≤1 button and the footer lines the ratified HTML shows. |
| `_shared/email/render.test.ts` · "snapshots" | AC1, AC5 | The HTML of each template with fixture data matches a reviewed snapshot (light + dark styles present). |
| `_shared/email/text.test.ts` · "plain-text twin" | AC2 | Every template's text version contains the same sentences and full URLs, no tags. |
| `_shared/email/render.test.ts` · "user text is inert" + `send.test.ts` · "From header" | AC3 | `<b>`, `"`, CR/LF and 500-char names come out escaped, single-line and truncated; From display names are sanitised. |
| `_shared/email/palette.test.ts` · "palette mirrors tokens" | AC4 | Converts the mirrored oklch tokens in `tokens.css` to hex and compares with the email palette. |
| `src/features/transactional-email/ui/email-gallery.stories.tsx` | AC6 | Storybook shows every template in light/dark/plain text (visual review). |
| `_shared/email/templates/auth-code.test.ts` · "subject + copy" | AC7, AC8 | Subject is "<code> is your Moduo code"; body says 10 minutes. |
| `auth-email-hook/handler.test.ts` · "verifies signature" | AC7 | Unsigned or wrongly signed requests are refused; valid ones send. |
| `auth-email-hook/handler.test.ts` · "falls back to plain text" | AC10 | A throwing renderer still sends a minimal code email; a failing Resend returns the hook error shape. |
| `auth-email-hook/handler.test.ts` · "never logs the code" | AC12 | The log insert payload contains no token or token hash. |
| `src/components/auth/email-auth-panel.test.tsx` · "resend countdown" | AC9 | After a send the button is disabled and counts down from 60; rate-limit errors map to friendly copy. |
| live · TX-2 checklist | AC7, AC8, AC11, AC13 | Real sign-in on web and the desktop build; 31+ code requests within an hour across test addresses; hook off → old path works → hook back on. |
| `_shared/email/outbox.test.ts` · "claim, send, retry" | AC14, AC16 | The worker logic (injected DB + sender) sends once, passes the idempotency key, backs off, and marks failed after 5. |
| db · `email_enqueue` / `email_cancel` round trip | AC14, AC15 | Duplicate dedupe keys insert once; cancelled rows never get claimed; `send_after` respected by the claim query. |
| `_shared/email/resend-webhook.test.ts` · "svix signature + suppression" | AC17 | Valid bounce/complaint events suppress the address; invalid signatures are refused; soft bounces don't suppress. |
| db · purge + health functions | AC18, AC19 | Rows older than 30 days are deleted; 3 failures in 10 min enqueue one alert, not two. |
| db · `hook_before_user_created` cases | AC20 | Each allow source returns `{}`; an unknown address returns the 403 error with the invite-only message. |
| db · waitlist helpers | AC21, AC22, AC23 | Status change enqueues B1 once; `invite_next` picks oldest, caps at 50; sign-up deletes the row and keeps the subscription; purge drops 12-month-old invited rows. |
| live · TX-4 checklist | AC20, AC24 | Unknown address refused on web; invited address signs up on desktop; an existing user signs in unchanged. |
| `_shared/email/templates/booking.test.ts` · "guest/host/extra variants" | AC25–AC28 | Zone naming, reply-to, no guest note in guest emails, .ics only when `googleInvites = false`. |
| `_shared/email/ics.test.ts` · "request + cancel" | AC25, AC26, AC28 | Valid RFC 5545 REQUEST and CANCEL files with stable UIDs. |
| `booking-public` handler test (extracted pure module) · "book/cancel enqueue" | AC25–AC28, AC30 | Book enqueues C1/C2/C3 (+C7), cancel enqueues C4/C5 and cancels C7; invalid zones fall back; no emails for a past cancel. |
| db · booking op notify payloads | AC27, AC28 | `booking_op_commit`/`release` activity rows carry `notify_user_ids` = host, so `notifications_list` returns them for the host. |
| `src/routes/pages/book-page.test.tsx` · "confirmation copy" | AC29 | Google vs Zoom-only confirmation sentence. |
| `src/features/calendar/ui/booking-link-dialog.test.tsx` · "remind guests select" | AC31 | The select saves 0/60/1440 and defaults to 1440. |
| db · reminder scheduling + host-cancel triggers | AC32, AC33 | Reminder row at the right time, skipped inside the window, moved on start change; soft-delete releases + queues C6 at +2 min; restore within 2 min cancels C6 and re-confirms. |
| db · `workspace_op_accept_invite` email check + invite cap | AC35, AC37 | Mismatched email raises `invite_email_mismatch`; the 21st insert in 24 h is refused. |
| `src/routes/pages/join-page.test.tsx` · "mismatch + pending join" | AC35, AC36 | Mismatch state renders the masked address; after OTP a pending join goes to `/join` before onboarding. |
| db · ownership/removal enqueue | AC38 | Transfer enqueues B4; manager removal enqueues B5; self-leave enqueues nothing. |
| live · TX-7 checklist | AC34, AC36, AC39 | Real invite to a fresh address → email → sign up → in the workspace; `send-workspace-invite` gone (gateway 404). |
| `src/features/settings/sections/preferences-section.test.tsx` · "email group" | AC40, AC42 | Three switches with the right defaults; toggling calls the RPCs. |
| db · worker preference filter | AC41 | Muted kinds are skipped as `skipped_pref`; always-send kinds ignore preferences. |
| `_shared/account-erasure.test.ts` · "email tables erased + A2 after success" | AC43 | A2 sent only on `status: "deleted"`; outbox/suppression/subscription rows removed. |
| db · welcome + trial sweeps | AC44–AC46 | First-workspace trigger enqueues D1 at +5 min once; the hourly sweep enqueues D2 once in the 3-day window; trialing→canceled enqueues D3 unless the deletion comment is present. |
| `src/routes/pages/onboarding-page.test.tsx` · "14-day copy" | AC47 | Footnote says 14-day. |
| db · `plan_grants` + `recompute_entitlement` | AC48, AC49 | A grant raises the tier and sets `current_period_end`; expiry job drops it to Free; higher Stripe tier wins; D4/D5 enqueued once. |
| `src/features/settings/billing.test.ts` · "grant line" | AC50 | Billing line reads "Pro, free until 8 October 2027". |
| drift · functions reconcile | AC39, AC51 | `bun run functions:reconcile` shows no deployed `send-workspace-invite` / `issue-founder-coupon`. |
| `_shared/email/subscriptions.test.ts` · "token + one-click" | AC52, AC53 | HMAC tokens verify and expire; POST one-click unsubscribes; GET changes nothing. |
| `_shared/email/markdown.test.ts` · "campaign body subset" | AC54 | Paragraphs, lists, links, bold and h2 render; raw HTML is escaped. |
| db · campaign fan-out | AC54, AC55 | `test` sends one to hello@; `send` enqueues one row per audience member with a unique key; re-sending is a no-op; stream/from/headers per kind. |
| live · TX-10 checklist | AC52, AC53, AC55 | Landing opt-in → B2 → confirm page → test build update → Gmail one-click unsubscribe works. |

## Assumptions & technical decisions

Each: decision · why · alternative rejected. Durable ones are also in `docs/decisions/product.md` (2026-10-08 entry).

- **T1 · Resend is the only sender, region eu-west-1, on the already-verified `moduo.app` domain.** It is configured, named in the privacy policy, and its DKIM/return-path records exist. *Rejected:* Postmark/SES (a second vendor and new DNS for no gain); keeping Hostinger SMTP (30/h, one mailbox). Resend open/click tracking stays **off** (privacy; link rewriting breaks one-click and confuses users).
- **T2 · Two streams.** Account stream from `hello@moduo.app`; build-updates stream from `updates@news.moduo.app` (a new Resend domain `news.moduo.app`, DNS in Vercel DNS: DKIM TXT `resend._domainkey.news`, MX + SPF TXT on `send.news`). Reputation is judged per domain, so complaints about build updates can't touch sign-in codes. DMARC stays `p=none` now; moving to `quarantine` is a later ops step (out of scope).
- **T3 · One pure-TypeScript email kit at `supabase/functions/_shared/email/`.** No Deno globals, no URL/npm imports, relative `.ts` imports, HTML as escaped template strings, table-based layout with inline styles plus a `<style>` block for dark mode — the `_shared/contracts` and `account-erasure.ts` convention, so Deno functions, Rstest and Storybook all import it. Alias `@email/*` added in the four places the gotcha requires (tsconfig paths + `include`, `rsbuild.config.ts`, `rstest.config.ts` + its include glob widened to `supabase/functions/_shared/**/*.test.ts`, `.storybook/main.ts`). *Rejected:* React Email (needs `npm:`/JSX config in Deno, breaks the shared-import convention, second preview tool next to Storybook); MJML (Node-only compiler).
- **T4 · Templates are data → blocks → (html, text).** Each kind exports `render(data) → { subject, preheader, html, text, headers? }` built from the same block list (heading, paragraph, sentence with fixed words, code box, button, link, rows, host, workspace chip, list, sign-off, attachment note, eyebrow, item, footer). Plain text is generated from the blocks, never hand-written. Every string is escaped unless it passes through the `fixed()` marker; all user strings go through `singleLine()` + length caps (names 80, workspace 80, notes 1000). Reuse `_shared/escape.ts` (`escapeHtml`, `noTags`, `singleLine`) and `_shared/app-origin.ts` (`appOrigin`, `bookingCancelUrl`, `workspaceInviteUrl`) from PR #250 rather than writing new ones; every emailed link comes from them.
- **T5 · Email palette = hex mirror of tokens and brand constants.** `_shared/email/palette.ts` holds the light and dark email colors as hex (mail clients don't support oklch). Each names its source: an app token (`--neutral-*`, `--mono-base`) or a brand constant from the brand brief §7 (White, Ink `oklch(0.16 0 0)`, Reading black `oklch(0.2 0 0)` for the dark canvas). `palette.test.ts` converts every source back to hex and fails on drift, and checks contrast (text ≥ 7:1, muted ≥ 4.5:1). This is the one sanctioned hex file for email (it's outside `src/`, so the hex lints don't scan it; the drift test is the guard).
- **T6 · Logo (amended by the brand brief §13, 2026-10-08).** The header is **one lockup image** (drawn mark + drawn wordmark; the wordmark is never retyped, brand decision 18), Ink on light and Paper on dark, displayed ≈ 96 px wide; the footer badge ("Scheduled with Moduo") uses the mark PNG, and the host block shows the host's own photo, or their initials. The PNGs are produced by the brand pipeline (BRAND-1, `bun run brand:export` from `brand/masters/`) into `public/email/` and served at `https://app.moduo.app/email/{lockup,mark}-{light,dark}@2x.png` ("light" = for a light background); TX-1 only names them (`_shared/email/assets.ts`) and does **not** rasterise its own. Until BRAND-1's exports are deployed, the URLs answer with the web app's HTML page (the SPA fallback), so mail apps show a broken image. **TX-2 must not go live before those files are real**: check that all four URLs (lockup and mark, light and dark) answer `content-type: image/png` at the contracted pixel size (lockup 192 × 44, mark 26 × 26), not just a 200. The "Scheduled with Moduo" badge goes on guest emails about a meeting that is on (C1, C2, C7), not on the cancellation emails C5 and C6.
- **T7 · Sign-in codes go through Supabase's Send Email Hook → Edge Function `auth-email-hook`.** It verifies the Standard Webhooks signature (HMAC-SHA256 via Web Crypto, secret `SEND_EMAIL_HOOK_SECRET` in `v1,whsec_…` form), renders A1 for `signup`, `magiclink` and `email`, an invite email for `invite` that **keeps the confirmation link** (amended in TX-2: with sign-ups off it is the only thing that confirms an invitee; email set A1b), and a neutral code variant (email set A1c) for `recovery`, `email_change`, `reauthentication`, which no UI uses today), ignores the `*_notification` types (returns 200, sends nothing), sends synchronously with one retry, and logs a row without the token. *Rejected:* custom SMTP to Resend + dashboard-pasted templates (templates outside the repo, no plain text control, a second template system). Rollback: hook off → Supabase falls back to the configured SMTP (Hostinger), which stays configured but unused.
- **T8 · Auth settings changed by Maciej in the dashboard from a checklist** (no `supabase config push`: the pulled config would wipe the SMTP password). TX-2: Send Email Hook on (URL + secret; Maciej sets the secret with `supabase secrets set` himself — never pasted into chat), Email OTP expiration 600 s, `rate_limit.email_sent` raised to 300/h. TX-4: Before User Created hook on (Postgres, `public.hook_before_user_created`), then "Allow new users to sign up" on. Order matters: hook first, test refusal, then sign-ups on.
- **T9 · Invite-only = sign-ups on + a `before_user_created` Postgres hook.** The hook allows an email if any source matches (lower-cased, exact): `waitlist.status = 'invited'`; a `workspace_invites` row `pending` and unexpired; an active `plan_grants` row; `founder_emails`. Otherwise it returns `{"error":{"http_code":403,"message":"invite_only"}}` and the client maps `invite_only` to the copy. The client flips `shouldCreateUser` to `true`. No sync triggers: the hook reads the sources directly, so revoking an invite or deleting an account removes access automatically (S3). *Rejected:* pre-creating auth users at invite time (ghost accounts for typos and never-accepted invites, more erasure work) — kept as the documented fallback if the hook turns out not to fire for OTP sign-ups (TX-4 verifies first, on a throwaway address).
- **T10 · One `public.email_outbox` table is the queue *and* the log.** Columns: `id`, `kind` (closed vocabulary `EMAIL_KINDS` in `@contracts` + CHECK), `stream`, `to_email` (lower-cased), `to_user_id` (nullable, **no foreign key** — amended in TX-2: Auth calls the hook inside the transaction that creates a new user, so a foreign key would refuse those log rows; the daily purge removes rows of deleted accounts), `payload jsonb` (template data, never secrets or codes), `dedupe_key text unique`, `send_after timestamptz`, `status` (`queued|sending|sent|failed|cancelled|suppressed|skipped_pref`), `attempts`, `last_error`, `provider_id`, `sent_at`, `delivered_at`, `created_at`. RLS on, no client grants (service role + SECURITY DEFINER helpers only; `REVOKE … FROM anon, authenticated` explicitly — the `REVOKE FROM PUBLIC` gotcha). Writers: `email_enqueue(kind, to_email, to_user_id, payload, dedupe_key, send_after)` and `email_cancel(dedupe_key_prefix)`, both SECURITY DEFINER, callable from SQL ops/triggers and Edge Functions. *Rejected:* `pgmq` (no log, harder to inspect in the dashboard); direct `net.http_post` per event (today's invite trigger: no retry, no log, silent failure).
- **T11 · `EMAIL_KINDS` is defined in full in TX-1** (all 22 kinds) so later blocks don't collide on `vocabularies.ts`; the CHECK lands with the table in TX-2. Kinds: `auth_code, account_deleted, waitlist_invite, updates_confirm, workspace_invite, workspace_owner, workspace_removed, booking_guest_confirmed, booking_guest_added, booking_host_new, booking_host_guest_cancelled, booking_guest_cancelled, booking_guest_host_cancelled, booking_guest_reminder, welcome, trial_ending, trial_ended, founder_access, founder_access_ending, announcement, build_update, ops_alert`.
- **T12 · Worker = Edge Function `email-worker`, kicked two ways:** an `AFTER INSERT` trigger on the outbox calls `net.http_post` when `send_after <= now()` (instant), and a `pg_cron` job every minute calls it for scheduled/retry rows. The call carries `x-email-worker-secret` from Vault, ~~compared constant-time with the function secret `EMAIL_WORKER_SECRET`~~ **(amended in TX-3: the migration generates the secret in Vault and the worker asks the database to check it, `email_outbox__authorize`, so there is no function secret to set; docs/decisions/product.md 2026-10-09)**. The worker claims ≤50 rows `FOR UPDATE SKIP LOCKED`, checks suppression and preferences, renders, sends with `Idempotency-Key: <dedupe_key>` (Resend keeps keys 24 h), and records the result; backoff 1, 5, 15, 60 min. **This is Moduo's first server-side scheduler** (earlier features chose client-triggered sweeps); pg_cron already runs the Stripe Sync Engine worker in prod, and reminders/trial emails must fire with nobody's app open. *Rejected:* client-triggered sweeps (can't send a reminder at 3 a.m.).
- **T13 · Suppression.** `email_suppressions(email pk, reason bounce|complaint|manual, created_at, provider_event_id)`; Edge Function `resend-webhook` verifies the Svix signature (Web Crypto, secret `RESEND_WEBHOOK_SECRET`), suppresses on `email.bounced` (hard) and `email.complained`, and stores `delivered_at` on `email.delivered`. Suppression blocks every kind except `auth_code`.
- **T14 · Retention.** A daily pg_cron job deletes outbox rows older than 30 days (shipped early in TX-2 as `email-outbox-purge`), waitlist rows `invited` > 12 months, and expired confirmation tokens. Suppressions live until the address is erased.
- **T15 · Booking emails are enqueued by `booking-public`** (book: C1, C2 if `googleInvites = false`, C3, C7 if a reminder applies; cancel: C4, C5, `email_cancel('C7:<booking>')`). The `.ics` is generated by `_shared/email/ics.ts` and attached via Resend `attachments` (METHOD:REQUEST on book, METHOD:CANCEL on cancel, UID = `booking-<id>@moduo.app`) only for recipients Google isn't inviting. Date/time helpers move from `sentence-ui.tsx` into the pure `sentence.ts` (explicit `en-GB` locale, `hourCycle: 'h23'`) so the page and the emails format identically. The guest zone is validated with `Intl.supportedValuesOf('timeZone')`, falling back to the link's `host_timezone`. The origin allow-list, escaping and booking rate limit this builds on landed in PR #250 (merged into maciej 2026-10-08).
- **T16 · Host bell for bookings** = add `notify_user_ids: [owner]` (+ `title`, `guest`, `start`) to the `module_activity` payloads written by `booking_op_commit` and `booking_op_release`, and lines in `spineActivityLine` for `calendar.booking_create` / `calendar.booking_cancel`; deep link to the event already works. Mutable under the existing notifications mutes as a new `bookings` type.
- **T17 · Reminders + host cancel.** New column `exposed_slot_links.guest_reminder_minutes int null check (in 60, 1440)`, default 1440, backfilled 1440 for existing links (the ratified default). New index on `slot_bookings(calendar_event_id)`. Triggers on `calendar_events`: soft-delete/tombstone of a booked event → booking `status = 'cancelled'`, `cancelled_by = 'host'`, cancel C7, enqueue C6 at +2 min; restore within 2 min → re-confirm, cancel C6, re-enqueue C7; `start_at` change → update the booking's times and re-enqueue C7. Zoom meetings aren't deleted on host cancel (harmless; noted).
- **T18 · Email preferences live in their own table** `email_preferences(user_id pk fk, bookings bool default true, trial_billing bool default true, updated_at)`, written through `email_prefs_set()` RPC. *Rejected:* keys inside `user_preferences.preferences` — the whole-blob last-write-wins sync and Zod's unknown-key stripping mean an older build would silently turn an "off" back on. Build updates are a subscription, not a preference (T21).
- **T19 · Ops alert.** A pg_cron job every 5 minutes enqueues one `ops_alert` to hello@ (dedupe per 30-minute window) when any `auth_code` failed or ≥3 rows failed in 10 minutes. Known limit: if Resend itself is down, the alert can't go out either (no SMTP fallback — Edge Functions can't use port 587); Resend's status page is the backstop.
- **T20 · Workspace emails.** Drop the prod-only `trigger_send_workspace_invite` + trigger (a migration that creates-or-replaces then drops, since no migration ever created them), replace with an enqueue trigger (`B3:<invite id>`), delete `supabase/functions/send-workspace-invite` and undeploy it (verify gateway 404, as for `founders-apply`). `workspace_op_accept_invite` requires `lower(auth email) = lower(invite email)` (S1) → `invite_email_mismatch`. The 20/24 h cap goes into `perm_invites_validate` (S2). B4/B5 enqueued in `workspace_op_transfer_ownership` / `workspace_op_remove_member`. The email copy says "Member" (the UI's role name). Pending-join fix: `handleVerifyOtp` goes to `/join?invite=…` when `moduo:pending_join` is set, before onboarding.
- **T21 · Build-updates subscriptions.** `email_subscriptions(email pk, topic 'build_updates', status pending|subscribed|unsubscribed, user_id null, source waitlist|settings, requested_at, confirmed_at, unsubscribed_at)`. Tokens are HMAC-signed (`email|topic|action|expiry`, key `EMAIL_TOKEN_SECRET`), 30-day expiry for confirm, none for unsubscribe. Edge Function `email-subscription` (JSON only: `preview`, `confirm`, `unsubscribe`, plus the RFC 8058 one-click POST). The page is `moduo.app/email` (P1, ratified 2026-10-08): a static landing page `landing/email.html`, copied and rewritten like `/privacy` by `scripts/vercel-build.mjs` + `vercel.json`, that reads the token from the URL, calls `email-subscription` `preview`, and shows one sentence and one button ("Confirm build updates" or "Unsubscribe"); GET never changes anything. `waitlist-join`'s existing `updates` flag creates a pending row and enqueues B2 instead of only setting `updates_requested`; the `updates_requested*` columns are migrated into subscriptions and then left unused.
- **T22 · Campaigns.** `email_campaigns(id, kind announcement|build_update, subject, preheader, body_md, audience all_users|all_users_and_waitlist|build_updates, status draft|test|send|sent, test_to default 'hello@moduo.app', created_at, sent_at)`; an update trigger enqueues (`E:<campaign>:test` or `E:<campaign>:<email>` per recipient). Body Markdown subset (paragraphs, h2, lists, links, bold) rendered by the kit, escape-first. Build updates add `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (Gmail/Yahoo bulk rules).
- **T23 · Welcome + trial.** D1: `AFTER INSERT` on `workspaces` when it's the owner's first → enqueue at +5 min, key `D1:<user>`. D2: hourly pg_cron sweep over `profiles` with `subscription_status = 'trialing'` and `current_period_end` within 72 h, no active paid subscription, key `D2:<user>:<period_end date>`. D3: trigger on `profiles` when `subscription_status` goes `trialing → canceled`, skipped when the latest Stripe subscription's cancellation comment is "Moduo account deleted", key `D3:<user>:<period_end date>`. Free/Pro lines in D2/D3 are kept in step with `src/features/billing/plans.ts` by a test. Copy about extra workspaces/email accounts after the trial waits for pricing v2's rule (not claimed now).
- **T24 · Founder access.** `plan_grants(id, email, tier pro|duo|team, starts_at default now(), ends_at, note, created_by, created_at, revoked_at)`, keyed by email so it works before sign-up. `recompute_entitlement` takes the higher rank of grant and Stripe; status `active`, `current_period_end = ends_at`; daily pg_cron re-runs it for grants that ended; `start-trial` skips grant holders; `workspace_seat_cap` treats a granted Team as 3 seats; `protect_founder_profile` untouched (founders stay founders). Billing UI line per AC50. `issue-founder-coupon` is deleted and undeployed; `founders_interest` (0 rows) is dropped with its erasure branch; the policy's "Early Founders codes" section becomes "Founder access" (email, plan, dates; basis 6(1)(b); kept until the grant ends + 30 days).
- **T25 · Account deleted.** `delete-account` sends A2 directly (not queued — the address is about to be erased) only when `deleteAccount` returns `status: "deleted"`, then `account-erasure.ts` deletes the address's rows in `email_outbox`, `email_suppressions`, `email_subscriptions` (and `email_preferences` via FK). A2 copy must match what deletion actually erases on the day it ships (PRIV-2 state); if Stripe warnings occurred, the "you won't be charged" line stays (subscriptions are cancelled first) but nothing claims Stripe data is gone.
- **T26 · Privacy policy changes ship with the block that needs them:** TX-2 (Resend sends sign-in emails; we keep a record of emails sent for 30 days), TX-8 (email preferences; the A2 address passes through Resend), TX-9b (founder access replaces codes), TX-10 (build-updates confirmation page and unsubscribe). Resend is already a listed processor, so these widen a purpose rather than add a processor; **no E1 announcement is sent for them** (assumption — Maciej can veto). Landing deploys go through `promote-to-prod` (prod-landing).
- **T27 · Deploys.** Edge Functions: `supabase functions deploy <fn> --project-ref wtoonrvuqumihpkbvwvs --no-verify-jwt --import-map supabase/functions/deno.json --use-api`, each with Maciej's OK in the session. Migrations: rolled-back round trip in prod first, then applied in-session (standing preference), with a graceful-degrade guard for any new RPC on a live read path. `bun run functions:reconcile` after every deploy/undeploy.

## Execution blocks

Prefix **TX-** (the `EM-` prefix belongs to the mail client). Each block: build → `bun run verify` → validator → its prod steps → its live checklist in `docs/testing/<branch>.md`. Runbook `docs/email-runbook.md` (dashboard procedures, rollback, secrets list) is created in TX-2 and extended by every block.

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| TX-1 | **Email kit** | `_shared/email/` (palette + drift test, escape, blocks, layout incl. dark mode, plain-text twin, send client with idempotency/retry/reply-to/headers/attachments, `ics.ts`, date helpers), `EMAIL_KINDS` in `@contracts`, the A1 template, the logo image names (the PNGs themselves come from BRAND-1, T6), `@email/*` alias in all four configs, Storybook gallery story with an iframe frame. No prod changes. | AC1–AC6 | — |
| TX-2 | **Sign-in codes on Resend** | `email_outbox` table (log role) + CHECK, `auth-email-hook` function, sign-in panel countdown + copy + error mapping, runbook (dashboard checklist + rollback), policy lines (T26). Prod: migration, deploy, Maciej's dashboard checklist, live web + desktop test, 31-request capacity test, rollback drill. | AC7–AC13 | TX-1, BRAND-1 exports deployed (T6) |
| TX-3 | **Outbox worker + deliverability** | `email_enqueue`/`email_cancel`, `email-worker` function, insert trigger + pg_cron kick (Vault secret), backoff, `email_suppressions` + `resend-webhook` (Resend dashboard webhook set by Maciej), purge + health jobs, `ops_alert` template. Tested with an internal test kind before any feature uses it. | AC14–AC19 | TX-2 |
| TX-4 | **Invite-only gate + waitlist invite** *(alpha gate)* | `hook_before_user_created`, waitlist status `invited` + `invited_at` (+ `manual` source) in `@contracts` + CHECK, status-change enqueue trigger, `waitlist_invite_next/_email/_resend` helpers, delete-on-sign-up in `handle_new_user`, 12-month purge, `shouldCreateUser: true` + `invite_only` mapping, B1 template. Prod: throwaway-address check that the hook fires for OTP sign-up, then hook on → refusal test → sign-ups on. | AC20–AC24 | TX-3 |
| TX-5 | **Booking emails** | C1–C5 templates, booking-public enqueues (pure handler module extracted for tests), `.ics` attachments, zone validation, date helpers moved to `sentence.ts`, host bell (op payloads + activity lines + mute type), booking page copy. Retires `sendGuestEmail`. | AC25–AC30 | TX-3 |
| TX-6 | **Reminders + host cancel** | `guest_reminder_minutes` column + backfill, editor "Remind guests" select, reminder enqueue/cancel/move, `slot_bookings(calendar_event_id)` index, calendar_events triggers (release on delete/tombstone, 2-min undo, start change), C6 + C7 templates. | AC31–AC33 | TX-5 |
| TX-7 | **Workspace emails** | B3/B4/B5 templates, enqueue trigger replacing the prod-only trigger, delete + undeploy `send-workspace-invite`, accept-by-email check + join page mismatch state, 20/day cap + copy, pending-join fix, reply-to inviter. | AC34–AC39 | TX-4 |
| TX-8 | **Account + email preferences** | `email_preferences` + `email_prefs_set`, `email_subscriptions` table (shared with TX-10) + `email_build_updates_set` RPC, Settings → Preferences "Email" group, worker preference filter, A2 template + send in `delete-account`, erasure of email tables, policy lines. | AC40–AC43 | TX-3 |
| TX-9a | **Welcome + trial emails** | D1 trigger, D2 hourly sweep, D3 status-change trigger, templates, plans-copy drift test, onboarding "14-day" fix. | AC44–AC47 | TX-3 (TX-8 for the switch; default on until then) |
| TX-9b | **Founder access** | `plan_grants`, `recompute_entitlement` branch + expiry job, `start-trial` skip, seat cap, billing line, allow-list source (extends TX-4's hook), D4 (+ D5) templates, retire `issue-founder-coupon` + drop `founders_interest`, policy section. | AC48–AC51 | TX-4, TX-9a |
| TX-10 | **Build updates + announcements** | `news.moduo.app` Resend domain + DNS, `email-subscription` function, the `moduo.app/email` confirm/unsubscribe page, `waitlist-join` → pending + B2, `email_campaigns` + fan-out trigger + Markdown subset, E1/E2 templates, List-Unsubscribe headers, policy lines. | AC52–AC55 | TX-8 |

**Lanes.** Sequential gate: TX-1 → TX-2 → TX-3 → TX-4. After TX-3: TX-5 ∥ TX-8 ∥ TX-9a can run in parallel (disjoint files except migrations — coordinate timestamps); TX-7 after TX-4; TX-6 after TX-5; TX-9b after TX-4 + TX-9a; TX-10 after TX-8. Shared files: `_shared/email/templates/index.ts` (one line per template), `supabase/migrations/*`, `docs/email-runbook.md`.

## Out of scope

- Mentions/assignments/follow-ups by email, digests, push (bell only; DF-19f notes the server-muting path if a digest ever comes).
- Chat and Moduo Meet emails; reschedule emails (MEET-4 adds reschedule + the Meet link to C1/C7).
- Collective-link co-host emails (PERM-8b).
- Stripe's own emails (configured in Stripe at paid launch, Q45); our own plan-change/receipt emails (Q47).
- New-device sign-in alerts (Q49); password reset / email change flows (no UI exists).
- Friend referral invites (Q23); waitlist join confirmation (Q16); waitlist invite reminders (Q21).
- Localisation (English only; templates keep copy in one place per kind so it can be translated later).
- DMARC `quarantine`/`reject` and BIMI.
- The brand system (separate planning session); emails pick up a new mark by replacing the PNGs.
- Deleting the Zoom meeting when a host cancels.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous (copy lives in the ratified HTML).
- [x] **Every acceptance criterion has at least one test** with a plain-English note.
- [x] **Open questions is empty** — P1 and P2 answered 2026-10-08 (both as recommended).
- [x] **Data model is named and Supabase-first:** `email_outbox`, `email_suppressions`, `email_preferences`, `email_subscriptions`, `email_campaigns`, `plan_grants`; columns `waitlist.invited_at`, `exposed_slot_links.guest_reminder_minutes`, `slot_bookings.cancelled_by`; vocabularies `EMAIL_KINDS`, waitlist `invited`/`manual`; index on `slot_bookings(calendar_event_id)`.
- [x] **Module feature:** not a module. The only spine touch is the host's bell notifications for bookings (T16). No MCP tools, no dashboard widget — deliberately: emails are a platform service, not an entity.
- [x] **Execution blocks** are decomposed, sequenced and context-sized; each names its prod steps.
- [x] **Design constraints:** the in-app pieces (sign-in countdown, join page state, Settings Email group, booking link select, billing line) use tokens and existing shadcn primitives (`Switch`, `Select`, `Button`) per `docs/DESIGN_RULES.md`; emails use the hex mirror (T5) because mail clients can't read tokens.
- [x] **Manual-test surfaces:** real inboxes — Gmail web + iOS, Apple Mail (light + dark), Outlook web; sign-in on web and the desktop build; booking with Google-connected and Zoom-only links; the dashboard waitlist procedure; Gmail one-click unsubscribe.

**Ready to execute.** Blocks in order: TX-1 → TX-2 → TX-3 → TX-4, then TX-5 ∥ TX-8 ∥ TX-9a, TX-7, TX-6, TX-9b, TX-10.

## Open questions

- [x] **P1 · Where do people confirm build updates and unsubscribe?** Edge Functions can't serve web pages, so this needs one small public page. *Rec: `moduo.app/email` — a plain page on the landing site (like /privacy), not a new screen inside the app. It shows one sentence and one button: "Confirm build updates" or "Unsubscribe".* **Answered 2026-10-08: yes, `moduo.app/email` on the landing site.**
- [x] **P2 · Add D5 "Founder access ending", 14 days before it ends?** *Rec: yes, so founders aren't surprised; copy is in the ratified HTML.* **Answered 2026-10-08: yes.**
