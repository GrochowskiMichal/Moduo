# Manual test checklist — profile pictures and workspace marks

> Generated 2026-10-01 · branch `t/mike/profile-workspace-images` · **Live-verified:** partial — the `avatars` bucket, `workspaces.icon` / `logo_url`, and the eight storage policies are on the hosted project. The settings screens were not clicked through in a signed-in browser.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Account picture
- [ ] **Do:** Settings → Account → Change picture → pick a JPEG, PNG, WebP, or GIF under 4 MB → Save changes. → **Expect:** the picture stays after a reload, and the top-bar account menu shows the same picture. _(both)_
- [ ] **Do:** Open the app in another browser, signed into the same account. → **Expect:** the same picture, not the initial. _(web)_
- [ ] **Do:** Settings → Account → Remove → Save changes. → **Expect:** the picture is gone and the initial is back, including in the top bar and on the workspace member row. _(both)_
- [ ] **Do:** Try a PDF or a file over 4 MB. → **Expect:** an error, and the previous picture stays. _(both)_

## Workspace icon or logo
- [ ] **Do:** Settings → Workspace, as the owner → click the mark beside the name → pick an emoji. → **Expect:** the emoji replaces the letter in Settings and in the top-left workspace switcher. _(both)_
- [ ] **Do:** Upload a logo from that same popover. → **Expect:** the image replaces the emoji. Paste a single emoji after that. → **Expect:** the emoji comes back and the image is gone. _(both)_
- [ ] **Do:** Remove. → **Expect:** the mark falls back to the workspace's first letter. _(both)_
- [ ] **Do:** Open Workspace settings as a member who is not the owner. → **Expect:** the mark is visible and cannot be changed. _(both)_

## Members
- [ ] **Do:** After two people in one workspace each set a profile picture, open Settings → Workspace. → **Expect:** each member row shows that person's picture, not only an initial. _(both)_

## Migrations / data
- [ ] **Do:** In the hosted project, confirm bucket `avatars` is public, and `workspaces` has `icon` and `logo_url`. → **Expect:** both columns exist and the bucket allows jpeg/png/webp/gif up to 4 MB. _(backend — already confirmed 2026-10-01)_

## Known gaps / not-yet-testable
- Upload, replace, and remove were not exercised with a signed-in session in the browser. The database objects are in place; the click-path above is the confirmation.
