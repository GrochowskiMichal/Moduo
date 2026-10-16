> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

# Threads, replies and side conversations — how to keep a workspace chat organized

**Lane:** threads. Feeds **CH30** (round 2), which replaces CH12 ("Threads stay, and open on the right"), not accepted on 2026-10-13.

**The designer's problem (2026-10-13), in short:** nobody follows thread rules, so half a conversation sits in a thread and half under it in the channel. Discord's separate threads section doesn't fix it either, because "people don't know if their message is going to become a thread with multiple people involved."

**Fixed context (not re-opened here):** a discussion about one item (a task, a note) lives on that item as comments (flat, no threads, six reactions). Chat owns conversations: channels and direct messages. A channel can be linked to one project, client or team (CH2 B). Catch up is the one list of what's addressed to you (CH8). Only what's addressed to you pings (CH6). A message becomes a task through Tasks' capture (CH10). Not repeated here: the general structure comparison in [structure-competitors.md](./structure-competitors.md) §2 D4.

**Legend.** [V] = checked against a primary source (the vendor's own docs, blog, changelog or release notes, or the author's own post), linked. [U] = unverified: secondary source, search snippet only, or prior knowledge. Treat [U] as a lead to check, not a fact.

**Status of this file:** complete (2026-10-13).

---

## 0. The finding in one paragraph

The designer's complaint is the oldest known problem with chat threads, and Slack's own team described it first. Their product write-up says it was unclear when to start a thread or post a normal message, so the team "did both interchangeably" and got a mix of linked and unlinked messages [V: [Slack Engineering, "Weaving Threads", Paul Rosania, Jan 2017](https://slack.engineering/weaving-threads/)]. Their design history adds the core dilemma: replies shown **in** the channel made busy channels unreadable; replies taken **out** of the channel made them readable but stopped marking anything unread, so a separate "All Threads" view had to be invented [V: [slack.design, Hubert Florin, part 2](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-2-of-2/)]. Every product below sits somewhere on that line. Nobody has solved "people don't choose the right place up front". The tools that cope best either **remove the choice** (every reply is just a reply; the app shows the structure) or **let anyone fix it afterwards** (Zulip moves messages between topics; Mattermost needed a plugin for it). Moduo already has the routing view that the "out of the stream" side needs: Catch up (CH8).

---

## 1. How products handle replies and side conversations

Each product gets the same three lines first, so they can be compared:
- **Unit:** what a conversation is made of.
- **Wrong place:** what happens when someone replies in the wrong place.
- **Move / regroup:** whether messages can be moved or regrouped after they are sent.

Then what works and what breaks. Rows that rest mostly on secondary sources say so.

### 1.1 Slack — optional threads, hidden from the channel

- **Unit:** a channel is one stream. Any message can start **one level** of replies. Replies live in a side panel, not in the channel. The channel shows "N replies · avatars · last reply time" under the parent [V: [VentureBeat on the launch, Jan 2017](https://venturebeat.com/business/slack-introduces-threaded-replies)].
- **Wrong place:** if you reply in the channel, it's just a new message; nothing links it to what it answers. If you reply in a thread, the channel never sees it unless you tick **"Also send to #channel"** under the box. After sending, a thread reply can still be pushed to the channel from its ⋯ menu ("Send reply to this channel") [V: [Slack help, Use threads](https://slack.com/help/articles/115000769927)].
- **Move / regroup:** only one direction exists: thread → channel (the broadcast). A channel message can't be moved into a thread, and a thread can't be moved to another channel [U: absence of any such option in Slack's help; other vendors' feature boards note Slack lacks it ([ClickUp request](https://feedback.clickup.com/feature-requests/p/move-message-as-a-reply-to-a-thread-after-it-has-been-posted))].
- **Works:** in busy channels (Slack's own team says "busy channels with hundreds of members") threads keep side topics out of the main feed, let late readers reply to an old message, and make answers searchable [V: [Slack blog, getting the most out of threads](https://slack.com/blog/collaboration/getting-the-most-out-of-threads)]. Slack's internal review found threads strongest in channels with frequent small requests, for updates added to an old post, and for late replies [V: Weaving Threads].
- **Breaks:** the up-front choice. Slack tried six internal versions. Nested replies confused everyone. One-level replies shown in the channel made channels unreadable ("multiple conversations wove into each other"). Taking replies out of the channel fixed reading but meant replies no longer marked the channel unread; Activity was "easy to miss yet distracting", so they built All Threads; people still feared missing out, so they added "also send to channel" [V: [slack.design part 1](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-1-of-2/), [part 2](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-2-of-2/)]. Slack also says its user study preferred the side panel to inline replies [U: VentureBeat, reporting Slack's head of design]. Today threads you follow sit in a **Threads** view at the top of the sidebar; you follow a thread if you started it, replied, or were mentioned [V: Slack help, same article].
- **Note:** Slack tested a version where replies opened **in place**, pushing the channel up and down. It was "so disruptive" they turned it off [V: slack.design part 1]. That is the main warning for any show-in-place design (§3 option C).

### 1.2 Discord — quote-replies, threads, forum channels

*Discord's help site blocks automated reading; most Discord rows rest on press coverage and community posts.*

- **Unit:** a text channel is one stream. Three ways to answer something:
  - **Reply** (2020): the answer stays in the channel, with a small quote of the parent above it; it pings the parent's author by default, with an on/off toggle [U: [Discord support, What is the Reply feature](https://support.discord.com/hc/fr/articles/360057382374), via search snippet].
  - **Thread** (July 2021): a named side conversation in a split pane, built as "an expansion" of replies; it auto-archives after inactivity (1 hour to 1 week) [U: [TechCrunch, July 2021](https://techcrunch.com/2021/07/27/discord-threads/)].
  - **Forum channel** (Sept 2022): every post is its own titled thread with tags; the channel is a list of posts, not a stream [V: [Discord blog, Forum Channels](https://discord.com/blog/forum-channels-space-for-organized-conversation)].
- **Wrong place:** a quote-reply in the channel is never "wrong": it's always visible and always linked to its parent. A thread hides its replies from the channel; you aren't notified for threads you haven't joined [U: [Discord developer docs on threads](https://docs.discord.com/developers/topics/threads.md), via the competitor lane].
- **Move / regroup:** none. A thread can be started from an old message, but replies already in the channel can't be pulled into it. Users ask for it [U: [Discord community request](https://support.discord.com/hc/de/community/posts/4405330194583-Feature-Request-create-permissions-to-migrate-channel-messages-into-a-thread)].
- **Works:** quote-replies are the everyday mechanic in small servers: no choice to make, everyone sees everything, the link to the parent is kept [U: prior knowledge]. Forum channels work for support and Q&A, where every question really is its own topic; Discord's reason was that in busy channels a topic gets "drowned out, hijacked, or abandoned" [V: Discord blog].
- **Breaks:** this is the designer's Discord complaint. A thread is a decision someone has to make before anyone knows if the topic will grow. Inactive threads disappear from view, and users ask for a "never hide" option [U: [community request](https://support.discord.com/hc/pl/community/posts/13723557751319-Thread-Inactivity-Option-Never-Hide-Expire)].

### 1.3 Microsoft Teams — posts, then chat-like threads (2025)

- **Unit:** two worlds. **Channels** used "posts" from 2017: each post is a block with its replies shown underneath it, in place, collapsed when long [V: [Practical365, Tony Redmond, July 2025](https://practical365.com/teams-threaded-layout/)]. **Chats** (DMs, group chats) are flat, with quoted replies since 2021 [U: [Petri](https://petri.com/microsoft-teams-desktop-client-gets-quoted-reply-feature-for-chat)].
- **Wrong place:** in the posts layout you can't reply "in the channel" at all: you either reply under a post or start a new post. Mistakes are a new post that should have been a reply. In the 2025 threads layout, the reply box offers "Reply in thread only" and "Reply in thread and channel", which Redmond calls "guaranteed to confuse users" [U: Practical365, secondary].
- **Move / regroup:** none found.
- **What changed:** from mid-2025 a channel can switch to a **Threads** layout: a chat-like stream, and any message can open a side-pane thread. Microsoft's reason: "a more collaborative layout for conversation in channels", with "side conversations without cluttering the main chat" [V: [MC1088172 mirror](https://mc.merill.net/message/MC1088172)]. Owners can convert an existing posts channel; people on old clients see it in a compatibility mode [V: same].
- **Works:** posts kept every reply next to what it answered, in place. Good for slow, structured topics (Redmond still prefers it for reviewing ideas).
- **Breaks:** posts read like email; people used group chats instead of channels, which Redmond reads as the real reason for the change [U: Practical365]. The 2025 move is evidence that **an in-place, everything-is-a-topic channel lost to a chat stream with optional threads**, at Microsoft's scale.

### 1.4 Google Chat — from "topics" to Slack-style threads (2022–2025)

- **Unit:** a space is a stream; any message can open a thread of up to 500 replies [V: [Workspace Updates, May 2023](https://workspaceupdates.googleblog.com/2023/05/google-chat-upgrading-conversations-grouped-by-topic-to-inline-threading.html)].
- **Important correction:** Google calls this "**in-line** threading", but the replies are **not shown in place**. The message shows "X replies" and the thread opens in a panel on the right, like Slack [V: [Workspace Updates, Oct 2022](https://workspaceupdates.googleblog.com/2022/10/in-line-threading-in-Chat-spaces.html); help steps via [Google Chat help](https://support.google.com/chat/answer/12176589), search snippet]. Since Feb 2024 the avatars of a thread's unread repliers show under the message so you can judge it without opening it [U: [Workspace Updates, Feb 2024](https://workspaceupdates.googleblog.com/2024/02/see-participant-avatars-unread-threads-in-google-chat.html), search snippet].
- **What it replaced:** "spaces organized by conversation topic": each topic had its own reply box, and replies were grouped under their topic, in place; you pressed "+ New topic" to start something new [V: Oct 2022 post]. Google stopped offering it for new spaces in March 2023 and upgraded every old one by Q1 2024, for "a single, streamlined flow of conversation"; after the upgrade, old messages show in time order, not by topic [V: May 2023 post].
- **Nov 2025:** threads came to DMs and group DMs too, on by default, no admin or user switch, as "a highly requested feature" for "conversation consistency" [V: [Workspace Updates, Nov 2025](https://workspaceupdates.googleblog.com/2025/11/inline-threading-direct-messages-google-chat.html)].
- **Wrong place:** a user in teams of 15+ says "someone always forgets to 'Reply in Thread'", leaving the conversation split between main chat and thread [U: Google community thread, 2022, via search snippet]. In June 2026 a Space owner asked for a switch to turn threads off per space: operational updates get buried in sub-threads, and the "Reply in thread" icon sits next to "Quote in reply", so users "click it by accident" [V: [Google developer forum, June 2026](https://discuss.google.dev/t/option-to-disable-reply-in-thread-inline-threading-in-google-chat/375042)]. So Google Chat has **two** reply mechanics side by side (thread and quote), and people pick the wrong one.
- **Move / regroup:** none found.
- **Works:** notifications only for threads you're in or follow, which Google says "reduce[s] noise" [V: Oct 2022 post].
- **Breaks:** exactly the designer's mess, reported by Google's own users, after Google dropped the in-place topic model.

### 1.5 Zulip — every message has a topic; anyone can fix it later

- **Unit:** channel → **topic** → messages. Every message is sent to a named topic; the sidebar lists topics with unread counts [V: [Why Zulip](https://zulip.com/why-zulip/)].
- **Wrong place:** a message sent to the wrong topic, or a tangent that grew inside a topic, is moved afterwards (below). Zulip treats tidying as a normal, shared job, not a failure.
- **Move / regroup — the strongest in any mainstream tool:**
  - From any message: **Move messages**, choosing "only this message", "this and all later messages", or "all messages in the topic" (`change_one`, `change_later`, `change_all`) [V: [Zulip API, update-message](https://zulip.com/api/update-message)].
  - It can post a notice in the new topic ("moved here from…", on by default) and in the old one (off by default) [V: same].
  - Links to moved messages keep working; muted topics stay muted when a whole topic moves [V: [Zulip help, move content](https://zulip.com/help/move-content-to-another-topic)].
  - Who may move, and for how long after sending, is a setting per organization; since 11.0, per channel and per group [V: API page; [Zulip 11.0 blog, Aug 2025](https://blog.zulip.com/zulip-server-11-0)].
  - **Resolve a topic** puts "✔" before its name; it is itself a move, and the bot's notice is unread only for people who posted there [V: [Zulip help, resolve a topic](https://chat.fhir.org/help/resolve-a-topic), on a Zulip server].
- **Works:** reading by topic after time away; nothing is ever "half in, half out", because there is no "out". Customers credit topics with making large-group talk "far more manageable" [V: Why Zulip, customer quote].
- **Breaks:** you must name a topic before you speak, which is friction for quick pings and social talk. Zulip itself relaxed it twice: a default "general chat" topic, then **channels without topics** in 11.0 (Aug 2025) for "social channels" or "ones with a narrow purpose"; organizations "generally enable it for one or two channels" [V: Zulip 11.0 blog]. The competitor lane's view stands: overkill at 2–5 people (REPLAN CH2 D).
- **Lesson for Moduo:** the move tools, not the topic rule. They are the only mature, tested answer to "people put things in the wrong place".

### 1.6 Mattermost — Collapsed Reply Threads, and a plugin to move messages

- **Unit:** a channel stream. Before **Collapsed Reply Threads** (beta July 2021), replies appeared **in the channel** as normal messages, linked to their parent [V: [Mattermost blog, CRT beta, July 2021](https://mattermost.com/blog/collapsed-reply-threads-beta)]; [V: [forum: with CRT off, the reply is placed in line in the channel](https://forum.mattermost.com/t/how-to-disable-threads/17748)]. CRT collapses replies under the first message, adds a **Threads** view of followed threads, and auto-follows threads you're in or mentioned in [V: CRT beta post].
- **The toggle is per person:** admins set the default; each user can turn CRT on or off in Display settings [V: CRT beta post; [GA post](https://mattermost.com/blog/collapsed-reply-threads-generally-available/)]. Users complain in both directions: some can't find a way to disable it; one on 10.2.3 wants replies shown in sequence in the channel again [V: [forum](https://forum.mattermost.com/t/mattermost-version-10-2-3-how-to-always-display-any-messages-on-any-threads-in-sequence-in-the-channel-pane-those-threads-is-part-of/22619)].
- **Wrong place / move:** the **Wrangler** plugin exists because "Sometimes Mattermost messages just don't end up in the right place." It can **move** or **copy** a message or thread to another channel, and **attach** a standalone message to an existing thread in the same channel; admins choose who may use it [V: [Wrangler README](https://github.com/gabrieljackson/mattermost-plugin-wrangler)].
- **Lesson for Moduo:** two tested ideas. (1) Collapsed vs in-the-stream can be **a personal display choice over the same data**. (2) "Attach to thread" is exactly the fix for "half in, half out".

### 1.7 Element / Matrix — threads that broke unread

- **Unit:** a room stream; quote-replies; threads in a side panel (Element shipped threads in 2022) [U].
- **Breaks:** the hard part was **unread and notifications**, not the panel. The Matrix spec team kept threads out of Matrix 1.3 in May 2022 because the proposal for "notifications for threads" was unproven [V: [This Week in Matrix, 13 May 2022](https://matrix.org/blog/2022/05/13/this-week-in-matrix-2022-05-13/)]. Per-thread read receipts were added so that reading the main timeline doesn't mark threads read; newer clients such as Element X ignore those receipts, so their unread state goes wrong [V: [MSC4102 proposal text](https://git.sudo.is/matrix/matrix-doc/src/branch/kegan/fix-threaded-read-receipts/proposals/4102-unthreaded-read-receipts.md); background in [Patrick Cloke, Jan 2023](https://patrick.cloke.us/posts/2023/01/05/matrix-read-receipts-and-notifications/)].
- **Move / regroup:** none found.
- **Lesson for Moduo:** every place that holds messages outside the main stream needs its own read state. Fewer such places = fewer unread bugs. (A technical note, not a product call.)

### 1.8 Telegram — quote-replies; topics only for big groups; a "view as messages" switch

- **Unit:** a group is one stream. Replies quote their parent in the stream. **Replies 2.0** (Oct 2023) lets you quote just part of a message (tapping it jumps to the exact spot) and **reply in another chat**, e.g. to answer privately or move the discussion elsewhere [V: [Telegram blog, 28 Oct 2023](https://telegram.org/blog/reply-revolution)].
- **Topics** (Nov 2022): a group can be split into topics that "function as individual chats", each with its own media and notification settings; "intended specifically for large groups", with "a different set of tools, tailored to small groups" promised [V: [Telegram blog, 5 Nov 2022](https://telegram.org/blog/topics-in-groups-collectible-usernames)]. A permanent "General" topic always exists [U].
- **View as messages:** each person can show a topics group as one ordinary stream with all topics mixed; the choice is local to that account [V: [Telegram API, toggleViewForumAsMessages](https://core.telegram.org/method/channels.toggleViewForumAsMessages)].
- **Wrong place:** a quote-reply can't be wrong. A message in the wrong topic stays there [U].
- **Move / regroup:** "Reply in another chat" moves the *next* reply elsewhere, not the earlier ones.
- **Lesson for Moduo:** structure as **a view each person picks** over one set of messages, and quote-replies as the default that never fails.

### 1.9 WhatsApp — quote-replies, and a threads beta (2025)

- **Unit:** a group is one stream; swipe to reply quotes the parent above your message.
- **2025 beta:** **threaded replies**: the parent's bubble gets a reply indicator; tapping opens a screen with every reply to that message, where you can add another. One report says it appears in groups when a message gets replies from several people [U: [WABetaInfo](https://wabetainfo.com/whatsapp-introduces-threaded-message-replies-for-more-organized-conversations/), [9to5Mac, July 2025](https://9to5mac.com/2025/07/08/whatsapp-is-working-on-threaded-replies-in-group-chats/), beta reports only].
- **Wrong place:** none possible; replies stay in the stream.
- **Move / regroup:** none.
- **Lesson for Moduo:** the biggest chat app is adding a **thread view on top of replies that stay in the stream**, not a separate place to reply. If it ships, most people will know the mechanic from their phone.

### 1.10 iMessage — replies that stay in the stream *and* form a thread

*Display details come from press coverage of iOS 14; Apple's own help page only gives the steps.*

- **Unit:** one conversation. Touch and hold a message → Reply [V: [Apple support](https://support.apple.com/en-ng/104974)].
- **How it shows:** the reply is posted as the **newest message** in the main conversation, with the original shown above it, a thin bracket joining them, and a count of replies; tap the count to see the whole chain on its own [U: [Macworld](https://www.macworld.com/article/3567512/ios-14-everything-new-in-the-messages-app.html), [MacRumors, June 2020](https://macrumors.com/2020/06/22/ios-14-imessage-features)].
- **Wrong place:** impossible. Every reply is in the stream, in time order; the chain is an extra way to read it.
- **Move / regroup:** none.
- **Lesson for Moduo:** the closest thing to the designer's "nobody has to choose up front". Nothing is hidden, nothing is split. The cost: in a busy group, the stream holds every reply, so side chains still interleave.

### 1.11 Twist (Doist) — thread-first, now in maintenance

- **Unit:** channel → **titled thread** (title + body, like an email or forum post) → comments; real-time talk goes to private Messages [U: [TechCrunch, Oct 2021](https://techcrunch.com/2021/10/12/doist-redesigns-twist-the-slack-alternative-focused-on-async-work/); [twist.com](https://twist.com/)].
- **Wrong place:** you "can't talk outside of a thread" in channels [U: TechCrunch 2017]. The failure is the opposite one: a quick question becomes a titled thread, or moves to DMs.
- **Move / regroup:** not checked.
- **Status:** Doist says Twist "is not currently undergoing major feature development" and that it has no plans to shut it down [V: [Doist help article, undated](https://developer.twistapp.com/help/articles/5863164524572)].
- **Lesson for Moduo:** thread-first suits async teams across time zones; it never became mainstream.

### 1.12 37signals: Campfire (ONCE) and Basecamp — flat chat, structure elsewhere

- **Unit:** Campfire is rooms and DMs, flat; the ONCE product page lists no threads [V: [once.com/campfire](https://once.com/campfire)]. In Basecamp, each project has a flat chat (also called Campfire), a Message Board for long posts, and comments on every to-do, document and post.
- **Replies:** Basecamp added **direct replies** to Campfire and Pings: ⋯ → Reply puts the original line and author "automatically quoted above" your message, in the flat transcript [V: [37signals updates, "Direct Replies + Boosts", Aug, likely 2022](https://updates.37signals.com/post/new-in-basecamp-direct-replies-boosts-on-campfires-and-pings)]. **Boosts** are short reactions of up to 12 characters attached to the line, "without kicking off any noisy notifications" [V: same].
- **Wrong place:** Basecamp's answer is a rule, not a feature: chat "should be about quick, ephemeral things"; anything important needs "time, traction, and separation", so it goes to a message or a to-do's comments; when chat drags on, ask someone to "write it up" [V: [Basecamp guide, Group chat problems](https://basecamp.com/guides/group-chat-problems)].
- **Move / regroup:** none in chat.
- **Lesson for Moduo:** this is the closest existing shape to Moduo's fixed boundary (comments on items, chat for conversations). Basecamp keeps chat flat **because** the structured discussion has another home. Moduo has that home: item comments and notes.

### 1.13 Quill and Threads.com — thread-only chat, both gone (not because of threads)

- **Quill** (2021): "everything in Quill is a thread": each new entry in a channel automatically became its own thread, which a reviewer said makes channels easier to scan than Slack, where threading needs a deliberate act [U: [t3n review](https://t3n.de/news/?p=1358333) and vendor blurbs via aggregators]. Twitter bought the team in Dec 2021 to work on DMs; Quill shut down after about 10 months, with four days to export [V: [TechCrunch, 7 Dec 2021](https://techcrunch.com/2021/12/07/twitter-acquires-quill-a-would-be-slack-rival-team-will-work-on-dms-as-quill-shuts-down/)].
- **Threads.com** (2019–2024): async discussions built around posts rather than real-time chat [U: [CNBC, 2019](https://www.cnbc.com/2019/02/26/former-facebook-manager-launches-threads-rival-to-workplace-and-slack.html)]. Shopify bought it in June 2024; the team said Meta's "Threads" made a rebrand inevitable and they "weren't that excited" to spend time on it [V: [TechCrunch, 7 June 2024](https://techcrunch.com/2024/06/07/shopify-acquires-threads-no-not-that-one)].
- **Honest reading:** neither shows that thread-only chat fails. Quill ended as a team hire; Threads.com ended over a name. What they show: standalone products with a new conversation unit **didn't win** in the years they had.

### 1.14 Linear and Height — talk on the work

- **Linear:** no chat. Issues carry comments with **one level of threaded replies**. **Resolving** the first comment collapses its replies; resolving one chosen reply hides everything except that reply, "so that you can highlight key details or decisions made" [V: [Linear changelog, 8 Nov 2023](https://linear.app/changelog/2023-11-08-resolve-comments); [Linear docs, comments](https://linear.app/docs/comment-on-issues)]. Real-time talk stays in Slack, bridged by synced threads (competitor lane, D7).
- **Height:** task discussions were a chat-like stream on each task [U: prior knowledge]. Height announced its shutdown in March 2025 and went offline on 24 Sept 2025, with no detailed reason [U: [AlternativeTo](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/)].
- **Wrong place:** in Linear, talk about the work that happens in Slack has to be bridged in; the item is the right place by definition.
- **Lesson for Moduo:** Linear's **resolve that keeps the conclusion visible** maps directly onto a long side conversation in chat: collapse it, keep the answer showing.

### 1.15 Newer and odder shapes

- **Glue** (2024–): AI-native work chat with **no channels**; the unit is a thread. In April 2026 its founder wrote that by late 2025 the product "hadn't hit the mark"; it was simplified around threads, and threads can now be **closed** when the work is done [V: [Glue blog, Evan Owen, 16 Apr 2026](https://glue.ai/blog/simple-is-a-feature)]. Still alive; still small [U].
- **Flowdock** (2010–2023, dead): replies were **not hidden**; each reply chain got a **colour**, so you could see which messages belonged together in one flat stream [U: [review on Software Advice](https://www.softwareadvice.com.au/software/410647/flowdock), [Chanty comparison](https://www.chanty.com/blog/flowdock-vs-slack/)]. The closest precedent for "replies in place, structure made visible".
- **Rocket.Chat:** both **threads** (in the room) and **discussions** (a separate room tied to a parent message, listed in the sidebar) [V: [Rocket.Chat API, create discussion](https://developer.rocket.chat/apidocs/create-discussion.md)]. Users asked why both exist [U: [forum thread title](https://forums.rocket.chat/t/doesnt-make-sense-to-have-both-thread-and-discussion/3711)] and for a way to turn a thread into a discussion [U: [request](https://forums.rocket.chat/t/feature-request-convert-a-thread-into-a-discussion/4755)].
- **Zoom Team Chat:** a setting "Move messages with new replies to the bottom of the chat", so an active chain rejoins the bottom of the stream; it's per person, so two people can see the same chat in different orders [U: [Technipages](https://www.technipages.com/zoom-show-all-message-threads-in-chronological-order/), Zoom community].
- **Discourse chat:** threads exist; staff can move chat messages to another channel (it leaves stub messages behind); "move to a forum topic" is still a request [U: [meta.discourse.org](https://meta.discourse.org/t/ability-to-move-chat-messages/288651)].
- **No 2025–26 product found** that removes the up-front choice in a new way. The newest moves are incremental: Teams added threads (2025), Zulip allowed no topics (2025), Google put threads in DMs (2025), WhatsApp is testing a thread view over replies (2025), Glue narrowed to threads (2026).

### 1.16 Side by side

| Product | Reply shows in the main stream? | Separate place to reply? | Fix it afterwards? |
| --- | --- | --- | --- |
| Slack | No (unless "also send") | Yes, side panel | Thread → channel only |
| Discord | Reply: yes · Thread: no | Threads, forums | No |
| Teams (posts / threads) | Posts: in place under the post · Threads: no | Threads layout: side pane | No |
| Google Chat | No ("X replies") | Yes, side panel; plus quote-reply | No |
| Zulip | Yes, inside its topic | Topics are the unit | **Yes: move one / later / all; resolve** |
| Mattermost | CRT off: yes · on: collapsed | Side panel | **Yes, with a plugin (move, copy, attach)** |
| Element | Reply: yes · Thread: no | Side panel | No |
| Telegram | Yes (quote) | Topics (big groups) | Next reply can go to another chat |
| WhatsApp | Yes (quote); thread view in beta | Beta reply screen | No |
| iMessage | **Yes, plus a chain view** | No | No |
| Twist | Thread is the unit | Threads are everything | Not checked |
| Basecamp Campfire | Yes (quote above) | No (Message Board / comments) | No |
| Linear | n/a (comments) | One level of replies | Resolve collapses, keeps a chosen reply |
| Flowdock (dead) | **Yes, colour-coded chains** | Thread view | Not checked |

---

## 2. What research and credible write-ups say

**Up front: no study measures the designer's problem directly.** No dated, published study was found that counts how often replies land in the wrong place, how many thread replies go unseen, or what share of teams actually use threads. (One blog's "10% vs 45% thread adoption" figure has no source and is not used here.) What exists: vendors' own design write-ups, a few lab and field studies of threaded vs flat chat, and a clear pattern in what the big vendors changed in 2022–2025.

### 2.1 People don't pick the right place, even when they designed the feature

- **Slack's own product team**, using its own threads: "it was unclear when to start a thread versus post a normal message"; they did both interchangeably, which produced a mix of linked and unlinked messages [V: [Weaving Threads, Jan 2017](https://slack.engineering/weaving-threads/)].
- **Google Chat users, nine years later:** in teams of 15+, "someone always forgets" to reply in the thread, so the conversation splits [U: Google community, 2022, search snippet]; in 2026 a Space owner reports misclicks between "Reply in thread" and "Quote in reply" and asks for a per-space switch to turn threads off; another user answers that it's a habit problem and everyone should just always thread [V: [Google developer forum, June 2026](https://discuss.google.dev/t/option-to-disable-reply-in-thread-inline-threading-in-google-chat/375042)].
- **Anecdote from a workplace forum:** "90% of their chats ignore the thread feature" and reply in one long stream; another commenter defends the stream because a group message is usually meant for the whole group, and only a subset should branch off [U: [Team Blind thread](https://www.teamblind.com/post/threading-in-slack-eesxvnmo), via search snippet].
- **The habit split is stable:** some people want every message in the stream, some want everything threaded. Slack noted people who "felt anxious about missing updates" once replies left the channel [V: Weaving Threads]. Mattermost users complain in both directions about the same toggle [V: forum links in §1.6].

**Reading:** "thread discipline" is not a training problem a product can teach away. Any design that depends on the sender choosing correctly, at the moment of sending, will get the mess the designer describes.

### 2.2 Replies hidden from the stream need their own route to people

- Slack: hiding replies fixed readability but meant "replies no longer marked the channel as unread"; the Activity panel was easy to miss yet distracting; All Threads was built to fix it [V: slack.design part 2].
- Matrix: the spec team held threads back from Matrix 1.3 because notifications for threads were unproven; read receipts had to become per-thread [V: §1.7].
- Google Chat: notifications go only to the original poster, people mentioned and earlier repliers, plus anyone who follows; that is how Google "reduces noise" [V: [Oct 2022 post](https://workspaceupdates.googleblog.com/2022/10/in-line-threading-in-Chat-spaces.html)].
- Discord: you aren't notified for threads you haven't joined [U].

**Reading:** this is the competitor lane's finding restated: "missed replies" is a routing problem [structure-competitors §2 D4]. Moduo has already decided the route: CH6 pings for "a reply in a thread you're in", and CH8 Catch up collects them. Whatever replaces threads must keep a clear answer to "whose reply is this addressed to?".

### 2.3 Threaded vs flat chat: the lab and field studies

- **Microsoft Research, 2000** (Smith, Cadiz, Burkhalter, CSCW): flat chat breaks the link between a reply and what it answers. Their threaded chat was "equally effective, but different (and possibly more efficient)" in group tasks [V: [MSR abstract](https://www.microsoft.com/en-us/research/?p=152467)]. A later paper summarizes the result as: threading improved coherence, but people reported a **better experience with the flat view** [U: summary in Aragón et al. 2017, below].
- **Aragón, Gómez, Kaltenbrunner, 2017** (ICWSM): a large Spanish news site, Menéame, switched its comments from flat to threaded. People replied **to each other** much more afterwards: "an abrupt and significant increase in social reciprocity" [V: [abstract, ICWSM 2017](https://ojs.aaai.org/index.php/ICWSM/article/view/14880)]. This is comments on news, not team chat, but it's one of the few natural experiments: linking replies to their parent changes how people talk.
- **Zhang and Cranshaw, 2018** (CSCW, MIT + Microsoft Research): group chat is "lots of little short messages" where you "can't tell the important from unimportant ones", so catching up after time away is hard. Interviews (15 people) found structure, such as marking what kind of message something is, helps people make sense of chat; a field deployment showed teams used light markup both while chatting and to catch up [V: [Tilda project page](https://homes.cs.washington.edu/~axz/tilda.html)].
- **Developer chat research:** researchers who study Slack and IRC build algorithms to untangle interleaved conversations: Kummerfeld et al. hand-annotated 77,563 Ubuntu IRC messages with reply links [V: [ACL 2019 / arXiv](https://arxiv.org/abs/1810.11118)]; Chatterjee et al. released 38,955 conversations disentangled from three open Slack communities [V: [MSR 2020 dataset](https://zenodo.org/record/3627124)]. That research describes flat chat as entangled and Slack's threads as only one layer of branching [U: via search summary]. Read: even in technical communities that know threads exist, much of the talk stays interleaved in the stream.
- **Online learning, 2025:** a study comparing threaded forums and flat chat found flat chat got more back-and-forth, but also "tangles" (broken chains of related posts) [U: Smith & Sherry, BJET 2025, via search summary].

**Reading:** structure helps understanding and makes people answer each other; flat feels better to use. The best design keeps the **feel** of flat chat and the **links** of threading.

### 2.4 What the big vendors changed, 2022–2025

| Year | Who | From → to | What it suggests |
| --- | --- | --- | --- |
| 2022–24 | Google Chat | Topics with replies grouped in place → a stream with side-panel threads; every old space upgraded | In-place grouping lost; one model for all spaces |
| 2025 | Google Chat | Threads added to DMs and group DMs, on by default | Threads are now expected everywhere, even in 1:1 |
| 2025 | Microsoft Teams | Posts (replies in place under each post) → optional chat-like stream with side threads | The structured, in-place model lost to "chat + optional threads" |
| 2025 | Zulip | Topics mandatory → channels can have no topics | Mandatory structure is too heavy for some rooms |
| 2021–22 | Mattermost | Replies in the stream → collapsed threads, chosen **per person** | Different people want different views of the same talk |
| 2025 | WhatsApp (beta) | Quote-replies only → a thread view over quote-replies | The phone-native pattern grows a chain view, without a separate place to reply |
| 2026 | Glue | Mixed product → threads only | One startup still betting on thread-first |

**Reading:** the market converged on "a stream, plus optional side threads, plus a place where your replies land". That convergence fixed readability and notification noise. It did **not** fix the up-front choice; the 2026 Google forum thread is the same complaint as Slack's 2017 write-up. The only mechanisms that address the choice itself are (1) replies that stay in the stream and are linked (iMessage, WhatsApp, Telegram, Discord replies, Basecamp), and (2) moving messages after the fact (Zulip, Mattermost's plugin).

### 2.5 What this means for Moduo (still research, not a decision)

1. **Don't ask the sender to choose.** Every mechanism that relies on choosing well at send time fails in practice, at every vendor, for nine years.
2. **Keep the link, not the place.** A reply should always know what it answers (the Menéame and Microsoft studies), but it doesn't have to live somewhere else.
3. **Structure can be a view.** Mattermost (per person), Telegram ("view as messages") and iMessage (chain view) show the same messages two ways.
4. **Tidying afterwards is normal.** Zulip makes it everyone's job; Mattermost users needed a plugin for it; Slack, Teams, Google and Discord users ask for it.
5. **Routing is solved separately.** Catch up (CH8) and CH6's rule already answer "did the right person see my reply?".
6. **Moduo's boundary removes the hardest case.** Long, structured discussion about one piece of work belongs on the item (comments) or in a note, as Basecamp does. Chat only has to handle conversation, which is the case where flat chat with linked replies works best.

---

## 3. Options for Moduo

**What every option must fit** (already decided, not re-opened):
- **The 3×3 layout:** a long side conversation opens in the **right panel as an item with a back arrow** (Tasks 72a, as CH12 intended). Never a fourth column, never a separate "Threads" section in the sidebar.
- **CH6 and CH8:** "a reply in a thread you're in" pings you and lands in Catch up. Each option has to say what "the thread you're in" becomes.
- **No AI:** anything that "appears on its own" must follow a rule you can state in one sentence.
- **The boundary:** a discussion about one item lives in its comments; chat holds conversations. CH24's help desk (claimable questions, the busiest case for threads) is parked, so chat itself has to handle busy channels for now.

**The two problems, named:**
- **"Half in, half out":** part of a discussion is in a thread, part is in the channel under it.
- **"I didn't know it would become a thread":** the sender has to choose before anyone knows whether the topic will grow.

### A · Keep Slack's threads (CH12 as proposed)

- **Mechanic:** Reply in thread opens the right panel; the channel shows "3 replies · last 11:02"; "Also send to Acme" under the box; Catch up collects replies in your threads.
- **Half in / out:** not solved. It's the source of the problem (§2.1).
- **Didn't know:** not solved. The sender chooses up front.
- **Cost:** lowest. v1 has it.
- **Catch up / quiet:** works (that's what CH8 was designed around).
- **Newcomer in 10 s:** fine for Slack users; others learn "which button?".
- **48a:** familiar to Slack users; nobody else asked for it.
- **Verdict:** the designer has already said no.

### B · No threads: quote-replies in the stream only

- **Mechanic:** hover → **Reply**. Your message posts at the bottom, with a one-line quote of what it answers; clicking the quote jumps to the original. That's all (Basecamp, WhatsApp, Telegram, Discord replies).
- **Half in / out:** solved; there's only "in".
- **Didn't know:** solved; nothing to choose.
- **Cost:** low. Remove the thread panel; add the quote line.
- **Catch up / quiet:** a reply to *your* message is addressed to you (ping + Catch up); other replies just make the conversation bold. You lose "follow a discussion you only watched".
- **Newcomer in 10 s:** everyone already knows it from their phone.
- **48a:** universal.
- **Weakness:** in a busy channel, two or three conversations weave into each other with nothing to untangle them (Slack's one-level, replies-in-the-channel test, §1.1). Fine for a duo; weak for an agency's client channel or a 5-person team on a launch day.

### C · Replies shown in place, under the message they answer

- **Mechanic:** a reply is inserted **directly under its parent** in the stream, indented, and collapses to "Show 6 more replies" when long (old Google Chat topics, Teams posts).
- **Half in / out:** mostly solved; replies sit with what they answer.
- **Didn't know:** solved; you just reply.
- **Cost:** medium, and a known failure. A late reply lands far up the stream where nobody looks, so it needs an extra "new replies above" signal. Slack built this and turned it off because the stream jumped around ("so disruptive"). Google removed its in-place topics in 2023–24 and Microsoft added chat-style threads next to posts in 2025 (§1.3, §1.4).
- **Note on Google Chat:** its "in-line threading" is **not** this; it's Slack's side panel under another name (§1.4). The only shipped "in place" designs are the ones being retired.
- **Catch up / quiet:** workable; same rule as B.
- **Newcomer in 10 s:** easy to read, odd to write (where did my reply go?).
- **48a:** reads like a forum; people outside teams wouldn't miss it.

### D · People just reply; the app groups a reply chain once it gets tangled

- **Mechanic:** B's quote-reply, plus the app keeps **chains**: a chain is a message plus every reply to it, or to a reply in it. The root gets a chip ("4 replies ›") that opens the whole chain in the right panel. When a chain gets long **and** other talk is mixed in with it, the stream shows the chain as **one row** instead of every reply (rule and pictures in §4).
- **Half in / out:** solved for anything sent with Reply: every reply belongs to its chain however it's displayed. Messages typed *without* Reply can still land outside; E fixes those.
- **Didn't know:** solved. Nobody decides; the structure appears when the rule says so, and the rule is predictable.
- **Cost:** medium. A reply pointer on each message (v1's thread parent can carry it), the fold rule, the chain row, a per-person display setting.
- **Catch up / quiet:** maps cleanly. "A thread you're in" becomes "a chain you're in" (you wrote the root, replied, or were mentioned). Every reply is a real message in the conversation, so bold and unread keep working: no Slack unread hole.
- **Newcomer in 10 s:** "Press Reply." The chain row explains itself (iMessage and the WhatsApp beta do the same).
- **48a:** good everywhere: quiet rooms read as chat; busy rooms (agencies, hackathon organizers, clubs) get untangled.

### E · Anyone can tidy up afterwards

- **Mechanic:** from a message's ⋯, or after selecting several: **Reply to…** (attach a stray message to a chain), **Move to a conversation** (another channel or a DM), **Move to a task's comments**, **Make a note**, and CH10's **Make a task**. A short trace stays where the messages were: "3 messages moved to Founders by Maciej · Undo". (Zulip's moves; Mattermost's Wrangler "attach to thread".)
- **Half in / out:** fixed after the fact, by whoever notices.
- **Didn't know:** fixed after the fact: a chat that turned out to be about one task moves onto the task.
- **Cost:** medium to high. Who may move whose messages; what moving between a public and a private conversation shows to whom; keeping authors and times; undo. **Moving into a task's comments or a note touches Tasks and Notes: a proposal for those plans, not Chat's call.**
- **Catch up / quiet:** moving pings nobody. People in the destination see the moved messages as already read.
- **Newcomer in 10 s:** invisible until needed; then it's a menu item.
- **48a:** anyone who keeps things tidy (PMs, organizers, teachers) would use it; it's the one thing Slack users keep asking for.
- **Alone it isn't enough:** it cleans up the mess but doesn't prevent it. Best paired with B or D.

### F · Topics in every channel (Zulip)

- **Mechanic:** every message is sent to a named topic; a channel is a list of topics.
- **Half in / out:** solved (no "out").
- **Didn't know:** not solved. You name a topic before you speak; worse, not better.
- **Cost:** high, and a big habit change; it overlaps with linked channels (CH2) and with item comments (a topic named "Logo SVGs" competes with the task "Get logo SVGs").
- **Catch up / quiet:** good (follow or mute per topic).
- **Newcomer in 10 s:** no. Zulip itself added topic-less channels in 2025.
- **48a:** loved by open-source and distributed teams; niche elsewhere.
- **Take from it:** the move tools (E), not the topic rule.

### G · Add-on: wrap up a chain (Linear's resolve)

- **Mechanic:** a chain's ⋯ → **Wrap up**, choosing one reply as the outcome. The chain folds for good, showing only the outcome: "Wrapped up: Alex 'Final SVGs are in Drive' ›". If the outcome is marked as a decision (CH13), it's listed in Details and on the linked project. Anyone can reopen it.
- **Helps with:** the end of a side conversation: the answer stays visible without the 12 messages that led to it.
- **Cost:** low on top of D.
- **Catch up:** wrapping up clears that chain from everyone's Catch up.
- **48a:** anyone who asks questions in chat.

### Comparison

| | A Slack threads | B Quote-replies | C In place | D Group when tangled | E Tidy afterwards | F Topics |
| --- | --- | --- | --- | --- | --- | --- |
| Half in, half out | No | Yes | Mostly | Yes (with E for stray messages) | Fixes it later | Yes |
| "Didn't know it would grow" | No | Yes | Yes | **Yes** | Fixes it later | No (worse) |
| Busy channel stays readable | Yes | **No** | Partly | Yes | Partly | Yes |
| Fits Catch up (CH8) and CH6 | Yes | Yes (loses "following") | Yes | **Yes** | Neutral | Yes |
| Newcomer in 10 seconds | Slack users only | Everyone | Read yes, write unclear | Everyone | n/a | No |
| Precedent | Slack, Google, Teams | WhatsApp, iMessage, Basecamp, Discord replies | Old Google topics, Teams posts (both retired) | iMessage chain view, WhatsApp beta, Mattermost CRT, Zoom bump | Zulip, Mattermost plugin | Zulip |
| Build cost | Lowest (v1) | Low | Medium | Medium | Medium–high | High |

---

## 4. Recommendation (a recommendation, not a decision)

**"Replies, not threads": B as the base, D on top, E and G as the tidy tools.** Nobody ever chooses "thread or channel". Every answer is a Reply, visible to everyone when it's sent. The app keeps each reply chain together, folds it when it gets tangled with other talk, opens it in the right panel, and lets anyone tidy afterwards.

### 4.1 One reply in the stream

```
  Sofia   10:41
  Can someone get the logo SVGs from Anna? Need them for Friday.

  Mike    10:43
  Homepage copy draft is up: [▢ Draft homepage copy]

  Alex    10:47
  ╭ Sofia: Can someone get the logo SVGs from Anna?…
  I'll ask her today.
```

- Hover a message → **Reply** (or `R` on a selected message). The composer shows a bar: "Replying to Sofia · Can someone get the logo SVGs… ×". Esc or × cancels.
- The reply posts **at the bottom**, in time order, with **one muted line** quoting what it answers (author + first line, ellipsis). Clicking it scrolls to the original and highlights it.
- **No "Reply in thread", no "Also send to Acme".** Everyone in the conversation sees the reply when it's sent.
- **Reply privately** (⋯): starts or opens a DM with that person, with the quote as a chip that links back (Telegram's "reply in another chat"). The original conversation shows nothing.

### 4.2 A short chain (1–2 replies)

- The root gets a small chip under it: **"2 replies · Alex, Mike ›"**. Each reply stays in the stream as in 4.1.
- Clicking the chip opens the **chain in the right panel** as an item with a back arrow: the root, then every reply in order, and a composer that replies into the chain.
- A channel where one thing is being discussed reads exactly like normal chat.

### 4.3 A long, tangled chain folds into one row

**The rule (one sentence, deterministic):** *a chain folds once it has three or more replies and at least one message that isn't part of it has been posted between its first and latest reply.*

```
  Sofia   10:41
  Can someone get the logo SVGs from Anna? Need them for Friday.
  6 replies · Alex, Anna, Mike ›

  Mike    10:52
  Standup moved to 11:30.

  Priya   11:00
  Pushed the new nav, have a look.

  ↳ Sofia's "Can someone get the logo SVGs…" · 6 replies
    Anna: Sent them to the shared drive, final versions · 11:02 ›
```

- In the stream, the folded chain's replies are replaced by **one chain row**, placed where its **latest** reply is. The row shows the root's first words, the reply count, and the latest reply (author, first line, time).
- A new reply **moves the row to the bottom** (there is only ever one row per chain), so an active side conversation is never buried up the page (Zoom's and Zulip's lesson; fixes Slack's "replies don't show anywhere").
- The root keeps its chip ("6 replies · Alex, Anna, Mike ›") where it was.
- Clicking either opens the chain in the right panel.
- **Stable while you read:** nothing folds or moves above the place you're reading. A fold appears the next time you open the conversation, or below the "New" line. (A rendering rule, not a product call.)
- **A chain that isn't tangled never folds**, however long. Two people going back and forth in a quiet channel just read as chat.
- **Display option (per person, like Mattermost):** "Reply chains: **Fold when tangled** (default) · **Always show every reply**". Same messages, two views.
- **In the right panel:** the chain flat, in time order. A reply that answers a reply (not the root) keeps its quote line, so nothing nests deeper than one level on screen.

### 4.4 Tidy up afterwards

From a message's ⋯, or with several messages selected (shift-click):

| Action | What happens | Trace left behind |
| --- | --- | --- |
| **Reply to…** | Pick the message it answers; it joins that chain | None in the stream; the chain shows "Added by Maciej" |
| **Move to a conversation** | Moves to another channel or a DM, keeping authors and times | "3 messages moved to Founders by Maciej · Undo" (the name is hidden from people who can't see Founders) |
| **Move to a task's comments** *(proposal for Tasks)* | They become comments on the task, authors and times kept | "Moved to [○ Get logo SVGs]", live chip |
| **Make a note** *(proposal for Notes)* | A note with the messages quoted and linked back | "Became a note: [▢ Logo handover]" |
| **Make a task** (CH10) | As decided | As decided |
| **Wrap up** (on a chain) | Folds for good, showing one chosen reply as the outcome | "Wrapped up: Anna 'Sent them…' ›" |

- **Who may tidy:** anyone in the conversation may attach their **own** messages; moving other people's messages is open to the channel's owner and the workspace's admins (a PERM switch, like "Mention everyone"), always with Undo and a visible name. At 2–5 people, "anyone, visibly" may be enough; a round-2 call.
- **No pings** from any tidy action.

### 4.5 What reaches you (CH6, CH8 unchanged in spirit)

- **"A reply in a thread you're in" becomes "a reply in a chain you're in".** You're in a chain if you wrote its root, replied in it, or were mentioned in it. **A reply to your own message is always addressed to you.** "Stop following" stays on the chain's ⋯.
- **Catch up** groups by conversation (CH8), and within one, by chain: "Acme · Sofia's 'Can someone get the logo SVGs…' · 3 new replies". Done clears the chain; Wrap up clears it for everyone.
- **Unread:** every reply is an ordinary message, so the conversation turns bold as usual; a folded chain counts as one unread item (its row). This avoids Slack's and Matrix's separate thread read state (§1.1, §1.7).
- **Folding never changes who is notified.** Nobody has to "join" anything.

### 4.6 What the right panel shows

- The chain as an item (back arrow; Esc steps back): the root message, its conversation's name and a link back to the spot, the replies in order, who's in it ("Sofia, Alex, Anna · you're following · Stop"), and a composer.
- Its ⋯: **Wrap up**, **Make a task**, **Move to…**, **Mark as decision** on any reply (CH13).
- If the chain was moved into a task or note, the panel shows that item instead, with "Moved from Acme · Oct 13".

### 4.7 Why this combination

- **Half in, half out:** gone for anything sent with Reply; "Reply to…" fixes anything sent without it.
- **"I didn't know it would grow":** gone; growth is the app's job, by a rule anyone can predict.
- **Readable busy channels:** folding when tangled (D).
- **No second place to post, no checkbox, no "which reply button?"** (removes Slack's "also send" and Teams' and Google's two-button confusion).
- **Fits what's decided:** the 3×3 layout (the chain is a right-panel item), CH6/CH8 (chains replace threads one for one), CH10 and CH13 (task, decision from any reply), the boundary (move to the item's comments when the talk turns out to be about one item).
- **Precedents for each piece:** quote-replies (WhatsApp, iMessage, Basecamp, Discord), chain view over the stream (iMessage, WhatsApp beta), per-person folding (Mattermost), active chain to the bottom (Zoom, Zulip), move and attach (Zulip, Mattermost Wrangler), resolve with the outcome kept (Linear).
- **The new part is the fold rule.** No product found folds a chain *only when it's tangled*. That's the piece to test in a prototype, with a 2–3 person channel and a busy 5-person launch-day channel (the research workspace "Chat replan research" has 3,032 messages to try it on).

### 4.8 Risks and open questions for CH30

1. **Messages typed without Reply** stay outside their chain. Variant to prototype: after you reply in a chain, the composer **stays in "Replying to…"** for your next message until Esc, or until someone else posts outside the chain. Risk: the opposite mistake. Recommend testing both.
2. **The fold threshold** (three replies, any interleaving) is a guess. Try 2/3/5 on real data.
3. **Slack migrants** will look for "Reply in thread". The Reply action can carry a tooltip "Replies stay in the conversation; long ones fold on their own."
4. **Moving between conversations with different members** (public → private, channel → DM): needs a clear privacy rule; round 2.
5. **Move to task comments / Make a note** are proposals for the Tasks and Notes plans (Tasks' comments are flat with six reactions; moved chat messages would arrive as flat comments).
6. **Mobile later:** quote-replies and chain views are phone-native (WhatsApp, iMessage), so the model carries over.
7. **Does a folded chain ever unfold?** A chain that got tangled once and then *became* the whole conversation (five people, 40 replies, nothing else posted) would stay one bumping row while everyone reads in the right panel: Slack's hidden conversation again, by a side door. Candidate rule: a chain unfolds when its replies are the only messages among the last N in the conversation. The second thing to test on real data, after the threshold.
8. **Hackathon MVP vs later:** the cheap, low-risk part is B plus the chain chip and the right-panel chain view (a reply pointer v1 can already carry). The fold rule (D), the moves (E) and Wrap up (G) can follow in the teams-of-2–5 cut once the fold is tested.

---

## 5. Products worth reviewing further

- **Zulip** (hands-on): the move dialog (one / later / all), resolve-as-move, the notices left behind, the permissions; the best reference for E.
- **Mattermost** with Collapsed Reply Threads on and off, and the Wrangler plugin: per-person folding and "attach to thread".
- **iMessage** in a busy family or friends group: how inline replies read when chains interleave; the chain view.
- **WhatsApp's threaded replies** once out of beta: the most widely used version of "a thread view over replies".
- **Glue** (glue.ai): the one current product betting everything on threads, with "close a thread".
- **Linear's comment resolve:** the model for Wrap up.
- Not worth more time: Twist (maintenance mode), Quill and Threads.com (gone), Flowdock (gone; its colour-coded chains are the one idea worth remembering).

## 6. Gaps

- No study quantifies wrong-place replies, missed thread replies or thread adoption; everything in §2.1 is vendor write-ups and user reports.
- Discord, Teams' reply-button wording, WhatsApp's beta, iMessage's display and Element's thread launch rest on secondary sources.
- Smith et al. 2000 and Aragón et al. 2017: only abstracts were read (PDF text couldn't be extracted); effect sizes not checked.
- Slack has no "move into a thread" in its help; absence, not a statement.
- Whether Google met its Q1 2024 deadline for upgrading every topic space: not confirmed.
