# Mac build runner (`moduo-mac`)

Mike's M4 Pro builds the desktop app when it's online and idle; otherwise the build goes to GitHub's `macos-latest` (spec `specs/platform-v2.md`, PLAT-7, AC12/AC13). `pick-runner` in `.github/workflows/_desktop-release.yml` makes the choice.

- The runner is a separate standard macOS user, `moduo-ci`. It isn't an admin, isn't in `staff`, and can't read Mike's home or keychain.
- Its own keychain holds only the Developer ID Application identity and the notarization login.
- It runs as a LaunchDaemon (`com.moduo.actions-runner`), so it starts at boot with nobody logged in.
- The runner's code and config live in `/Library/Moduo/actions-runner` and belong to root, with self-update off, so a job (running as moduo-ci) can't change what runs the next job. Re-running `setup.sh` updates the runner. If you forget, GitHub eventually stops sending jobs to the outdated runner and builds go to GitHub's Mac.
- A root-owned job-started hook (`job-started.sh`) refuses every job except a push to `develop`/`mike`, a `v*` tag, or the owner's manual run. `pull_request` jobs never run here, even if a workflow asks for the label.

## One-time setup (Mike, in a terminal)

Each step needs your password, your Apple login or a GitHub UI action, so run them yourself.

1. **Export the Developer ID certificate.**
   1. Open **Keychain Access** (Spotlight: "Keychain Access").
   2. In the sidebar, under **Default Keychains**, select **login**. In the tabs at the top, select **My Certificates**.
   3. Find **Developer ID Application: Michal Grochowski (V55SU3M95W)**. Open its disclosure triangle and check that a private key sits under it.
   4. Right-click the **certificate row** (not the key) and choose **Export "Developer ID Application: Michal Grochowski (V55SU3M95W)"…**.
   5. Set **File Format** to **Personal Information Exchange (.p12)**, **Save As** to `moduo-developer-id.p12`, **Where** to **Desktop**, then click **Save**.
   6. Enter a new export password twice and click **OK**. When macOS asks, enter your Mac login password and click **Allow**.

   `setup.sh` imports the file and offers to delete it securely afterwards.
2. **Have your notarization login ready.** CI notarizes with your Apple ID: your Apple ID email, team ID `V55SU3M95W`, and an app-specific password. Make a new one at [account.apple.com](https://account.apple.com) → **Sign-In and Security** → **App-Specific Passwords** → **+**, named `moduo-mac runner`. An App Store Connect API key (`.p8` file, key ID, issuer ID) works too. `notarytool` asks for either.
3. **Create the runner-status token.**
   1. On github.com, go to **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   2. Name it `moduo-runner-status` and give it a 1-year expiration.
   3. Set **Resource owner** to **GrochowskiMichal**. Under **Repository access**, choose **Only select repositories** → **Moduo**.
   4. Under **Permissions** → **Repository permissions**, set **Administration** to **Read-only**. Metadata becomes read-only by itself.
   5. Click **Generate token**, then store it as a repo secret (paste the token when asked):

      ```bash
      gh secret set RUNNER_STATUS_TOKEN --repo GrochowskiMichal/Moduo
      ```

   Without this secret, every build goes to GitHub-hosted macOS.
4. **Require approval for fork PR workflows from every outside contributor.** This is defense in depth; the hook refuses `pull_request` jobs anyway. Either go to **Settings** → **Actions** → **General** → **Approval for running fork pull request workflows from contributors** → **Require approval for all external contributors** → **Save**, or run:

   ```bash
   gh api -X PUT repos/GrochowskiMichal/Moduo/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors
   ```

5. **Run the setup** from a Moduo checkout. It's safe to run again; it skips whatever is already done:

   ```bash
   sudo infra/mac-runner/setup.sh
   ```

   It asks for the `.p12` path and password, runs `notarytool store-credentials` (step 2's login), and gets a runner registration token with your `gh` login. If `gh` can't do that under sudo, it prints the command and asks you to paste the token.
6. **Verify**, then paste the output into the PR:

   ```bash
   sudo infra/mac-runner/setup.sh --verify
   ```

## Day to day

| Want | Do |
| --- | --- |
| Builds go to GitHub for a while | `sudo infra/mac-runner/setup.sh --stop` (`--start` to resume). A sleeping Mac has the same effect. |
| The certificate was renewed | Export the new one (step 1), then `sudo infra/mac-runner/setup.sh --reimport-cert` |
| The app-specific password changed | `sudo -u moduo-ci -H xcrun notarytool store-credentials moduo-notary --keychain /Users/moduo-ci/Library/Keychains/moduo-signing.keychain-db` |
| Re-register the runner | `sudo infra/mac-runner/setup.sh --reregister` |
| See the runner log | `tail -f /Library/Moduo/logs/actions-runner.log` |
| Update the runner | `sudo infra/mac-runner/setup.sh` (it installs the latest release) |
| The pinned nightly or `.bun-version` changed | Nothing: the workflow installs the toolchain per job. Re-run `setup.sh` to keep `--verify` green. |

**Cache:** the Cargo target dir (`/Users/moduo-ci/cache/cargo-target`) persists between builds; the hook clears it past 60 GB. The Bun cache is `/Users/moduo-ci/cache/bun`. While a job runs, the hook holds a `caffeinate` assertion so the Mac doesn't idle-sleep mid-build. A Mac that sleeps anyway fails the job as "runner lost". Re-run it: every re-run (failed jobs or all) builds on GitHub's Mac. If the Mac sleeps after `pick-runner` chose it, `mac-watchdog` cancels the run after 6 minutes instead of letting the job queue for a day.

**Removing it:**

```bash
sudo launchctl bootout system/com.moduo.actions-runner
sudo rm /Library/LaunchDaemons/com.moduo.actions-runner.plist
sudo rm -r /Library/Moduo
sudo sysadminctl -deleteUser moduo-ci
```

Then delete the runner under the repo's **Settings** → **Actions** → **Runners**.
