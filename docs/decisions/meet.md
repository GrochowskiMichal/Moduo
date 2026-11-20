# Decisions: Moduo Meet (video calls)

Full entries for this area, newest first. The one-line index of every area, [docs/decisions.md](../decisions.md), is generated: add new entries at the top here, each with a status line (see the index), then run `bun run docs:index`. `bun run docs:current <area>` hides superseded entries.

> **Note (2026-10-17):** Moduo Meet was re-planned as **Calls** (Chat v2 CH76, 2026-10-14: huddles and the Google Meet replacement on one engine; see `specs/BUILD_ORDER.md` §Moduo Meet). The entries below are the original plan; the Calls re-plan decides which survive.

- **2026-10-06 · Moduo Meet: our own video calls on self-hosted LiveKit in Azure Poland Central (/s1 planned, DoR-ready).** A third video platform (`moduo_meet`) next to Google Meet/Zoom, default for paid hosts, on booking links, any event, and instant calls. Hosting is paid (pro+), joining is free for anyone. Up to 12 people, 4 h max. Invited people walk in and strangers knock (a LiveKit restricted grant, upgraded by the host). One always-on node + VMSS burst (min 1 / max 3, Azure Managed Redis), L4 LB for `rtc.`/`turn.moduo.app:443`. Recording = co-located Egress → Blob (2-concurrent cap). Transcript = Azure AI Speech batch per participant track (real names, PL/EN). No built-in AI summaries (MCP-only). The recap is a Call note linked to the event + attendee contacts. The engine (`src/features/meet/`) is the one chat's calls reuse. → [specs/moduo-meet.md](../../specs/moduo-meet.md)
  - status: current
