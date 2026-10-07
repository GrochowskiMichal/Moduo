# Manual test checklist — PRIV-3: delete a person's PostHog analytics

> Generated 2026-10-08 · branch `t/maciej/priv-3-posthog-erasure` · **Live-verified:** no, not yet. Nothing changes until the PostHog secrets exist, and the functions aren't deployed yet. The logic is covered by unit tests: the PostHog request, the account-deletion step and its failure modes, and the app's switch-off request with its retry.
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
- [ ] **Do:** deploy the new `analytics-forget`. Files: `analytics-forget/index.ts`, `_shared/posthog-erasure.ts`, `_shared/secret-keys.ts`; `verify_jwt: false`. _(server)_
- [ ] **Do:** `curl -X POST https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/analytics-forget` with no `Authorization`. → **Expect:** `401 {"error":"Unauthorized"}`. A `GET` gives `405`. Same for `delete-account`. _(server)_

## 4. End to end (on staging, once the app there has a PostHog key)
- [ ] **Do:** On app.staging.moduo.app, sign in with a throwaway account, wait for the question and click **Share**. Open a few pages. → **Expect:** in PostHog → **People**, a person whose id is the account's user id, with `app_signed_in` / `$identify` events tagged `surface = app`, `environment = staging`. _(staging + PostHog)_
- [ ] **Do:** Settings → Preferences → Privacy → switch **off**. Wait 15 seconds. → **Expect:** the person is gone from PostHog → People. The events disappear after PostHog's Sunday 05:00 UTC run. In Supabase → Edge Functions → `analytics-forget` → Logs, a 200 and no "PostHog refused". _(staging + PostHog)_
- [ ] **Do:** Switch it off while offline (DevTools → Network → Offline), quit, go back online and reopen. → **Expect:** the request goes on the next launch, and the person is gone. _(web)_
- [ ] **Do:** Switch it back on, open a page, then delete the account (Settings → Account → Danger zone). → **Expect:** the deletion succeeds, and the person (recreated by the new events) is gone from PostHog again. In Supabase → `delete-account` → Logs, no `posthog_refused` warning. _(staging + PostHog)_
- [ ] **Do (failure path, optional):** Temporarily set `POSTHOG_PROJECT_ID` to a wrong number and delete another throwaway account. → **Expect:** the account is still deleted, and the logs show `posthog_refused: 404` with the user id. Put the right id back afterwards. _(staging)_

## 5. Then the privacy policy
- [ ] **Do:** Once section 4 passes, publish the policy wording that says deletion is automatic (GrochowskiMichal/Moduo#241, a draft PR into `prod-landing`). → **Expect:** moduo.app/privacy §04 says switching off deletes what was sent; §09 says account deletion does too. _(web)_

## Known gaps / not-yet-testable
- Nothing has been run against real PostHog. The request shape (JSON body, 202) comes from PostHog's server code and is unit-tested with a fake.
- PostHog's event deletion is weekly, so "events gone" can only be confirmed after the next Sunday run.
- A batch PostHog retries after a failed send (offline at the moment of switching off) can land after the deletion request and survive it. That's rare, and the next "switch off" or account deletion catches it.
