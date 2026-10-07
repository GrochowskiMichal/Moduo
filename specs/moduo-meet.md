# Spec: Moduo Meet — our own video calls (self-hosted LiveKit on Azure)

> Status: **Ready** (DoR passed 2026-10-06) · Owner: mike · Related: `specs/calendar.md` (booking links), `specs/chat.md` (calls reuse this engine), `docs/moduo-module-contract.md`, `docs/DESIGN_RULES.md`

## Scope

Moduo Meet is a third video platform next to Google Meet and Zoom. It's built into Moduo, so it needs no account to connect. Paid users can put it on **booking links**, on **any calendar event**, or start an **instant call**. The call runs in the browser or inside the desktop app. When it ends it closes the loop: a **Call note** lands on the event and on every attendee's contact, carrying the live shared notes, the action items (as real tasks) and, if recorded, the video and a transcript. Media runs on **self-hosted LiveKit in an Azure EU region** that we own and operate. It is built as one call engine (`src/features/meet/`), so the chat module's calls (Duo/Team) reuse it instead of building a second one.

Why now: booking links shipped 2026-10-01/02 with a visible "Moduo video — Later" placeholder (`src/features/calendar/ui/booking-link-dialog.tsx:138`). Google/Zoom connect is the main reason a booking link shows as *paused*, and Moduo Meet removes that dependency.

## Product behavior & UX

### Designer calls (locked 2026-10-06)

| Topic | Call |
| --- | --- |
| Where | Booking links + any calendar event + instant "Start a call" |
| Guests | People on the event/booking walk in after a name + device check. Anyone else with the link **knocks** and the host admits them |
| Plans | **Hosting is paid only** (Pro / Duo / Team / Founder). **Anyone can join**, including Free users and guests without an account |
| Size | Up to **12** people per call |
| Extras v1 | Spine-aware side panel · Studio look · Recording + transcript |
| Wow moment | **Instant join** (live in under 1 s, no download) + **the aftermath** (the recap closes the loop) |
| Desktop | The call runs **inside the app**, and you can shrink it to a floating mini-player while you keep working |
| Recording | **Host only** (or a Moduo member of the host's workspace). Everyone sees a red Recording pill, and guests get a chime + notice |
| Retention | Kept until deleted. Counts toward plan storage. Transcript auto-detects **Polish / English**. Included in the lossless export |
| Early guest | Waiting screen (host photo, title, camera preview). The host gets **one** quiet notification: "Anna is waiting" |
| Link | `moduo.app/m/amber-fox-river`: three words, readable, unguessable |
| Recap | One **Call note** linked to the event and to each attendee's contact, and it shows in activity |
| Mobile | The **guest join page + in-call view** work in phone browsers. The Moduo app itself stays desktop-only |
| Default | Moduo Meet is the **default video for paid users** on new booking links and events |
| Duration | **4 h** max, with a gentle warning at 3 h 50 m |
| Capacity | **One always-on EU server** for instant join. Extra servers start automatically when busy |
| Region | **EU only** (Azure Poland Central; data stays in the EU) |
| Quality | Adaptive **up to 1080p** for the speaker, smaller thumbnails, screen share sharp at up to 1440p. Audio always wins on bad networks |
| Look | **Calm cinematic**: edge-to-edge video on deep black, a floating glass control dock that hides when idle, tiles that reflow smoothly, a soft voice-reactive glow. Tokens + Geist only |

### Main flows

**1. Host adds Moduo Meet to a booking link.** In the link editor's Video picker, *Moduo Meet* sits first (default for paid) next to Google Meet, Zoom and Their choice. It's always "connected", so the link never pauses because of video. *Their choice* now offers Moduo Meet plus whatever else is connected. A Free host sees Moduo Meet with a small "Pro" badge, and choosing it opens the Plans page.

**2. A guest books.** booking-public creates the room and the event. The confirmation page, the Moduo email and the Google invite (when Google is connected) all carry `moduo.app/m/<slug>`. The guest's email is on the room's invite list.

**3. Host adds Moduo Meet to any event.** The event editor gets an "Add video" row with the same picker. Picking Moduo Meet creates a room and puts its link in the event's location. Attendee emails go on the invite list. Removing it or deleting the event closes the room.

**4. Instant call.** "Start a call" in the top bar (and later in chat or a contact) creates a room, copies the link, and drops the host straight into the call. That room's invite list is empty, so everyone else knocks unless they're workspace members.

**5. Joining (the < 1 s moment).** The join page (`/m/<slug>`, public) shows the title, the host and the start time, with a camera/mic preview already running, a name field (prefilled for signed-in users) and device pickers. Behind the scenes we fetch the token and pre-connect while you look at yourself. **Join** publishes the tracks you already captured, so remote video appears in under 1 s.

- Invited people, workspace members and the host → straight in.
- Anyone else → "Asking to join…", and the host sees a knock toast with **Admit** / **Deny**. Deny → "The host didn't let you in." Unanswered for 5 min → "No one answered — try again."
- Host not there yet → the waiting screen. The host gets one quiet notification ("Anna is waiting for *Intro call*"). The guest enters automatically when the host joins.

**6. In the call (calm cinematic).** Video runs edge to edge on deep black. The active speaker gets the stage and the others reflow as a smooth filmstrip/grid (12 max). A soft glow tracks whoever is talking. The glass dock holds: mic, camera, share screen, Studio, side panel, record (host), leave. It fades after 3 s idle and comes back on mouse move or keypress. Shortcuts: ⌘D mic, ⌘E camera, ⌘⇧S share, ⌘\ panel. Connection quality shows only when it's bad ("Your connection is weak — video lowered"), never as a constant meter.

**7. Studio look** (a per-user setting, remembered, all on-device): background blur / replace (Moduo-tinted presets + upload), noise suppression, low-light boost, auto-framing (keeps your face centered).

**8. Spine-aware side panel** (Moduo members only; guests never see it): the event and its booker contact (tags, last touch), linked tasks/notes, and the **live Call note** (the same collaborative note editor as Notes). Typing `[] something` or `/task` in it creates a real task linked to the contact and the event. Several Moduo members can edit together.

**9. Recording.** The host presses Record. Everyone sees a red **● Recording** pill, and guests hear a soft chime plus a one-line notice ("This call is being recorded by Mike"). Anyone joining later sees the notice on the join page before entering. Stop → "Saving recording…". The transcript arrives a few minutes after the call ends.

**10. The aftermath.** When the last person leaves (or the host presses End for everyone), the Call note is finalized: title, date, duration, attendees, live notes, action items (tasks), and — when recorded — the recording player plus a speaker-labeled transcript (real names, PL/EN). It's linked to the calendar event and to each attendee's contact, and the host's activity shows "Call with Anna · 32 min". The host gets **one** notification only when the transcript is ready, and none for a plain call end.

**11. Desktop mini-player.** Navigating away from the call view shrinks it into a floating draggable mini-player (active speaker + mic/leave) that stays over every route. Click it to expand. Closing the window while in a call asks "Leave the call?".

### States

- **Loading:** the join page skeleton shows the title from the link instantly (server-rendered meta), and the camera preview fades in.
- **Permission denied (camera/mic):** an inline explainer with a per-browser "how to allow" and **Join without camera** / **Join muted**.
- **No devices:** join as listen-only.
- **Room ended / cancelled:** "This call has ended" (or "was cancelled"), showing the host and a "Book another time" link when it came from a booking.
- **Not started yet (> 10 min early):** "Starts at 14:00 (in 2 h)". You can still check your devices, and Join opens 10 min before the start.
- **Host plan lapsed:** existing scheduled calls keep working until they're over. New rooms can't be created, and booking links set to Moduo Meet fall back to the host's other connected video or show as paused.
- **Offline / reconnecting:** "Reconnecting…" over a frozen frame. Audio resumes first. After 30 s it offers **Rejoin**.
- **Server at capacity:** a new call quietly waits for the burst server (≤ 90 s, "Getting a room ready…"). This is never an error unless it waits longer than 2 min.

## Edge cases

- The link opens on the desktop app's machine → the web page offers "Open in Moduo" (`moduo://m/<slug>`) and also works in the browser.
- The same person joins twice (two tabs or devices) → the second join replaces the first ("You joined from another device").
- A 13th person → "This call is full (12)", and they can still knock in case someone leaves.
- The host leaves without ending → the call continues. Room admin passes to another workspace member if one is present. Otherwise nobody can admit knockers, and the knocker sees "Waiting for the host".
- A booking is cancelled or rescheduled → cancel closes the room (the join page shows cancelled). Reschedule keeps the same room and link and moves the time window.
- The 4 h limit → a warning at 3 h 50 m, then the call ends for everyone with a recap.
- Recording while the recorder is busy (the v1 platform cap of concurrent recordings) → "Recording is busy — try again in a few minutes". The call is not affected.
- Transcription fails → the Call note still has the recording, plus "Transcript unavailable — Retry".
- Storage full → Record is disabled with "Storage full — manage recordings", linking to Settings.
- A guest is on Safari iOS → join works with H.264 fallback. Background blur is hidden when the device can't run it.
- A screen share in a 12-person call → the share takes the stage and faces go to the filmstrip.
- A Free user joins a paid host's call → full participant. Hosting stays gated.
- Workspace deleted / host account deleted → its rooms close and the join page shows ended.
- Clock skew on a guest device → all time checks happen on the server.

## Acceptance criteria

- **AC1** — A paid user sees **Moduo Meet** as the default video on a new booking link and a new event, and booking it produces a working `moduo.app/m/<slug>` link in the confirmation page, the email and the Google invite.
- **AC2** — A Free user sees Moduo Meet as a Pro option and can't create a room (server-enforced). They **can** join someone else's call.
- **AC3** — *Their choice* offers Moduo Meet plus the host's connected platforms. A link set to Moduo Meet is never "paused" for lack of connected video while the host is paid.
- **AC4** — Adding Moduo Meet to any event writes the link to its location and invites its attendees. Removing it or deleting the event closes the room.
- **AC5** — "Start a call" creates a room, copies its link, and puts the host in the call.
- **AC6** — Invited people, workspace members and the host enter directly. Anyone else knocks, and the host can Admit or Deny. Unanswered knocks time out after 5 min.
- **AC7** — A guest who arrives before the host sees the waiting screen and enters automatically when the host joins. The host gets exactly one notification per waiting guest.
- **AC8** — Join speed: from clicking Join to the first remote video frame is **≤ 1 s p50 / ≤ 2 s p95** on an EU broadband connection to a warm server.
- **AC9** — Quality: the active speaker is received at up to 1080p, screen share at up to 1440p. With 500 kbps of downlink, audio stays continuous and video lowers instead of freezing.
- **AC10** — Max 12 participants. The 13th sees "full". Calls end at 4 h with a 10-minute warning.
- **AC11** — The calm cinematic call UI: the dock auto-hides, tiles reflow without jumps, the speaker glow works, the shortcuts work, and it uses design tokens only (`lint:css`/`lint:tw` green).
- **AC12** — The guest join page and in-call view are usable on a 375 px phone browser (iOS Safari + Android Chrome).
- **AC13** — Desktop: calls run inside the app, with camera, mic and **screen share** working. Leaving the call view shows a floating mini-player across routes.
- **AC14** — Studio look: background blur/replace, noise suppression, low-light boost and auto-framing work on-device. The setting is remembered and hidden where unsupported.
- **AC15** — The side panel (Moduo members only) shows the event, its contact, linked items and the live Call note. Action items typed there become tasks linked to the contact + event.
- **AC16** — Only the host (or workspace members) can record. Everyone sees the Recording pill, and late joiners see the notice before entering.
- **AC17** — After a recorded call, the Call note gets the recording plus a speaker-named PL/EN transcript. Transcript failure shows Retry.
- **AC18** — When a call ends, one Call note is linked to the event and to each attendee contact, and the activity entry shows. Only "transcript ready" notifies.
- **AC19** — Cancelling a booking closes its room, rescheduling keeps the link, and an ended or cancelled room shows the matching page.
- **AC20** — A lapsed host's already-scheduled calls still work. New rooms are refused, and Moduo-Meet booking links fall back or pause.
- **AC21** — Recordings count toward plan storage, can be deleted, and are included in the lossless export.
- **AC22** — Module DoD: MCP tools (`meet.start_call`, `meet.list_calls`, `meet.get_call` incl. transcript) and a **"Next call"** dashboard widget with a Join button.
- **AC23** — Infra: LiveKit is reachable at `wss://rtc.moduo.app`, with TURN/TLS on 443 for strict firewalls. One node is always on and a burst node adds itself under load. It's monitored, with alerts on health, CPU and failed joins.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/calendar/booking/video.test.ts` · "moduo_meet is default and always available for paid" | AC1, AC3 | Moduo Meet is first, needs no connection, and is offered in Their choice |
| `src/features/calendar/booking/video.test.ts` · "free host cannot pick moduo_meet" | AC2 | A Free host is steered to Plans |
| `supabase/functions/_shared/contracts/vocabularies.test.ts` · "video provider vocabulary" | AC1 | `moduo_meet` is a valid closed value, parse vs normalize |
| `supabase/functions/meet-token/index.test.ts` · "token grants by role" | AC2, AC6, AC10 | Host gets admin, invited gets publish, stranger gets lobby-only, 13th refused, free host refused |
| `supabase/functions/meet-token/index.test.ts` · "lapsed host keeps scheduled rooms" | AC20 | Rooms created while paid still mint tokens until they end |
| `supabase/tests/meet_rooms.sql` (rolled-back txn) · "meet_op_* gates + RLS" | AC2, AC4, AC20 | Ops refuse free hosts, guests can't read rooms, cancel closes |
| `supabase/functions/booking-public/index.test.ts` · "booking with moduo_meet" | AC1, AC19 | Booking creates a room, invites the guest, cancel closes, reschedule keeps the slug |
| `src/features/meet/slug.test.ts` · "three-word slug" | AC1 | Readable, unique, ≥ 40 bits of entropy |
| `src/features/meet/admission.test.ts` · "who walks in vs knocks" | AC6, AC7 | Invite list / workspace member / host / stranger mapping, 5-min knock timeout |
| `src/features/meet/meeting-link.test.ts` (extends calendar's) · "moduo.app/m link labeled Join Moduo Meet" | AC1, AC4 | The Join button recognizes our links |
| `tests/e2e/meet-join.spec.ts` · "two browsers join, see each other < 2 s" | AC8, AC6 | Real LiveKit staging: host + guest, a knock + admit flow, a time-to-first-frame budget |
| `tests/e2e/meet-quality.spec.ts` · "throttled downlink keeps audio" | AC9 | A CDP-throttled 500 kbps client still receives audio, and video drops a layer |
| `tests/e2e/meet-mobile.spec.ts` · "375px join + call" | AC12 | Mobile viewport layout, dock reachable, no horizontal scroll |
| `src/features/meet/ui/call-stage.stories.tsx` + Playwright visual | AC11 | 1 / 2 / 4 / 12 tiles + screen share layouts, dock idle-hide, tokens only |
| `src/features/meet/stage-layout.test.ts` · "reflow is stable" | AC11 | A tile keeps its slot when others join or leave, and the speaker promotion animates |
| `src/features/meet/studio.test.ts` · "capability gating" | AC14 | Unsupported devices hide blur, and the preference persists |
| `src/features/meet/panel.test.ts` · "action item → task linked" | AC15 | `[]` / `/task` in the Call note creates a task linked to the contact + event |
| `supabase/functions/meet-webhook/index.test.ts` · "room_finished builds recap" | AC18 | One Call note, links to event + contacts, activity row, no notify |
| `supabase/functions/meet-webhook/index.test.ts` · "egress + transcript lifecycle" | AC16, AC17 | Recording rows, transcript merge by timestamp with names, failure → retry state |
| `supabase/functions/meet-record/index.test.ts` · "only host/members record, storage cap" | AC16, AC21 | A guest is refused, a full quota is refused, the busy cap message |
| `src/features/meet/transcript-merge.test.ts` · "per-speaker merge" | AC17 | Per-track transcripts interleave into one named transcript |
| `src/features/settings/export*.test.ts` · "export includes recordings manifest" | AC21 | The export lists recording files + transcripts |
| `src/features/meet/ops-manifest.test.ts` · "MCP tools declared" | AC22 | The three tools exist, with real backing RPCs |
| `src/features/dashboard/widgets/next-call.test.ts` · "next call widget" | AC22 | Shows the next Moduo Meet call and Join is enabled 10 min before |
| `docs/testing/moduo-meet.md` (manual) · desktop section | AC13 | Tauri camera/mic/screen share + mini-player across routes (WKWebView can't be automated in CI) |
| `infra/meet/smoke.sh` (`lk load-test` + health probe) | AC23, AC8 | 12-participant room on the node, signal + TURN/TLS reachable, alert fires on a stopped service |

## Assumptions & technical decisions

**Media + infra (Azure, provisioned through Azure MCP + Bicep in `infra/meet/`)**

1. **LiveKit OSS server on Azure VMs (a VM Scale Set), not AKS.** LiveKit wants host networking and large UDP ranges, and a VMSS with cloud-init is the least moving parts. *Rejected:* AKS (overhead for a 1–3-node fleet), LiveKit Cloud (the designer asked for self-host + EU control), Azure Communication Services (no SFU control, worse quality knobs).
2. **Region `polandcentral`**, with `germanywestcentral` as the fallback if quota or SKU isn't available. **Pre-req found in recon:** the subscription `Azure subscription 1` has **no resource groups and reports 0 VM quota** in polandcentral / germanywestcentral / westeurope. MEET-0a starts by registering `Microsoft.Compute`/`Network`/`Storage`/`KeyVault`/`Cache`/`CognitiveServices`/`Insights` and requesting compute-optimized vCPU quota (≥ 24 vCPU). If the portal requires it, that's the one step the designer may need to click.
3. **Node SKU:** compute-optimized 8 vCPU (newest F-family with quota, e.g. `Standard_F8s_v2` at **$0.388/h ≈ $283/mo** Linux PAYG in polandcentral, priced 2026-10-06 via Azure MCP). One always-on node (≈ 15–25 concurrent HD calls of ~4 people). VMSS **min 1 / max 3**, scaling out at CPU > 60 % for 5 min. A 1-year reservation is worth taking after a month of real usage.
4. **Networking:** each instance gets its own public IP (`use_external_ip: true`) for UDP media `50000–60000` and ICE/TCP `7881`. A **Standard Load Balancer (L4)** has two frontends: `rtc.moduo.app:443` → the node's signal (TLS terminated on the node by Caddy, proxying to 7880) and `turn.moduo.app:443` → LiveKit's embedded TURN/TLS (LiveKit terminates TLS). Also UDP 3478 for TURN/UDP. This is LiveKit's documented multi-node pattern.
5. **Coordination:** **Azure Managed Redis** (smallest SKU), private endpoint in the VNet, required for multi-node room routing.
6. **TLS certs:** a Let's Encrypt cert for `rtc.` + `turn.moduo.app` through a DNS-01 renewal job, stored in **Key Vault**. Nodes pull the cert at boot via managed identity and a daily timer. LiveKit API key/secret also live in Key Vault, and the copies on Supabase are secrets `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WEBHOOK_KEY`.
7. **DNS:** `rtc` / `turn` A-records on the `moduo.app` zone (Vercel DNS). The **Vercel MCP needs OAuth** before MEET-0a can write those records. Otherwise it's a two-line manual step listed in the block.
8. **Recording (Egress):** v1 runs **LiveKit Egress co-located on the node** as a container capped at 4 vCPU, with a **platform cap of 2 concurrent recordings** (felt trade-off: "Recording is busy" in rare peaks, instead of +$280/mo for a dedicated recorder pool). Room-composite MP4 (our cinematic template, speaker layout) plus **per-participant audio track egress (OGG)**, written straight to **Azure Blob Storage** (private container `meet-recordings`, Hot LRS ≈ $0.02/GB-mo, ~1.3 GB per recorded hour). A separate egress pool is a later block if the cap bites.
9. **Transcription:** **Azure AI Speech batch transcription** (EU region with batch support — swedencentral/westeurope, verified in MEET-9) on each participant's audio file with language identification `pl-PL`/`en-US`. Results are merged by timestamp, which gives **real speaker names without diarization guessing**. This is speech-to-text, not generative AI. Summaries stay MCP-only (the PRODUCT_BRIEF AI rule): the user's own AI reads the transcript via `meet.get_call`.
10. **Monitoring:** Azure Monitor Agent + Application Insights availability test on `https://rtc.moduo.app` + alerts (node down, CPU > 85 %, egress failures). The webhook-side join-failure rate goes to PostHog. LiveKit `/metrics` is scraped by Azure Managed Prometheus later, not in v1.
11. **Run-rate estimate:** node ~$283 + Redis ~$15–40 + LB/IPs ~$25 + storage (usage) + bandwidth **~$0.087/GB** egress beyond 100 GB free (a 4-person HD hour ≈ 6–8 GB ≈ $0.60) + Speech per audio hour. Roughly **$330–380/mo base** + usage.

**App + data (Supabase-first)**

12. **Tables** (new migration `…_moduo_meet.sql`): `meet_rooms` (id, workspace_id, host_user_id, slug unique, title, source `booking|event|instant|chat`, calendar_event_id, booking_id, starts_at, ends_at, status `scheduled|live|ended|cancelled`, max_participants 12, created_at) · `meet_invites` (room_id, email, contact_id) · `meet_sessions` (room_id, livekit_room_sid, started_at, ended_at, peak_participants, attendees jsonb [{name, email, user_id, contact_id, joined_at, left_at}]) · `meet_recordings` (session_id, egress_id, kind `composite|audio_track`, participant identity, blob_path, bytes, duration_s, status, transcript_status, transcript_json). RLS: workspace members read. Every write goes through SECURITY DEFINER `meet_op_*` ops (module contract Pillar 1). Guests never read tables, only edge functions.
13. **Contracts:** `video_provider` moves into `@contracts` (`google_meet|zoom|moduo_meet` + setting `guest_choice`) with parse/normalize/is. `src/features/calendar/booking/video.ts` imports it. A migration extends `exposed_slot_links_video_provider_check` (read the live CHECKs first — gotcha). New closed sets: `meet_room_source`, `meet_room_status`, `meet_recording_status` in `contracts/meet.ts`.
14. **Plan gate:** `public.plan_tier_rank(host plan) >= 1` (pro+) **at room creation**. Rooms keep working until `ends_at` even if the plan lapses (AC20). Joining is never gated.
15. **Edge functions (Deno, `verify_jwt=false` where guests call, user JWT checked inside):** `meet-room` (create/update/close; used by booking-public, the event editor, instant) · `meet-token` (mints a LiveKit JWT via `livekit-server-sdk` from `npm:` — host = roomAdmin + record; invited / member = publish/subscribe; stranger = **lobby grant**: no publish/subscribe/data, attribute `moduo.lobby=1`) · `meet-admit` (host → `RoomService.updateParticipant` grants, or remove) · `meet-record` (start/stop egress; checks role, storage quota and the concurrency cap) · `meet-webhook` (LiveKit webhooks verified with `WebhookReceiver`: room_started/finished, participant_joined/left, egress_ended → sessions, recap, transcription kickoff) · `meet-transcribe` (pg_cron-polled batch status → merge → write into the Call note).
16. **Lobby** uses LiveKit itself (restricted-permission participant + server-side permission upgrade), so admit is instant over the existing socket, with no extra realtime channel. Accepted trade-off: a knocking guest can see the *names* in the participant list (no media).
17. **Waiting-for-host:** the guest gets the lobby grant too, and `participant_joined` of the host triggers auto-admit of invited guests. The "X is waiting" notification rides `module_activity`'s `notify_user_ids` (quiet bar), deduped per guest per room.
18. **4 h limit + forgotten rooms:** room `emptyTimeout` 5 min + `departureTimeout` 60 s. A pg_cron job every minute calls `meet-room close` for live sessions older than 4 h. The client shows the warning from `started_at`.
19. **Client SDK:** `livekit-client` + `@livekit/components-react` **hooks only** (no LiveKit default styles). All UI is ours on tokens + shadcn wrappers. Settings: `adaptiveStream`, `dynacast`, simulcast layers (1080p/540p/180p), **VP9 SVC with H.264 backup codec** (Safari/iOS), screen share `contentHint: "detail"` 1440p @ 15 fps (30 fps for motion), audio Opus DTX + RED.
20. **< 1 s join:** the join page requests the token and runs `room.prepareConnection()` (DNS/TLS/signal warm) while the preview runs. The local tracks from the preview are **published as-is** on Join (no re-acquire). The `/m` route chunk is code-split and preloaded. Measured in e2e (AC8).
21. **Routes:** a public `/m/:slug` page served like `/book` (Vercel rewrites for `moduo.app`, `www.`, `staging.` → `app.html`, per the booking gotcha). The designer's pick of `moduo.app/m/…` counts as the AGENTS rule-7 confirmation for this one public route. **In-app, the call is a global overlay layer (full view ⇄ mini-player), not a nav route**, so the 5–7-route IA is untouched.
22. **Desktop (Tauri/WKWebView):** camera/mic need `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` in `src-tauri/Info.plist` + hardened-runtime entitlements. **Screen share** works through wry's permission handler allowing `DisplayCapture`, toggling the window's `NSWindowSharingType` to read-only while the picker is shown, and the `com.apple.security.screen-recording` entitlement (documented workaround — wry #1101/#1195, wry 0.56 permission API). Deep link `moduo://m/<slug>` via `tauri-plugin-deep-link`.
23. **Studio look:** `@livekit/track-processors` (MediaPipe) for blur/replace. Noise suppression = browser `noiseSuppression` + an RNNoise WASM processor (Krisp is LiveKit-Cloud-only). Low-light boost + auto-framing are our own WebGL/`VideoFrame` processors fed by the MediaPipe face landmarks the blur already computes. All gated by capability detection.
24. **Live Call note:** created as a real `notes` row at room creation (hidden until first edit or call end). The side panel embeds the existing Lexical + Yjs collaborative editor, and `/task` / `[]` reuses the Notes → task path, linked to event + contact via the spine `links` ops.
25. **Recap** = a finalized Call note + `links` to the calendar event and each attendee contact (matched by email) + one `module_activity` row. Recording playback uses short-lived Blob SAS URLs minted by an edge function on demand.
26. **Storage quota + export:** recording bytes add to the workspace storage usage the plan limits read. The lossless export includes a `meet/` folder (transcripts as markdown + recording download links/files).
27. **Chat reuse:** `src/features/meet/` exposes `startCall({ source, workspaceId, invite })` and the overlay, so chat's calls (`source: "chat"`) plug in with no second engine.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| **MEET-0a** | **Azure foundation + single LiveKit node** | Provider registration + quota request, RG `rg-moduo-meet-plc`, VNet/NSG, Key Vault, Storage, VMSS (min 1) with cloud-init LiveKit + Caddy, L4 LB (rtc/turn 443), DNS, certs, secrets on Supabase, `infra/meet/` Bicep + `smoke.sh` 12-person load test | AC23 (single node), AC8 infra | — |
| **MEET-0b** | **Scale-out + Egress + monitoring** | Azure Managed Redis + distributed mode, autoscale rule min1/max3 with graceful drain, co-located Egress → Blob, App Insights availability test + alerts | AC23 | 0a |
| **MEET-1** | **Data, contracts, tokens** | Migration (4 tables, ops, RLS, CHECK update), `@contracts` video/meet vocabularies, `meet-room` + `meet-token` + `meet-admit` edge functions, plan gate, slug generator | AC2, AC6, AC10, AC20 | 0a |
| **MEET-2** | **Call core (web)** | `src/features/meet/` engine, join page with preview + pre-connect, calm-cinematic stage, dock, shortcuts, screen share, adaptive quality, reconnect states | AC8, AC9, AC10, AC11 | 1 |
| **MEET-3** | **Public join, lobby, waiting room, mobile** | `/m/:slug` public route + Vercel rewrites, knock/admit/deny UI, waiting-for-host + quiet ping, ended/cancelled/early states, 375 px guest layout | AC6, AC7, AC12, AC19 (pages) | 2 |
| **MEET-4** | **Booking + events + instant** | `moduo_meet` in the video picker (default for paid, Pro badge for free), booking-public create/cancel/reschedule, event editor "Add video", top-bar Start a call, Join-button recognition, lapsed-host fallback | AC1–AC5, AC19, AC20 | 3 |
| **MEET-5** | **Desktop in-app + mini-player** | Tauri permissions/entitlements, screen-share workaround, global call overlay ⇄ floating mini-player, deep link, leave-on-close guard | AC13 | 2 |
| **MEET-6** | **Studio look** | Blur/replace, noise suppression, low-light, auto-framing, Studio sheet, persisted prefs, capability gating | AC14 | 2 |
| **MEET-7** | **Spine panel + live Call note** | Side panel (members only), live collaborative Call note, action items → linked tasks | AC15 | 4 |
| **MEET-8** | **Webhooks + aftermath** | `meet-webhook`, sessions/attendees, recap finalization + links + activity, 4 h sweep (pg_cron) | AC10 (limit), AC18 | 7, 0b |
| **MEET-9** | **Recording + transcript** | Record UI + consent notice/chime, `meet-record`, composite + per-track egress to Blob, Speech batch + merge, playback via SAS, retry, storage quota, export | AC16, AC17, AC21 | 8 |
| **MEET-10** | **Module DoD** | MCP tools `meet.start_call` / `meet.list_calls` / `meet.get_call`, "Next call" dashboard widget, docs + manual test checklist | AC22 | 8 |

Parallel lanes after MEET-2: **MEET-5** and **MEET-6** are independent of 3→4. MEET-0b can run alongside MEET-1/2.

## Out of scope

- Webinars, > 12 participants, breakout rooms, dial-in by phone (SIP), livestreaming.
- A native mobile app (only the guest web page is mobile).
- Built-in AI summaries or notes (MCP-only rule). Live captions during the call (a later block: Speech real-time).
- A US region / multi-region.
- E2E encryption (LiveKit supports insertable streams, but it breaks recording. Later, as an opt-in "private call").
- Whiteboard, polls, reactions/raise-hand (the designer left them out of v1).
- Chat's own call UI (chat consumes `startCall`).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous (20 designer calls locked in 5 rounds, 2026-10-06).
- [x] **Every acceptance criterion has at least one test** with a plain-English note.
- [x] **Open questions is empty.** Technical unknowns (desktop screen share, multi-node TURN, quota, transcription speaker names, egress capacity) are researched and recorded above.
- [x] **The data model is named and Supabase-first.** 4 tables + ops + one CHECK migration. Media lives on Azure by design (an exception, recorded in 1–11).
- [x] **Module feature:** spine wiring (links to event + contacts, tasks from action items, activity, quiet notifications), MCP tools and the dashboard widget are defined.
- [x] **Execution blocks** are decomposed, sequenced and context-sized.
- [x] **Design constraints acknowledged:** tokens only, shadcn wrappers, DESIGN_RULES R1–R10, `moduo-design-quality` pass on MEET-2/3/5/6.
- [x] **Manual-test surfaces identified:** `docs/testing/moduo-meet.md` (desktop AV + screen share, phone guest, recording consent, recap).

**Ready to execute.**

## Open questions

- [ ] (none). **External prerequisites** (not product questions): Azure VM quota approval (MEET-0a step 1), Vercel MCP OAuth or a manual DNS record (MEET-0a), Supabase MCP OAuth for migrations/functions.
