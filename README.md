# moduo2.0

Rust-first desktop app using React + Rspack (Rsbuild) + TanStack Router + Tauri + Redb.

## Tech Stack

### Frontend
- **React 19.3** - UI framework
- **Rspack/Rsbuild** - Build tool
- **TanStack Router** - Type-safe routing
- **Tailwind CSS 4.3** - Styling
- **Framer Motion** - Animations
- **Lexical 0.52** - Rich text editor
- **Yjs 13.6** - CRDT for real-time collaboration
- **XYFlow** - Node-based graphs (mindmaps)
- **Dnd Kit** - Drag and drop
- **Lucide React** - Icons
- **Zod** - Schema validation

### Backend (Tauri/Rust)
- **Tauri 2.0** - Desktop runtime
- **Rust nightly-2026-10-06** - Backend language
- **Redb 2** - Embedded database (paused; kept for the future offline/"lite" build)
- **Argon2/Ed25519-dalek/BIP39** - Cryptography
- **Keyring** - Secure credential storage
- **Tokio** - Async runtime
- **Chrono** - Date/time handling
- **IMAP/Lettre** - Email protocol support

### Testing & Development
- **Rstest** - Unit testing
- **Playwright** - E2E testing
- **TypeScript 7** - Type safety

## Setup

1. Copy env values:
   - `cp .env.example .env.local`
2. Install:
   - `bun install`

### Calendar OAuth env
- `MODUO_CALENDAR_GOOGLE_CLIENT_ID`: Google OAuth desktop client ID (must allow `http://127.0.0.1` loopback redirect).
- `MODUO_CALENDAR_MICROSOFT_CLIENT_ID`: Microsoft Entra app client ID (public client/native; delegated permissions include `User.Read` and `Calendars.Read`).
- Apple Calendar does not expose an OAuth API for calendar data in this flow; it requires a separate iCloud CalDAV/app-specific-password integration.

## Run

- Desktop dev (Tauri + web dev server): `bun run dev:desktop`
- Web dev shell (without Rust commands): `bun run dev:web`
- Signed desktop app (debug `.app`, stable keychain identity): `bun run dev:desktop:signed`

## Build

- Web build: `bun run build:web`
- Desktop build: `bun run build:desktop`
- Signed desktop debug bundle: `bun run build:desktop:signed:debug`
- Signed desktop release bundle: `bun run build:desktop:signed:release`
- Verify signed release binary: `bun run verify:desktop:signature`

## macOS Keychain Note

- For reliable keychain behavior, use the signed `.app` flow (`dev:desktop:signed` or signed build scripts).
- `tauri dev` runs an ad-hoc debug binary whose identity changes across rebuilds, which can break keychain trust/ACL continuity.

## Architecture

- Routing: TanStack Router (`/src/router.tsx`)
- Shared app providers/features remain in `/src`
- Gateway contracts in `/src/core/contracts`
- Desktop adapter in `/src/core/adapters/desktop`
- Rust/Tauri command and persistence scaffold in `/src-tauri`
- Local-first persistence is powered by Redb (paused post cloud-first pivot; kept for the future offline/"lite" build)
