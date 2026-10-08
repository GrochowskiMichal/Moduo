# Manual test checklist — Chat v1

> Generated 2026-10-06 · branch `t/mike/chat` · **Live-verified:** partial — server ops round-tripped as a real user on the hosted DB (rolled back); every UI surface rendered + interacted with in Storybook (`Features/Chat/Workspace`). **Not yet** exercised signed-in against the live app (needs an OTP sign-in) — this checklist is that pass.
> You need **two accounts in a Duo/Team/Founder workspace** (e.g. the "fresh" workspace, Team plan, 2 members) — two browsers or web + desktop side by side.

## Access + gate
- [ ] **Do:** Open the Chat tab (⌘7) in a Team/Duo/Founder workspace → **Expect:** you land in `#general`, it's in the rail under Channels. _(both)_
- [ ] **Do:** Switch to a Pro workspace you own and open Chat → **Expect:** "Talk where the work lives" explainer + one *Upgrade to Duo — $20/mo for two* button → opens checkout. _(both)_
- [ ] **Do:** Command palette (⌘K) → "Open Chat" → **Expect:** goes to Chat. _(both)_

## Messaging (two people, side by side)
- [ ] **Do:** A sends "hello" → **Expect:** appears instantly for A (dim until confirmed), for B within ~1s without refresh. _(both)_
- [ ] **Do:** A types `**bold** _it_ ~~s~~ \`code\`` + a ```` ``` ```` block + `> quote` + a URL → **Expect:** each renders formatted; Enter inside an open ``` makes a new line. _(both)_
- [ ] **Do:** A types → **Expect:** B sees "A is typing…" above the composer; it clears after sending or ~4s idle. _(both)_
- [ ] **Do:** A sends 3 messages in a row → **Expect:** one header + avatar, the rest grouped; hover a grouped row shows its time in the gutter. _(both)_
- [ ] **Do:** Send just "🎉" → **Expect:** large emoji. _(both)_
- [ ] **Do:** ↑ in an empty composer → **Expect:** edits your last message inline; Enter saves "(edited)", Esc cancels. B sees the edit live. _(both)_
- [ ] **Do:** Hover → ⋯ → Delete → confirm in the toast → **Expect:** "This message was deleted." for both. _(both)_
- [ ] **Do:** Hover → 👍 / smiley picker / right-click → **Expect:** reaction pill with count; clicking it again removes it; B sees it live; tooltip names who reacted. _(both)_
- [ ] **Do:** Go offline (devtools), send → **Expect:** "Not sent · Retry · Discard"; back online → Retry sends once (no duplicate). _(web)_

## Mentions, links, notifications
- [ ] **Do:** A types `@` → picks B → sends → **Expect:** B's row is tinted with a left bar; B's bell shows "A mentioned you in #general: “…”"; clicking it opens the conversation. _(both)_
- [ ] **Do:** A types `@channel` → **Expect:** everyone not muted gets a bell entry. _(both)_
- [ ] **Do:** Type `#` + part of a task name → pick it → send → **Expect:** a task chip; clicking it opens the task in Tasks. _(both)_
- [ ] **Do:** Type `:ta` → Tab → **Expect:** inserts 🎉. _(both)_
- [ ] **Do:** ⋯ → *Create task from message* → **Expect:** toast "Task created …" with Open → task is in Inbox. _(both)_

## Threads
- [ ] **Do:** Hover → *Reply in thread* → reply → **Expect:** right panel thread; the parent shows "1 reply · Last reply just now" + facepile; the original author gets a bell entry "replied in a thread". _(both)_
- [ ] **Do:** Esc → **Expect:** thread panel closes. _(both)_

## Conversations
- [ ] **Do:** Channels **+** → "Launch Plan" → **Expect:** hint "Will be created as #launch-plan"; duplicate names are blocked inline. _(both)_
- [ ] **Do:** Create a **private** channel with B → **Expect:** lock icon; a third member can't see it in Browse or search. _(both)_
- [ ] **Do:** New message (pencil) → pick B → **Expect:** DM opens; doing it again opens the same DM; picking only yourself opens "(you)" notes. _(both)_
- [ ] **Do:** Header topic → click → edit → Enter → **Expect:** saved for everyone. _(both)_
- [ ] **Do:** Star a channel → **Expect:** moves to Starred. Bell icon → Mute → **Expect:** row dims, no badge. _(both)_
- [ ] **Do:** ⋯ → Archive (as creator/owner) → **Expect:** composer replaced by "archived · read only" + Unarchive; channel leaves the rail, shows in Browse → Archived. _(both)_
- [ ] **Do:** ⌘J → type a name → Enter → **Expect:** jumps there; ⌥↓ / ⌥↑ cycle conversations; ⌥⇧↓ jumps to the next unread. _(both)_
- [ ] **Do:** Header 🔍 → search a word → click a result → **Expect:** opens the conversation and flashes the message (thread results open the thread). _(both)_
- [ ] **Do:** Details (pin icon) → **Expect:** About, members with online dots, Pinned list; pin a message → appears; click → jumps to it. _(both)_

## Unread + badge
- [ ] **Do:** B is on another tab; A posts in a channel B is in → **Expect:** rail row bold for B; mention → count pill; DM → Chat nav tab dot. Opening the conversation clears it. _(both)_
- [ ] **Do:** Open a channel with unread → **Expect:** "New" divider above the first unread and the view starts there; a "Jump to latest" pill when scrolled up. _(both)_
- [ ] **Do:** ⋯ → *Mark unread* on an older message → **Expect:** divider + rail unread come back. _(both)_
- [ ] **Do:** Scroll to the top of a long channel → **Expect:** older history loads without jumping your place. _(both)_

## Agents (MCP) + Home widget
- [ ] **Do:** Settings → API keys → create a key with *Chat: Read + post* → **Expect:** key row shows a "Chat · Post" badge. _(both)_
- [ ] **Do:** From an MCP client (e.g. Claude) with that key, ask it to list channels and post in #general → **Expect:** the post appears live with a bot avatar, the key's name and an **App** badge; DMs/private channels never show up in its tools. _(both)_
- [ ] **Do:** Key with *No chat* → **Expect:** no `chat_*` tools are listed. _(n/a)_
- [ ] **Do:** Home → edit → add **Conversations** → **Expect:** DMs/mentions waiting for you first with counts, then recent ones; clicking a row opens it; updates live when someone messages you. _(both)_

## Edge cases
- [ ] **Do:** Sleep the laptop / kill wifi for > 1 min while B posts, come back → **Expect:** the missed messages appear (resync). _(both)_
- [ ] **Do:** Message > 8,000 characters → **Expect:** red counter, Send disabled. _(both)_
- [ ] **Do:** Paste a copied message link into the address bar → **Expect:** opens that conversation at that message. _(web)_

## Migrations / data
- [ ] `20261006150000_chat_module` + `20261006151000_chat_edit_mention_scope` are **already applied** to `wtoonrvuqumihpkbvwvs` (additive: 3 new tables, `chat_*` functions, Realtime publication + `realtime.messages` policies for `chat:*` topics). Confirm: `select count(*) from chat_channels;` works as the service role; `anon` has no grants.

## Known gaps / not-yet-testable
- Not signed-in live-tested by the agent (OTP sign-in). The checklist above is the first real two-person pass.
- No attachments or calls yet (see `specs/chat.md` → Next).
- Light mode not tuned (repo-wide out of scope).
