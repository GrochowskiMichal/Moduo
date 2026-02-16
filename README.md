# moduo2.0

Hybrid app starter using Bun + Expo Router (mobile/web) + Electron (desktop) + Supabase + Tamagui `2.0.0-rc.0`.

## Setup

1. Copy env values:
   - `cp .env.example .env.local`
2. Fill:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new key format, not legacy anon)
3. Install (already done in this workspace):
   - `bun install`

## Run

- Mobile/Web (Expo): `bun run start`
- Web only: `bun run web`
- Desktop (Electron + Expo web): `bun run desktop`

## Auth flow included

- First screen: email + magic code.
- Protected route group for authenticated app.
- Top-positioned `Logout` button in the authenticated screen.
