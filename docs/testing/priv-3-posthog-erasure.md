# Manual test checklist — PRIV-3: delete a person's PostHog analytics

> Generated 2026-10-08 · branch `t/maciej/priv-3-posthog-erasure` · **Live-verified:** no, not yet. Nothing changes until the PostHog secrets exist, and the functions aren't deployed yet. Unit tests cover the logic: the PostHog request, the account-deletion step and its failure modes, the function's answers (wait, then delete; 503 while the setup is missing or refused), and the app's request with its retry, the marker race and the stop before signing out of a deleted account.
> Run top-to-bottom. Sections 1–2 are one-time setup; 3 is the deploy; 4 is the check.

## 1. Mike, in PostHog (one-time, about 5 minutes)
- [ ] **Do:** Open PostHog (EU cloud, the project the landing uses). Your avatar → **Settings → Personal API keys → Create personal API key**.
  - **Label:** `Moduo account erasure`
  - **Scopes:** only **Person → Write** (`person:write`)
  - **Access:** only the Moduo project, not the whole organization.
  - → **Expect:** a key starting with `phx_`, shown once. Copy it straight into the password manager. It deletes people, so it never goes into git, chat or a file. _(PostHog)_
- [ ] **Do:** **Settings → Project → General**, copy the **Project ID** (a number; it's also in the address bar, `eu.posthog.com/project/<id>/…`). → **Expect:** something like `12345`. _(PostHog)_
- [ ] **Do (recommended):** **Settings → Project → IP data capture configuration → turn on "Discard client IP data".** → **Expect:** PostHog still works out country and city (it does that before discarding) but no longer stores IP addresses. This affects the landing too, which is fine. _(PostHog)_
- [ ] **Do (optional):** **Settings → Project → Session replay → URL triggers**: add `https://(www\.)?moduo\.app(/.*)?` so recordings can only ever start on the landing. The app already never records; this is a second lock. _(PostHog)_

## 2. Mike (or Maciej), in Supabase (one-time)
- [ ] **Do:** Supabase dashboard → project `wtoonrvuqumihpkbvwvs` → **Edge Functions → Secrets** → add:
  - `POSTHOG_PERSONAL_API_KEY` = the `phx_…` key
  - `POSTHOG_PROJECT_ID` = the project id
  - Leave `POSTHOG_API_HOST` unset (it defaults to `https://eu.posthog.com`).
  - → **Expect:** both listed. CLI equivalent: `supabase secrets set POSTHOG_PERSONAL_API_KEY=… POSTHOG_PROJECT_ID=…`. _(Supabase)_

## 3. Deploy (agent, with the designer's OK; after `/code-review ultra` on the PR)
- [ ] **Do:** deploy `delete-account` with the Supabase connector's `deploy_edge_function`. Files: `delete-account/index.ts`, `_shared/account-erasure.ts`, `_shared/billing.ts`, `_shared/secret-keys.ts`, `_shared/posthog-erasure.ts`; `verify_jwt: false`. → **Expect:** a new version (v16). _(server)_
- [ ] **Do:** deploy the new `analytics-forget`. Files: `analytics-forget/index.ts`, `_shared/analytics-forget.ts`, `_shared/posthog-erasure.ts`, `_shared/secret-keys.ts`; `verify_jwt: false`. _(server)_
- [ ] **Do:** `curl -X POST https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/analytics-forget` with no `Authorization`. → **Expect:** `401 {"error":"Unauthorized"}`. A `GET` gives `405`. Same for `delete-account`. _(server)_

## 4. End to end (on staging, once the app there has a PostHog key)
- [ ] **Do:** On app.staging.moduo.app, sign in with a throwaway account, wait for the question and click **Share**. Open a few pages. → **Expect:** in PostHog → **People**, a person whose id is the account's user id, with `app_signed_in` / `$identify` events tagged `surface = app`, `environment = staging`. _(staging + PostHog)_
- [ ] **Do:** Settings → Preferences → Privacy → switch **off**. Wait 15 seconds. → **Expect:** the request leaves at once (DevTools → Network: `analytics-forget`, answered after about 10 s with `200 {"ok":true}`), and the person is gone from PostHog → People. The events disappear after PostHog's Sunday 05:00 UTC run. _(staging + PostHog)_
- [ ] **Do:** Switch it back on, then off and sign out straight away. → **Expect:** the person is still gone after 15 seconds: the request left before the sign-out. _(staging + PostHog)_
- [ ] **Do:** Switch it on, open a page, go offline (DevTools → Network → Offline), switch it off, close the tab, go back online and reopen. → **Expect:** `moduo:analytics-forget:<user id>` was in local storage while offline; on reopening the request goes again, the marker disappears, and the person is gone. _(web)_
- [ ] **Do:** Switch it on, open a page, then delete the account (Settings → Account → Danger zone). → **Expect:** the deletion succeeds, the person is gone from PostHog, and it stays gone: no `app_signed_out` event brings it back. In Supabase → `delete-account` → Logs, no `posthog_refused` warning. _(staging + PostHog)_
- [ ] **Do (failure path, optional):** Temporarily set `POSTHOG_PROJECT_ID` to a wrong number. Switch analytics on and off with another throwaway account. → **Expect:** `analytics-forget` answers `503` and logs "PostHog refused" with the user id; the marker stays. Put the right id back and reload. → **Expect:** the request goes again and the person is gone. With the wrong id, deleting an account still works and logs `posthog_refused: 404`. _(staging)_

## 5. Then the privacy policy
- [ ] **Do:** Once section 4 passes, merge the policy wording that says deletion is automatic (GrochowskiMichal/Moduo#244, a draft PR into `prod-landing`). → **Expect:** moduo.app/privacy §04 says switching off, on each device where you said yes, deletes everything sent under your account; §09 says account deletion does too. _(web)_

## Known gaps / not-yet-testable
- Nothing has been run against real PostHog. The request shape (JSON body, 202) comes from PostHog's server code and is unit-tested with a fake.
- PostHog's event deletion is weekly, so "events gone" can only be confirmed after the next Sunday run.
- Consent is per device, the PostHog person per account. Switching off on one device erases what every device sent, and a device that still says yes keeps sending, which creates the person again. Same after an account deletion: another signed-in device with a yes can send a few events until its session ends. Those carry an id that no longer links to anyone.
- An event that reaches PostHog more than ~10 s after the switch-off (a retried send, a slow network) arrives after the deletion and survives it. The next switch-off or account deletion catches it.
- `analytics-forget` has no per-user throttle (accepted risk, docs/decisions/permissions.md): someone looping it could use up PostHog's private-API rate limit and make account deletions fail until it stops.
