# Staging distribution — manual test checklist

Branch: `t/mike/staging-distribution` → merged to `mike` → merged to `develop`

---

## 0. Pre-flight (do this before testing anything else)

### Required manual steps not done by the agent

- [ ] **Connect Vercel git** — in [Vercel → moduo-staging → Settings → Git](https://vercel.com/grochowskimichals-projects/moduo-staging/settings/git):
  - Connect to `GrochowskiMichal/moduohyb`
  - Production branch = `develop`
  - Click **Save** and trigger a new deploy (or push any commit to develop)
- [ ] **Add Vercel env vars** — copy from your `.env.local` into [Vercel → moduo-staging → Settings → Environment Variables](https://vercel.com/grochowskimichals-projects/moduo-staging/settings/environment-variables):
  - `PUBLIC_SUPABASE_URL`
  - `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `PUBLIC_STRIPE_PUBLISHABLE_KEY` + price keys
  - `PUBLIC_STAGING_ALLOWLIST` = comma-separated founder emails (e.g. `mike@example.com,maciej@example.com`)
  - *(already added by agent: `PUBLIC_WEB_ORIGIN`, `PUBLIC_STAGING_PORTAL`, `MODUO_TARGET`)*
- [ ] **Add GitHub Actions secrets** for desktop CI — [Settings → Secrets → Actions](https://github.com/GrochowskiMichal/moduohyb/settings/secrets/actions):
  - `APPLE_CERTIFICATE` — base64-encoded Developer ID Application `.p12` (run: `base64 -i YourCert.p12`)
  - `APPLE_CERTIFICATE_PASSWORD` — p12 password
  - `APPLE_SIGNING_IDENTITY` — `Developer ID Application: <Name> (<TeamID>)`
  - `APPLE_TEAM_ID` — 10-char Apple team ID
  - `APPLE_ID` — Apple ID email for notarization
  - `APPLE_ID_PASSWORD` — App-specific password for that Apple ID
  - `TAURI_SIGNING_PRIVATE_KEY` — contents of `/tmp/moduo-staging-key` (generated this session; **save it now**)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty string `""`
  - All secrets from the existing Windows portable workflow (already set)

---

## 1. Vercel web deploy (staging.moduo.app)

**Surface: web browser**

- [ ] Open `https://staging.moduo.app` → page loads (not the old Next.js placeholder)
- [ ] Title is "Moduo" and the app shell appears (auth page or logged-in app)
- [ ] After login: navigate to `/tasks`, `/calendar`, `/notes` — they load correctly
- [ ] Share a note (`/p/<token>`) — the link uses `https://staging.moduo.app/p/<token>` not `localhost`
- [ ] Push a new commit to `develop` → Vercel dashboard shows a new deployment triggered automatically

---

## 2. Staging portal (logged-out view)

**Surface: web browser, logged out**

- [ ] Open `https://staging.moduo.app` while not signed in → redirected to `/auth`
- [ ] Auth page shows a **STAGING** badge in the upper-left corner
- [ ] Below the login card: a "Desktop app — staging build" strip is visible
- [ ] Two download buttons: **Download for Mac (.dmg)** and **Download for Windows (.exe)**
- [ ] Download links point to `https://github.com/GrochowskiMichal/moduohyb/releases/download/staging-latest/…`
  - *(links 404 until the first desktop CI run completes — that's expected)*
- [ ] After signing in: the STAGING badge and download strip are NOT shown (logged-in app)

---

## 3. Email allowlist

**Surface: web browser, logged out**

*Prerequisite: `PUBLIC_STAGING_ALLOWLIST` env var is set in Vercel*

- [ ] Open `/auth` on staging, type an email that IS on the allowlist → OTP code is sent normally
- [ ] Type an email NOT on the allowlist → error shown: "This staging build is invite-only. Contact us to request access." — no email sent
- [ ] Verify the allowlist check only fires when the env var is set (dev build with no env var → normal OTP flow)

---

## 4. Desktop CI — GitHub Actions

**Surface: GitHub Actions**

- [ ] Go to [Actions → Desktop Release (staging)](https://github.com/GrochowskiMichal/moduohyb/actions/workflows/desktop-release.yml)
- [ ] Trigger manually via **Run workflow** → confirm both `build-mac` and `build-windows` jobs start
- [ ] `build-mac` job completes → `.dmg` is signed (check "Import Apple certificate" step passes)
- [ ] Notarization step passes (`xcrun notarytool submit` + `xcrun stapler staple`)
- [ ] `build-windows` job completes → NSIS installer built
- [ ] `publish` job completes → GitHub Release `staging-latest` is created/updated with:
  - `Moduo_universal.dmg`
  - `Moduo_x64-setup.exe`
  - `latest.json`
- [ ] Download the `.dmg` from the release → opens on Mac without Gatekeeper blocking it (if Developer ID cert was used)
- [ ] Push a change to `src-tauri/` on `develop` → CI runs automatically

---

## 5. In-app updater

**Surface: desktop app**

*Prerequisite: a `staging-latest` release exists with a `latest.json` whose version is higher than the installed app*

- [ ] Open Settings → About
- [ ] "Check for updates" button is visible below the version string
- [ ] Click it → status changes to "Checking…" then to one of:
  - "Moduo is up to date." (if already latest)
  - "Update available vX → vY" with a **Download Update** button
- [ ] When update is available: click **Download Update** → progress bar appears
- [ ] Download completes → "Update downloaded" + **Restart to Update** button shown
- [ ] Click **Restart to Update** → app relaunches

---

## Known gaps / not verified by agent

- Notarization (requires paid Apple Developer account + CI secrets to be configured)
- Download links work end-to-end (requires first CI run after secrets are added)
- Updater restart on Windows (not locally testable without a Windows build)
- `PUBLIC_STAGING_ALLOWLIST` enforcement on the Vercel-deployed build (requires Vercel env to be set)
