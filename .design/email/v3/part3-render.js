
/* ── render ───────────────────────────────────────────────────────────────────────────── */
const app = document.getElementById("app");
const sel = () => (V.sel ? T(V.sel) : null);
const accDot = (acc) => `<span class="dot" data-label="${ACCOUNTS[acc].hue}" aria-hidden="true"></span>`;
const avatar = (p, size) => p.me ? `<span class="av me${size ? " " + size : ""}" aria-hidden="true">RH</span>` : `<span class="av${size ? " " + size : ""}" data-label="${p.hue}" aria-hidden="true">${esc(initials(p.name))}</span>`;
const ib = (icon, label, act, extra = "", up = false) => `<button class="ib tip${up ? " up" : ""}" type="button" aria-label="${esc(label)}" data-tip="${esc(label)}" data-act="${act}" ${extra}${up ? ' tabindex="-1"' : ""}>${I(icon)}</button>`;
const accLabel = (acc) => ACCOUNTS[acc].address;

function render() {
  const t = sel();
  const narrow = window.innerWidth < 1200; const hasRight = !!V.panel && !V.firstRun && !V.webMode && !SPECIAL.includes(V.place) && !(narrow && V.panel === "today");
  app.innerHTML = topbar() + `<div class="panels${V.overlay ? " behind" : ""}${hasRight ? " has-right" : ""}${narrow ? " narrow" : ""}${V.dense ? " dense" : ""}${V.leftOpen ? "" : " no-left"}">${V.leftOpen ? rail() : ""}${centrePanel()}${hasRight ? rightPanel(t) : ""}</div>` + bottombar() + overlay() + toastHTML();
  fitTabs();
  if (["snooze", "move", "link", "more", "wait"].includes(V.overlay)) { const trig = app.querySelector(`.rd-bar [data-act="${V.overlay === "wait" ? "more" : V.overlay}"]`); if (trig) trig.classList.add("is-open"); }
  const tst = document.getElementById("toast"), rd = app.querySelector(".reader"); if (tst && rd) { const r = rel(rd); tst.style.left = `${r.x + r.w / 2}px`; }
  place();
  focusAfterRender();
}

function topbar() {
  const unread = unreadIn(() => true);
  const tabs = [["home", "Home"], ["notes", "Notes"], ["tasks", "Tasks"], ["calendar", "Calendar"], ["mail", "Email"], ["contacts", "Contacts"], ["chat", "Chat"]];
  return `<header class="topbar">
    <div class="ws">${I("logo", "lg")}<button class="ws-pill" type="button"><span class="ws-mark" aria-hidden="true" data-l="H"></span><span class="ws-name">Hale &amp; Co</span><span class="sr">, switch workspace</span>${I("chevD", "xs")}</button></div>
    <nav class="tabs" aria-label="Workspace navigation">${tabs.map(([k, l], i) => `<a class="mtab tip" href="#${k}" data-mod="${k}" data-tip="${l} ⌘${i + 1}" ${k === "mail" ? 'aria-current="page"' : ""} ${["tasks", "calendar", "notes"].includes(k) ? `data-drop="${k}"` : ""}>${I(k)}<span>${l}</span>${k === "mail" && unread ? `<span class="ud" aria-hidden="true"></span><span class="sr">, ${unread} unread</span>` : ""}</a>`).join("")}</nav>
    <div class="tb-right">${ib("help", "Help and shortcuts ?", "keys")}<button class="ib tip" type="button" data-tip="Notifications ⌘/" data-act="noop">${I("bell")}<span class="badge">1</span><span class="sr"> new notification</span></button><button class="av" type="button" data-label="blue">RH<span class="sr">, Robin Hale, account</span></button></div>
  </header>`;
}

function rail() {
  const z = V.firstRun;
  const cnt = {
    inbox: z || V.loading ? 0 : DB.threads.filter((t) => inPlace(t, "inbox") && !t.read).length,
    drafts: z || V.loading ? 0 : DB.threads.filter((t) => t.place === "drafts").length,
    outbox: V.outbox,
    followups: z || V.loading ? 0 : DB.threads.filter((t) => t.state === "waiting").length,
    due: z || V.loading ? 0 : dueFollowups().length,
    newsenders: z ? 0 : DB.threads.filter((t) => inPlace(t, "newsenders")).length,
  };
  const navRow = (p) => {
    if (p.id === "outbox" && !V.outbox) return "";
    if (p.id === "newsenders" && !V.screener) return "";
    const n = cnt[p.id]; const cur = V.place === p.id;
    const sr = p.id === "inbox" ? " unread" : p.id === "followups" ? " due" : p.id === "outbox" ? " waiting to send" : "";
    return `<button class="nav-row" type="button" aria-current="${cur}" tabindex="${cur ? 0 : -1}" data-act="place" data-place="${p.id}">${I(p.icon, "glyph")}<span class="trunc">${p.label}</span>${n ? `<span class="sr">, </span>${p.id === "followups" && cnt.due ? `<span class="due-dot" title="${cnt.due} due"></span>` : ""}<span class="n">${n}<span class="sr">${p.id === "followups" ? ` waiting, ${cnt.due} due` : sr}</span></span>` : ""}</button>`;
  };
  const accts = z ? `<p class="rp-quiet" style="padding:0 .5rem">None yet.</p>` : Object.values(ACCOUNTS).filter((a) => !V.loading || a.id === V.backfill).map((a) => {
    const st = V.accounts[a.id] || (V.failed && a.id === "studio" ? "error" : "ok"); const n = V.loading ? 0 : unreadIn((t) => t.acc === a.id); const open = V.folders === a.id; const cur = V.scope === a.id;
    const fold = open ? `<div class="folders" role="group" aria-label="Folders in ${esc(a.label)}">${FOLDER_TREE[a.id].map((f) => `<button class="nav-row" type="button" data-act="folder" data-name="${esc(f)}">${I("folder", "xs glyph")}<span class="trunc">${esc(f.replace(/^\[Gmail\]\s*/, ""))}</span></button>`).join("")}<button class="nav-row quiet" type="button" data-act="morehistory" data-acc="${a.id}">${I("download", "xs glyph")}<span class="trunc">Load more history</span></button></div>` : "";
    const bf = V.backfill === a.id ? `<div class="backfill" role="status"><div class="bf-top"><span>Syncing history · 40%</span><button class="btn xs ghost" type="button" data-act="cancelbf">Cancel</button></div><div class="bar" aria-hidden="true"><span style="width:40%"></span></div></div>` : "";
    const stBtn = `<button class="ib acct-st${st !== "ok" ? " warn" : ""}" type="button" tabindex="-1" aria-label="${esc(a.label)} status: ${st === "reauth" ? "needs you to sign in again" : st === "error" ? "can't sync" : V.net === "offline" ? "offline" : "up to date"}" data-act="acctpop" data-acc="${a.id}">${I(st !== "ok" ? "alert" : "more", "xs")}</button>`;
    return `<div class="acct" aria-current="${cur}"><button class="ib twist" type="button" tabindex="-1" aria-label="${open ? "Hide" : "Show"} folders for ${esc(a.label)}" aria-expanded="${open}" data-act="folders" data-acc="${a.id}">${I(open ? "chevD" : "chevR", "xs")}</button><button class="main" type="button" tabindex="-1" data-act="scope" data-acc="${a.id}" data-acc-row="${a.id}">${accDot(a.id)}<span class="trunc">${esc(a.label)}</span>${n && st === "ok" ? `<span class="n"><span class="sr">, </span>${n}<span class="sr"> unread</span></span>` : ""}</button>${stBtn}</div>${bf}${fold}`;
  }).join("");
  const saved = SAVED.map(([name, q]) => `<button class="nav-row" type="button" tabindex="-1" data-act="savedsearch" data-q="${esc(q)}">${I("search", "glyph")}<span class="trunc">${esc(name)}</span></button>`).join("");
  return `<aside class="panel side rail" aria-label="Mail folders and accounts">
    <div class="rail-top"><h1>Mail</h1><span class="sp" style="flex:1"></span>${z ? "" : ib("refresh", V.net === "offline" ? "Sync now: offline" : "Sync now · synced 2 min ago", "sync", V.net === "offline" ? "disabled" : "")}${ib("settings", "Mail settings ⌘,", "noop")}</div>
    ${z ? "" : `<div class="rail-actions"><span class="kb-wrap"><button class="btn sm primary" type="button" data-act="new" aria-keyshortcuts="c">${I("pen", "xs")}New message</button><span class="kbd on-primary" aria-hidden="true">c</span></span></div>`}
    <nav aria-label="Folders" class="rail-grp">${FOLDERS.map(navRow).join("")}</nav>
    <nav aria-label="Views" class="rail-grp">${RAILVIEWS.map(navRow).join("")}</nav>
    <div class="rail-sec"><span class="eyebrow">Accounts</span></div><div role="group" aria-label="Accounts">${accts}</div>
    ${z || V.loading ? "" : `<div class="rail-sec"><span class="eyebrow">Saved searches</span></div><div role="group" aria-label="Saved searches">${saved}</div>`}
    <div class="rail-foot"><button class="btn sm ghost" type="button" data-act="connect" style="width:100%;justify-content:flex-start">${I("plus")}Connect account</button></div>
  </aside>`;
}

function centrePanel() {
  if (V.webMode) return `<div class="panel">${webView()}</div>`;
  if (V.firstRun) return `<div class="panel">${firstRun()}</div>`;
  if (SPECIAL.includes(V.place)) return `<div class="panel">${V.place === "subscriptions" ? subscriptionsView() : attachmentsView()}</div>`;
  const t = sel(); const full = V.compose && V.compose.mode === "new";
  return `<div class="panel"><div class="centre">${listPane()}${full ? newMessage() : reader(t)}</div></div>`;
}

function tabsBar() {
  const tabs = TABS.map((k) => { const n = V.loading ? 0 : DB.threads.filter((t) => inPlace(t, "inbox") && t.kind === k && !t.read && (!V.scope || t.acc === V.scope)).length; return `<button class="stab" type="button" role="tab" aria-selected="${V.tab === k}" data-act="tab" data-tab="${k}">${KINDS[k]}${n ? `<span class="sr">, </span><span class="n">${n}<span class="sr"> unread</span></span><span class="nd" aria-hidden="true"></span>` : ""}</button>`; }).join("");
  return `<div class="tabsbar"><div role="tablist" aria-label="Inbox tabs" style="display:flex;gap:.125rem;min-width:0">${tabs}</div><button class="stab-more" type="button" hidden data-act="tabsmore" aria-haspopup="menu">+<span class="k">0</span><span class="sr"> more tabs: <span class="more-names"></span></span><span class="nd" aria-hidden="true"></span></button><span class="sp"></span>${ib("more", "Tab actions: get me to zero", "tabmenu")}</div>`;
}
/* tabs that don't fit fold into "+N" (up to 3 custom tabs make 6); the selected tab always stays */
function fitTabs() {
  const tl = app.querySelector(".tabsbar [role=tablist]"); const more = app.querySelector(".stab-more"); if (!tl || !more) return;
  const tabs = [...tl.children]; for (const b of tabs) b.hidden = false; more.hidden = true;
  if (tl.scrollWidth <= tl.clientWidth + 1) return;
  more.hidden = false; const hid = [];
  for (let i = tabs.length - 1; i > 0 && tl.scrollWidth > tl.clientWidth + 1; i--) { if (tabs[i].getAttribute("aria-selected") === "true") continue; tabs[i].hidden = true; hid.unshift(tabs[i]); }
  more.querySelector(".k").textContent = hid.length;
  more.classList.toggle("has-n", hid.some((b) => b.querySelector(".n")));
  more.querySelector(".more-names").textContent = hid.map((b) => b.textContent.trim()).join("; ");
}
function listHead(label) {
  return `<div class="list-head">${V.place === "inbox" && !V.firstRun ? tabsBar() : `<div class="tabsbar"><h2 class="place-h">${esc(label)}</h2><span class="sp"></span></div>`}</div>`;
}
function statusLines() {
  const out = [];
  if (V.net === "offline") out.push(`<div class="line" role="status">${I("offline", "xs glyph")}<div class="tx"><b>Offline, changes will sync</b><small>${V.outbox ? `${V.outbox} message waits in Outbox. ` : ""}${DB.pending ? `${DB.pending} triage actions are saved on this Mac.` : "Reading works from what's on this Mac."}</small></div></div>`);
  for (const [acc, st] of Object.entries(V.accounts)) {
    if (st === "reauth") out.push(`<div class="line warn" role="status">${I("alert", "xs glyph")}<div class="tx"><b>${esc(ACCOUNTS[acc].label)} needs you to sign in again</b><small>Its new mail is paused until you sign in; other accounts keep syncing.</small></div><div class="acts"><button class="btn xs primary" type="button" data-act="reconnect" data-acc="${acc}">Reconnect</button></div></div>`);
    if (st === "error") out.push(`<div class="line warn" role="status">${I("alert", "xs glyph")}<div class="tx"><b>${esc(ACCOUNTS[acc].label)} couldn't sync</b><small>Refused at 10:31; retrying every minute.</small></div><div class="acts"><button class="btn xs secondary" type="button" data-act="retry" data-acc="${acc}">Retry now</button></div></div>`);
  }
  if (V.away) out.push(`<div class="line" role="status">${I("clock", "xs glyph")}<div class="tx"><b>${V.away} emails came back while you were away</b><small>Snoozes return only while Moduo runs, so these came due over the weekend. They're first in Personal, under Came back.</small></div><div class="acts"><button class="btn xs ghost" type="button" data-act="awayOk">${I("x", "xs")}Dismiss</button></div></div>`);
  if (V.failed) out.push(`<div class="line warn" role="alert">${I("alert", "xs glyph")}<div class="tx"><b>${V.failed} actions didn't reach Lumen</b><small>Done · Workshop materials, and Move to Receipts · Studio rent, November. Its server is read-only; Moduo keeps retrying for a day.</small></div><div class="acts"><button class="btn xs ghost tip" type="button" data-act="discardfailed" data-tip="Shows both threads as the server has them">Undo both</button><button class="btn xs primary" type="button" data-act="retryfailed">Retry now</button></div></div>`);
  if (V.place === "inbox" && V.tab === "people" && !V.loading && !out.length) for (const t of dueFollowups()) { const p = who(t); const days = Math.round((NOW - new Date(t.when)) / DAY); out.push(`<div class="line nudge">${I("reply", "xs glyph")}<button class="tx linkish" type="button" data-act="open" data-id="${t.id}"><b>No reply from ${esc(p.name.split(" ")[0])} · ${days} days</b><span class="sr">, </span><small class="trunc">${esc(t.subject)}</small></button><div class="acts"><button class="btn xs ghost tip" type="button" data-act="dismissnudge" data-id="${t.id}" data-tip="Stops waiting for ${esc(p.name.split(" ")[0])}">${I("x", "xs")}Dismiss</button></div></div>`); }
  return out.length ? `<div class="lines-top">${out.join("")}</div>` : "";
}
function selLine() {
  const n = V.checked.length; if (!n) return "";
  return `<div class="bulkbar" role="toolbar" aria-label="${n} selected"><b>${n} selected</b><span class="sp"></span>${ib("check", "Done · e", "done")}${ib("clock", "Snooze · s", "snooze")}${ib("task", "Make tasks · t", "task")}${ib("move", "Move · m", "move")}${ib("trash", "Delete · #", "delete")}<span class="sep" aria-hidden="true"></span>${ib("x", "Clear · Esc", "clearsel")}</div>`;
}
function skeleton() { return Array.from({ length: 7 }, (_, i) => `<div class="sk-row" aria-hidden="true"><span class="sk av-sk"></span><div><div class="sk" style="width:${34 + (i * 13) % 30}%"></div><div class="sk" style="width:${60 + (i * 7) % 25}%"></div><div class="sk" style="width:${80 + (i * 5) % 15}%"></div></div></div>`).join(""); }
function emptyFor() {
  if (V.place === "inbox") {
    const others = TABS.filter((k) => k !== V.tab).map((k) => [k, DB.threads.filter((t) => inPlace(t, "inbox") && t.kind === k && !t.read).length]).filter(([, n]) => n);
    return `<div class="empty">${I("check", "lg glyph")}<h3>${KINDS[V.tab]} is clear</h3><p>${V.cleared ? `You cleared ${V.cleared} today.` : "Nothing waiting on you here."}</p>${others.length ? `<div class="acts">${others.map(([k, n]) => `<button class="btn sm ghost" type="button" data-act="tab" data-tab="${k}">${KINDS[k]} · ${n} unread</button>`).join("")}</div>` : ""}</div>`;
  }
  const by = { followups: ["wait", "No follow-ups", "Set “Remind me if no reply” when you send, or press w on a sent thread."], snoozed: ["clock", "Nothing snoozed", "s hides a thread until you want it back."], archive: ["archive", "Nothing in Archive", "e marks a thread done and files it here. A reply brings it back."], newsenders: ["userPlus", "No new senders", "First-time senders wait here while the Screener is on."], outbox: ["send", "Outbox is empty", "Messages you send offline wait here."] };
  const e = by[V.place] || ["inbox", `Nothing in ${PLACES.find((p) => p.id === V.place)?.label || V.folderName}`, ""];
  return `<div class="empty">${I(e[0], "lg glyph")}<h3>${e[1]}</h3>${e[2] ? `<p>${e[2]}</p>` : ""}<div class="acts"><button class="btn sm ghost" type="button" data-act="place" data-place="inbox">Back to Inbox</button></div></div>`;
}
function grpHead(g) {
  if (g.sender && g.n === 1) return "";
  if (g.sender) return `<button class="grp-h nl" type="button" data-act="nltoggle" data-who="${g.sender}" aria-expanded="${!g.more}">${avatar(P(g.sender), "sm")}<span class="trunc">${esc(g.label)}</span><span class="n">${g.n}</span>${g.n > 1 ? I(g.more ? "chevR" : "chevD", "xs glyph") : ""}</button>`.replace("<button", `<div class="grp-wrap"><button`) + `<button class="btn xs ghost mini-acts" type="button" data-act="doneall" data-who="${g.sender}">Done all</button></div>`;
  return g.label ? `<div class="sec-h"><span class="eyebrow">${esc(g.label)}</span></div>` : "";
}
function listPane() {
  const rows = visibleThreads(); const gs = groups(rows);
  const label = V.place === "folder" ? V.folderName : PLACES.find((p) => p.id === V.place).label;
  let body;
  if (V.loading) body = `<div class="loading-note" role="status">${I("sync", "xs glyph")}Getting your newest mail. This takes a few seconds.</div>` + skeleton();
  else if (!rows.length) body = emptyFor();
  else body = gs.map((g) => `${grpHead(g)}${g.sender && !(V.nlOpen || []).includes(g.sender) && g.n > 1 ? "" : g.rows.map(row).join("")}`).join("");
  return `<section class="list" aria-label="${esc(label)}">${listHead(label)}${statusLines()}${selLine()}
    <div class="rows scroll" id="rows" role="group" tabindex="-1" aria-label="Conversations" data-selecting="${V.checked.length > 0}">${body}</div>
    <div class="hintline${rows.length ? "" : " none"}" data-place="${V.place}" aria-live="polite">${V.hint ? V.hint : ""}</div>
  </section>`;
}

function row(t) {
  const p = who(t); const checked = V.checked.includes(t.id); const selected = V.sel === t.id;
  const toMode = t.counterpart && (t.place !== "inbox" || t.state === "waiting");
  const whoText = toMode ? `To ${p.name}` : p.name;
  const time = t.state === "snoozed" && V.place === "snoozed" ? fmtUntil(t.snoozeUntil) : t.state === "waiting" && V.place === "followups" ? (t.waitDue ? "No reply" : `Reminds ${fmtDay(t.waitBy)}`) : fmtTime(t.when);
  const flags = [];
  if (p.priority) flags.push(`<span class="fl pri tip" data-tip="Priority person">${I("star", "xs")}<span class="sr">priority person, </span></span>`);
  if (t.pinned) flags.push(`<span class="fl">${I("pin", "xs")}<span class="sr">pinned, </span></span>`);
  if (t.invite) flags.push(`<span class="fl">${I("calendar", "xs")}<span class="sr">invite</span></span>`);
  else if (t.att.length) flags.push(`<span class="fl">${I("clip", "xs")}<span class="sr">${t.att.length} attachment${t.att.length > 1 ? "s" : ""}</span></span>`);
  if (t.task) flags.push(`<span class="fl">${I("task", "xs")}<span class="sr">has a task</span></span>`);
  if (t.note) flags.push(`<span class="fl">${I("notes", "xs")}<span class="sr">has a note</span></span>`);
  if (t.state === "waiting") flags.push(`<span class="fl ${t.waitDue ? "due" : "wait"}">${I("wait", "xs")}<span class="sr">waiting for a reply</span></span>`);
  if (t.place === "outbox") flags.push(`<span class="fl st">${I(V.net === "offline" ? "offline" : "send", "xs")}<span>${V.net === "offline" ? "Waiting for connection" : "Sending…"}</span></span>`);
  if (t.sendFailed) flags.push(`<span class="fl st warn">${I("alert", "xs")}<span>Not sent</span></span>`);
  if (t.back && t.back !== true && t.state === "open") flags.push(`<span class="fl st back tip" data-tip="${t.back === "reply" ? "Came back early: a new reply" : "Came back while you were away"}">${I("clock", "xs")}<span>${t.back === "reply" ? "New reply" : "Back"}</span></span>`);
  if (t.state === "snoozed" && V.place !== "snoozed") flags.push(`<span class="fl">${I("clock", "xs")}<span class="sr">snoozed</span></span>`);
  const acts = t.state === "done" ? ib("undo", "Not done · ⇧e", "undone", `data-id="${t.id}"`, true) : `${ib("check", "Done · e", "done", `data-id="${t.id}"`, true)}${ib("clock", "Snooze · s", "snooze", `data-id="${t.id}"`, true)}${ib("more", "More", "more", `data-id="${t.id}"`, true)}`;
  const screener = t.screened ? `<div class="scr-acts"><button class="btn xs secondary" type="button" data-act="allow" data-id="${t.id}">Allow<span class="kbd" aria-hidden="true">y</span></button><button class="btn xs ghost" type="button" data-act="block" data-id="${t.id}">Block<span class="kbd" aria-hidden="true">b</span></button></div>` : "";
  return `<div class="row${t.read ? "" : " unread"}" data-selected="${selected}" data-checked="${checked}" data-id="${t.id}" draggable="true">
    <span class="lead">${!t.read ? `<span class="ud" aria-hidden="true"></span>` : ""}<span class="acc-ring" data-label="${V.scope ? "none" : ACCOUNTS[t.acc].hue}" title="${esc(ACCOUNTS[t.acc].label)}">${avatar(p)}</span><button class="cb" type="button" tabindex="-1" aria-label="${checked ? "Deselect" : "Select"} · x" aria-pressed="${checked}" data-act="check" data-id="${t.id}">${checked ? I("check", "xs") : ""}</button></span>
    <button class="rowbtn lines" type="button" tabindex="${selected ? 0 : -1}" aria-current="${selected}" data-act="select" data-id="${t.id}">
      ${!t.read ? `<span class="sr">Unread, </span>` : ""}<span class="l1"><span class="who trunc">${esc(whoText)}</span>${t.msgs > 1 ? `<span class="cnt"><span class="sr">, </span>${t.msgs}<span class="sr"> messages, </span></span>` : ""}<span class="flags">${flags.join("")}</span><span class="sr">, </span><span class="time">${esc(time)}</span><span class="sr">, </span></span>
      <span class="l2 trunc" title="${esc(t.subject)}">${esc(t.subject.replace(/^((re|fwd?|aw|wg):\s*)+/i, ""))}</span>
      <span class="l3">${esc(t.snippet)}</span>
    </button>${screener}
    <div class="ra" role="group" aria-label="Actions">${acts}</div>
  </div>`;
}

/* reader */
function toolbar(t) {
  if (t.place === "drafts" || t.place === "outbox") return `<div class="rd-bar" role="toolbar" aria-label="Draft actions" id="rd-bar">${ib("pen", "Edit · ↵", t.place === "outbox" ? "editOutbox" : "fixFailed")}${t.place === "outbox" ? `<button class="btn xs ghost" type="button" data-act="noop" ${V.net === "offline" ? 'disabled title="Offline"' : ""}>${I("send", "xs")}Send now</button>` : ""}${ib("trash", "Delete draft · #", "delete")}<span class="sp"></span>${ib("panelR", V.panel ? "Hide the side panel" : "Today, contact and task · ⌥1", "panel", `data-panel="${V.panel ? "" : "today"}" aria-pressed="${!!V.panel}"`)}</div>`;
  const left = `${ib("reply", "Reply · r", "reply")}${ib("replyAll", "Reply all · a", "replyAll")}${ib("forward", "Forward · f", "forward")}<span class="sep" aria-hidden="true"></span>`;
  const done = t.state === "done" ? ib("inbox", "Not done, back to Inbox · ⇧e", "undone") : ib("check", "Done · e", "done");
  const mid = `${done}${ib("clock", t.state === "snoozed" ? "Snoozed · s to change" : "Snooze · s", "snooze", t.state === "snoozed" ? 'aria-pressed="true"' : "")}${ib("task", t.task ? "Open the task · ⌥3" : "Make a task · t", "task", t.task ? 'aria-pressed="true"' : "")}${ib("link", "Link to a task, contact or note · l", "link")}${ib("notes", t.note ? "Open the private note" : "Private note · n", "note", t.note ? 'aria-pressed="true"' : "")}<span class="sep" aria-hidden="true"></span>`;
  const right = `${ib("pin", t.pinned ? "Unpin · p" : "Pin · p", "pin", t.pinned ? 'aria-pressed="true"' : "")}${ib("move", "Move · m", "move")}${ib("more", "More", "more")}<span class="sp"></span>${ib("panelR", V.panel ? "Hide the side panel" : "Today, contact and task · ⌥1", "panel", `data-panel="${V.panel ? "" : "today"}" aria-pressed="${!!V.panel}"`)}`;
  return `<div class="rd-bar" role="toolbar" aria-label="Conversation actions" id="rd-bar" data-bulk="${V.checked.length > 0}">${left}${mid}${right}</div>`;
}
function stateLine(t) {
  const p = who(t); const first = p.name.split(" ")[0]; const chips = [];
  if (t.state === "waiting") chips.push(t.waitDue
    ? `<button class="chip due btn-chip" type="button" data-act="wait">${I("wait", "xs glyph")}No reply from ${esc(first)} · ${Math.round((NOW - new Date(t.when)) / DAY)} days</button>`
    : `<button class="chip wait btn-chip" type="button" data-act="wait">${I("wait", "xs glyph")}Waiting for ${esc(first)}'s reply · reminds ${fmtUntil(t.waitBy)}</button>`);
  if (t.state === "snoozed") chips.push(`<button class="chip btn-chip" type="button" data-act="snooze">${I("clock", "xs glyph")}Returns ${fmtUntil(t.snoozeUntil)}</button>`);
  if (t.state === "done") chips.push(`<span class="chip done">${I("archive", "xs glyph")}Done ${fmtDay(t.doneAt || NOW.toISOString())} · in Archive</span>`);
  if (t.task) chips.push(`<button class="chip task btn-chip" type="button" data-act="panel" data-panel="task">${I("task", "xs glyph")}<span class="lbl">Task: ${esc(t.task.title)}${t.task.due ? ` · ${fmtDay(t.task.due)}` : ""}</span></button>`);
  if (t.note) chips.push(`<button class="chip btn-chip" type="button" data-act="noop">${I("notes", "xs glyph")}<span class="lbl">Private note</span></button>`);
  for (const l of t.links.filter((l) => l.kind !== "task")) chips.push(`<button class="chip btn-chip" type="button" data-act="noop">${I(l.kind === "note" ? "notes" : "calendar", "xs glyph")}<span class="lbl">${esc(l.title)}</span></button>`);
  const lead = chips.length ? "" : `<span class="open">Open · nothing linked yet</span>`;
  return `<div class="state-line" aria-label="What this thread is to you">${lead}${chips.join("")}<button class="chip btn-chip tip" type="button" data-act="link" data-tip="Link to a task, contact or note · l" aria-label="Link to a task, contact or note">${I("link", "xs glyph")}<span class="kbd sm" aria-hidden="true">l</span></button></div>`;
}
function whoCard(t) {
  const p = who(t);
  if (p.system) return `<div class="who-card"><span class="av" data-label="gray" aria-hidden="true">${esc(p.name[0])}</span><div class="txt"><div class="nm">${esc(p.name)} <span>${esc(p.email)}</span></div><div class="facts"><span>Automated · in <b>${KINDS[t.kind]}</b> because ${esc(whyOf(t).by === "rule" ? "of your rule" : whyOf(t).by === "sender" ? "you chose it" : "of its headers")}</span><button type="button" data-act="why">Why here?${I("chevD", "xs")}</button></div></div></div>`;
  if (!p.contact && V.panel === "contact") return `<div class="who-card slim">${avatar(p, "sm")}<span class="trunc"><b>${esc(p.name)}</b> <span class="muted">${esc(p.email)} · not in your contacts</span></span></div>`;
  if (!p.contact) return `<div class="who-card unknown">${avatar(p)}<div class="txt"><div class="nm">${esc(p.name)} <span>${esc(p.email)}</span></div><div class="facts"><span>Not in your contacts</span><span>${(() => { const k = t.counterpart || t.from; const n = DB.threads.filter((x) => x.from === k || x.counterpart === k).length; return n > 1 ? `${n - 1} earlier thread${n > 2 ? "s" : ""} with you` : "First message from this sender"; })()}</span></div></div>${t.screened ? `<div class="scr-acts"><button class="btn xs primary" type="button" data-act="allow" data-id="${t.id}">Allow<span class="kbd" aria-hidden="true">y</span></button><button class="btn xs ghost" type="button" data-act="block" data-id="${t.id}">Block<span class="kbd" aria-hidden="true">b</span></button></div>` : `<button class="btn xs secondary" type="button" data-act="addcontact" data-who="${t.counterpart || t.from}">${I("userPlus", "xs")}Add as contact</button>`}</div>`;
  const facts = [];
  facts.push(`<span>${esc(p.lastTouch)}</span>`);
  const nt = (p.tasks || []).length, nn = (p.noteTitles || []).length;
  facts.push(`<button type="button" data-act="panel" data-panel="contact"><b>${nt}</b> open task${nt === 1 ? "" : "s"}</button>`);
  facts.push(`<button type="button" data-act="panel" data-panel="contact"><b>${nn}</b> note${nn === 1 ? "" : "s"}</button>`);
  if (p.meetings && p.meetings[0]) facts.push(`<button type="button" data-act="panel" data-panel="contact">${I("calendar", "xs")}${esc(p.meetings[0])}</button>`);
  const key = t.counterpart || t.from; const nmail = DB.threads.filter((x) => x.from === key || x.counterpart === key).length;
  if (V.panel === "contact") return `<div class="who-card slim">${avatar(p, "sm")}<span class="trunc"><b>${esc(p.name)}</b> <span class="muted">${esc(p.company)} · in the Contact panel</span></span></div>`;
  facts.splice(1, 0, `<button type="button" data-act="panel" data-panel="contact">${I("mail", "xs")}Mail with ${esc(p.name.split(" ")[0])} · <b>${nmail}</b></button>`);
  return `<div class="who-card">${avatar(p)}<div class="txt"><div class="nm"><span class="trunc" style="color:var(--foreground)">${esc(p.name)}</span>${p.priority ? `<span class="fl pri">${I("star", "xs")}<span class="sr">priority person, </span></span>` : ""}<span class="trunc">${esc(p.company)}${p.role ? ` · ${esc(p.role)}` : ""}</span></div><div class="facts">${facts.join("")}</div></div><button class="btn xs ghost tip" type="button" data-act="panel" data-panel="contact" data-tip="Contact ⌥2">Open contact</button></div>`;
}
function bodyOf(t) {
  if (BODIES[t.body]) return BODIES[t.body];
  if (t.counterpart) return [{ from: "you", when: t.when, text: [t.snippet.replace(/^You: /, "")] }];
  return [{ from: t.from, when: t.when, text: [t.snippet + (t.kind === "reading" ? " Read the full issue on the web, or keep scrolling for the three stories we picked this week." : "")], att: t.att }];
}
function messages(t) {
  const ms = t.longThread ? longThread(t) : bodyOf(t);
  const last = ms.length - 1;
  const exp = V.expanded || new Set([last, ...(t.read ? [] : ms.map((m, i) => i).filter((i) => i >= ms.length - (t.unreadCount || 1)))]);
  const fold = ms.length > 5 && !V.expanded && !V.unfold;
  if (t.bodyState === "remote") return `<div class="msgs">${bodyPending(t, ms[ms.length - 1])}</div>`;
  const shown = ms.map((m, i) => [m, i]).filter(([, i]) => !fold || i === 0 || i >= ms.length - 2);
  return `<div class="msgs">${shown.map(([m, i]) => (fold && i === ms.length - 2 ? `<button class="msg fold" type="button" data-act="unfold">${ms.length - 3} earlier messages</button>` : "") + (exp.has(i) ? openMsg(t, m, i, ms) : closedMsg(t, m, i))).join("")}</div>`;
}
function closedMsg(t, m, i) {
  const p = P(m.from); const unread = !t.read && i > 0 && m.from !== "you" && i >= (t.msgs - (t.unreadCount || 0));
  return `<div class="msg"><button class="msg-h" type="button" data-act="expand" data-i="${i}" aria-expanded="false">${avatar(p, "sm")}<span class="nm">${esc(p.me ? "You" : p.name)}</span>${unread ? `<span class="unr" aria-label="unread"></span>` : ""}<span class="snip trunc">${esc(m.text[0])}</span><span class="t">${fmtTime(m.when)}</span>${I("chevD", "xs glyph")}</button></div>`;
}
function openMsg(t, m, i, ms) {
  const p = P(m.from); const prev = i > 0 ? ms[i - 1] : null;
  const tos = (m.from === "you" ? [t.counterpart || t.from, ...(t.to || [])].filter((k, i, a) => k !== "you" && a.indexOf(k) === i) : ["you", ...(t.to || []).filter((k) => k !== "you" && k !== m.from)]).map(P);
  const toOpen = (V.toOpen || []).includes(i);
  const toLine = toOpen ? tos.map((x) => `${esc(x.name)} &lt;${esc(x.email)}&gt;`).join(", ") : tos.map((x) => esc(x.me ? "Robin" : x.name.split(" ")[0])).join(", ");
  const quoted = prev && (V.quoted || []).includes(i);
  const html = t.kind === "updates" || t.kind === "reading";
  const trackers = t.kind === "reading" ? 2 : t.kind === "updates" ? 1 : 0;
  const imagesBar = html && !(V.images[t.id]) ? `<div class="img-bar" role="status">${I("eye", "xs glyph")}<span class="sp trunc" title="Remote images are off, so ${esc(p.name)} can't tell you opened this.">${trackers ? `${trackers} tracker${trackers > 1 ? "s" : ""} blocked · ` : ""}images off</span><button class="btn xs ghost" type="button" data-act="images">Load images</button><button class="btn xs ghost" type="button" data-act="imagesAlways" aria-label="Always load images from ${esc(p.name)}">Always</button></div>` : "";
  const atts = (m.att || []).length ? `<div class="atts">${m.att.map((a) => { const ext = a.split(".").pop().toUpperCase().slice(0, 4); const size = [128, 240, 412, 96, 1200, 31][a.length % 6]; return `<button class="att tip" type="button" data-tip="Quick Look · Space, save with ⌘S"><span class="ft" aria-hidden="true">${ext}</span><span class="trunc">${esc(a)}</span><span class="sz">${fmtKB(size)}</span>${I("download", "xs glyph")}</button>`; }).join("")}</div>` : "";
  return `<article class="msg open" aria-label="Message from ${esc(p.name)}">
    <div class="msg-h">${avatar(p)}<div class="hd"><div class="nm">${esc(p.me ? "You" : p.name)} <span>${esc(p.email)}</span></div><div class="to">to ${toLine}<button type="button" class="ib tip" data-tip="${toOpen ? "Hide addresses" : "Show addresses"}" aria-label="${toOpen ? "Hide addresses" : "Show addresses"}" data-act="toaddr" data-i="${i}">${I(toOpen ? "chevU" : "chevD", "xs")}</button></div></div><div class="msg-acts">${ib("reply", "Reply to this message", "reply")}${ib("replyAll", "Reply all", "replyAll")}${ib("forward", "Forward this message", "forward")}${ib("more", "More", "msgmore")}</div><span class="t" style="font-size:var(--text-xs);color:var(--muted-foreground);white-space:nowrap">${fmtFull(m.when)}</span></div>
    <div class="msg-b">${imagesBar}${m.text.map((x) => `<p>${esc(x)}</p>`).join("")}${prev ? `<button class="quote-tgl" type="button" data-act="quote" data-i="${i}" aria-expanded="${quoted}">${I("more", "xs")}${quoted ? "Hide quoted text" : "Show quoted text"}</button>${quoted ? `<div class="quoted">On ${fmtFull(prev.when)}, ${esc(P(prev.from).me ? "you" : P(prev.from).name)} wrote:<br>${prev.text.map(esc).join("<br>")}</div>` : ""}` : ""}${atts}${html ? `<div class="html-note"><button class="btn xs ghost tip" type="button" data-act="htmlcolors" data-tip="This message was drawn in Moduo's dark surface">${I("eye", "xs")}${V.html[t.id] ? "Back to dark" : "Original colours"}</button></div>` : ""}</div>
  </article>`;
}
function longThread(t) {
  const ms = []; const ppl = ["jonas", "you", "dev", "jonas", "you", "jonas", "ana", "you", "jonas", "dev", "you", "jonas"];
  for (let i = 0; i < 12; i++) { const d = new Date(NOW); d.setDate(d.getDate() - 11 + i); d.setHours(i === 11 ? 9 : 9 + (i * 3) % 9, i === 11 ? 58 : (i * 17) % 60); ms.push({ from: ppl[i], when: d.toISOString().slice(0, 19), text: i === 11 ? ["Final answer from our side: the pilot moves to the week of 16 November, 25 seats, Devon on the weekly check-in. The SSO window is booked for the 12th.", "Can you confirm by Thursday?", "Jonas"] : [["Draft timeline attached.", "Works for us, two notes inline.", "SSO is on track; can the pilot group be 25?", "25 is fine, same price.", "Ops wants Devon on the weekly, not only the kickoff.", "Agreed. Sending the revised sheet.", "Hero and the pilot deck share assets; I'll keep them in sync.", "Thanks all. Let's lock the week on Thursday's call.", "Our IT lead needs the SSO window a week earlier than planned.", "The flag lets us roll back in a minute if the 12th is tight.", "Noted. Revised v3 attached.", ""][i]], att: i % 5 === 0 ? [`Acme-rollout-v${1 + Math.floor(i / 5)}.pdf`] : [] }); }
  return ms;
}
function bulkReader() {
  const ts = V.checked.map(T).filter(Boolean);
  return `<section class="reader" aria-label="${ts.length} selected"><div class="bulk-sum"><h2>${ts.length} selected</h2><p class="muted">Every action below applies to all ${ts.length}, as one step that <span class="kbd">z</span> undoes.</p><ul>${ts.map((x) => `<li>${avatar(who(x), "sm")}<span class="trunc"><b>${esc(who(x).name)}</b> · ${esc(x.subject.replace(/^((re|fwd?):\s*)+/i, ""))}</span></li>`).join("")}</ul><div class="bulk-acts">${[["check", "Done", "e", "done"], ["clock", "Snooze…", "s", "snooze"], ["task", "Make tasks", "t", "task"], ["move", "Move…", "m", "move"], ["trash", "Delete", "#", "delete"]].map(([i, l, k, a]) => `<button class="btn sm secondary" type="button" data-act="${a}">${I(i, "xs")}${l}<span class="kbd" aria-hidden="true">${k}</span></button>`).join("")}</div><p class="muted"><span class="kbd">Esc</span> clears the selection.</p></div></section>`;
}
function reader(t) {
  if (V.checked.length > 1) return bulkReader();
  if (!t && !flatRows().length) return `<section class="reader quiet" aria-label="Conversation"></section>`;
  if (!t) { const none = !flatRows().length; return `<section class="reader" aria-label="Conversation"><div class="rd-empty empty">${I(none ? "check" : "mailOpen", "lg glyph")}<h3>${none ? (V.loading ? "Getting your newest mail" : "Nothing to decide") : "No conversation selected"}</h3><p>${none ? (V.loading ? "The newest mail arrives first; older mail fills in behind it." : "Write a message with <span class=\"kbd\">c</span>, or come back when mail lands.") : `Pick a conversation on the left, or press <span class="kbd">j</span> to start at the top.`}</p></div></section>`; }
  const inlineCompose = V.compose && V.compose.mode !== "new";
  const unsub = t.kind === "reading" ? `<div class="unsub-bar">${I("mailOpen", "xs glyph")}<span class="sp">${esc(who(t).name)} sends about one newsletter a week. ${V.unsub && V.unsub[t.from] ? "<b>Unsubscribed.</b> Nothing more will arrive." : "One click stops it; nothing else is sent."}</span>${V.unsub && V.unsub[t.from] ? "" : `<button class="btn xs secondary" type="button" data-act="unsub">Unsubscribe</button>`}</div>` : "";
  const inv = t.invite ? `<div class="invite"><div class="inv-date" aria-hidden="true"><span>Thu</span><b>5</b></div><div class="inv-tx"><b>${esc(t.invite.title)}</b><span>${esc(t.invite.when)} · ${esc(t.invite.where)}</span><span>From ${esc(t.invite.organizer)} · free then on your calendar</span></div><div class="inv-acts" role="group" aria-label="Reply to the invite">${["Accept", "Maybe", "Decline"].map((r) => `<button class="btn xs ${V.rsvp === r ? "secondary" : "outline"}" type="button" aria-pressed="${V.rsvp === r}" data-act="rsvp" data-r="${r}">${r}</button>`).join("")}<button class="btn xs ghost" type="button" data-act="addcal">${I("calendar", "xs")}Add to Moduo calendar</button></div></div>` : "";
  return `<section class="reader" aria-label="Conversation">${toolbar(t)}<div class="rd-body scroll" id="rd-scroll"><div class="rd-head"><h2 id="rd-title" tabindex="-1" title="${esc(t.subject)}">${esc(t.subject)}</h2>${sendNote(t)}${t.place === "outbox" || t.sendFailed ? "" : stateLine(t)}${whoCard(t)}${inv}${unsub}</div>${messages(t)}${inlineCompose ? composer(t) : ""}</div></section>`;
}

/* compose */
const tok = (p) => `<span class="tok">${avatar(p, "sm")}<span>${esc(p.me ? "Robin Hale" : p.name)}</span><button type="button" aria-label="Remove ${esc(p.name)}" data-act="untok" data-who="${esc(p.email)}">${I("x", "xs")}</button></span>`;
function composeRows(t, c) {
  const acc = ACCOUNTS[c.acc || (t ? t.acc : "work")];
  const toks = (c.to || []).map((k) => P(k));
  const sugg = c.sugg != null ? suggestions(c) : "";
  const alias = c.alias || acc.address;
  return `<div class="c-row"><label for="c-from">From</label><button class="sel" type="button" id="c-from" aria-label="From ${esc(alias)}, change address" data-act="frommenu">${accDot(acc.id)}${esc(alias)}${I("chevD", "xs")}</button></div>
  <div class="c-row" style="position:relative"><label for="c-to">To</label><div class="tokens">${toks.map(tok).join("")}<input id="c-to" placeholder="${toks.length ? "Add a person" : "Name or address"}" aria-label="To" autocomplete="off" value="${esc(c.sugg || "")}"></div>${V.ccbcc ? "" : `<button class="ccbcc" type="button" data-act="ccbcc">Cc/Bcc</button>`}${sugg}</div>
  ${c.introducer && !c.introDone ? `<div class="c-intro">${I("userPlus", "xs glyph")}<span class="trunc">${esc(P(c.introducer).name)} introduced you.</span><button class="btn xs ghost" type="button" data-act="introBcc">Move ${esc(P(c.introducer).name.split(" ")[0])} to Bcc</button></div>` : ""}
  ${c.introDone ? `<div class="c-row"><label>Bcc</label><div class="tokens">${tok(P(c.introducer))}</div></div>` : ""}
  ${V.ccbcc ? `<div class="c-row"><label for="c-cc">Cc</label><div class="tokens">${(c.cc || []).map((k) => tok(P(k))).join("")}<input id="c-cc" placeholder="Add a person" aria-label="Cc"></div></div><div class="c-row"><label for="c-bcc">Bcc</label><div class="tokens"><input id="c-bcc" placeholder="Add a person" aria-label="Bcc"></div></div>` : ""}
  ${c.mode === "new" || c.mode === "forward" ? `<div class="c-row"><label for="c-subj">Subject</label><input id="c-subj" value="${esc(c.subject || "")}" placeholder="Subject" aria-label="Subject"></div>` : ""}`;
}
function suggestions(c) {
  const q = (c.sugg || "").toLowerCase();
  const hits = Object.entries(DB.contacts).filter(([k, p]) => !p.me && !p.system && !(c.to || []).includes(k) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))).slice(0, 5);
  if (!hits.length) return "";
  return `<div class="float sugg" role="listbox" aria-label="People" style="left:3.5rem;top:100%">${hits.map(([k, p], i) => `<button class="mi" type="button" role="option" aria-selected="${i === 0}" data-active="${i === 0}" data-act="pick" data-who="${k}">${avatar(p, "sm")}<span>${esc(p.name)}</span><small>${esc(p.contact ? p.company || p.email : p.email)}</small></button>`).join("")}</div>`;
}
function composeTools() { return `<div class="c-tools" role="toolbar" aria-label="Formatting">${ib("bold", "Bold ⌘B", "noop")}${ib("italic", "Italic ⌘I", "noop")}${ib("list", "Bulleted list", "noop")}${ib("link", "Insert link ⌘K", "noop")}<span class="sep" aria-hidden="true"></span><span class="sp"></span><span class="hint-sn"><span class="kbd">;;</span> inserts a snippet</span></div>`; }
const LIMIT_MB = { Google: 25, IMAP: 25, iCloud: 20 };
function composeAtts(c) {
  const atts = c.att || []; if (!atts.length) return "";
  const acc = ACCOUNTS[c.acc || "work"]; const lim = LIMIT_MB[acc.provider] || 25;
  const total = atts.reduce((s, a) => s + a[1], 0); const over = total > lim;
  const fmt = (mb) => mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1000)} KB`;
  return `<div class="c-atts" role="group" aria-label="Attachments">${atts.map(([n, mb]) => `<span class="att-chip${over && mb === Math.max(...atts.map((a) => a[1])) ? " big" : ""}"><span class="ft" aria-hidden="true">${esc(n.split(".").pop().toUpperCase().slice(0, 4))}</span><span class="trunc">${esc(n)}</span><span class="sz">${fmt(mb)}</span><button class="ib" type="button" aria-label="Remove ${esc(n)}" data-act="rmatt" data-name="${esc(n)}">${I("x", "xs")}</button></span>`).join("")}</div>${over ? `<div class="c-limit" role="alert" id="c-limit">${I("alert", "xs glyph")}<span><b>This message is ${fmt(total)}; ${esc(acc.provider === "Google" ? "Gmail" : acc.label)} accepts up to ${lim} MB.</b> Remove an attachment to send: ${esc(atts.reduce((a, b) => (b[1] > a[1] ? b : a))[0])} is the big one.</span></div>` : ""}`;
}
function snippetPop(c) {
  if (c.snip == null) return "";
  const q = c.snip.toLowerCase(); const first = c.to && c.to[0] ? P(c.to[0]).name.split(" ")[0] : "them";
  const hits = SNIPPETS.filter(([k, n]) => !q || k.startsWith(q) || n.toLowerCase().includes(q));
  return `<div class="float snip-pop" role="listbox" aria-label="Snippets">${hits.map(([k, n, text], i) => `<button class="mi" type="button" role="option" aria-selected="${i === 0}" data-active="${i === 0}" data-act="snipPick" data-k="${k}"><span class="mono">;;${k}</span><span class="trunc">${esc(n)}</span><small class="trunc">${esc(text.replace("{first name}", first))}</small></button>`).join("") || `<div class="note">No snippet called ;;${esc(c.snip)}. Make one in Settings → Mail → Snippets.</div>`}<div class="note"><span class="kbd">↵</span> inserts · {first name} becomes ${esc(first)}</div></div>`;
}
function draftState(c) {
  if (c.saved === "server") return `${I("check", "xs glyph")}<span class="trunc" title="Saved to Drafts on ${esc(ACCOUNTS[c.acc || "work"].label)}">Saved to Drafts</span>`;
  if (c.saved === "local" || (c.saved && V.net === "offline")) return `${I("draft", "xs glyph")}Saved on this Mac${V.net === "offline" ? " · reaches Drafts when you're online" : ""}`;
  if (c.saved) return `${I("check", "xs glyph")}Saved to Drafts`;
  return "";
}
function composeFoot(c) {
  const r = c.remind || "Never";
  const tooBig = (c.att || []).reduce((s, a) => s + a[1], 0) > (LIMIT_MB[ACCOUNTS[c.acc || "work"].provider] || 25);
  return `<div class="c-foot"><button class="btn sm primary tip up" type="button" data-act="send" ${tooBig ? 'disabled aria-describedby="c-limit"' : ""} data-tip="${c.mode === "new" ? "Send" : "Send · marks the thread Done"}">${I("send", "xs")}Send<span class="kbd" aria-hidden="true">⌘↩</span></button><label class="remind">${I("wait", "xs glyph")}Remind me if no reply in<button class="sel" type="button" data-act="remind" aria-label="Remind me if no reply in: ${r}">${r}${I("chevD", "xs")}</button></label><span class="sp"></span><span class="draft" role="status">${draftState(c)}</span>${ib("clip", "Attach files", "noop")}${ib("trash", "Discard draft", "discard")}</div>`;
}
function composer(t) {
  const c = V.compose; const p = who(t);
  const title = c.mode === "reply" ? `Reply to ${p.name}` : c.mode === "replyAll" ? "Reply all" : "Forward";
  return `<div class="composer" id="composer" role="region" aria-label="${esc(title)}"><div class="c-head">${I(c.mode === "forward" ? "forward" : "reply", "xs")}<span>${esc(title)}</span><span class="sp"></span>${ib("x", "Discard · Esc", "discard")}</div>${composeRows(t, c)}
  <div class="c-body" contenteditable="true" id="c-body" role="textbox" aria-multiline="true" aria-label="Message"><p data-ph="${c.mode === "forward" ? "Add a note to the forwarded message…" : "Write your reply…"}">${esc(c.text || "")}</p><p class="sig">${esc(sigOf(c, t))}</p></div>${snippetPop(c)}${composeAtts(c)}${composeTools()}${composeFoot(c)}</div>`;
}
function sigOf(c, t) { const acc = ACCOUNTS[c.acc || (t ? t.acc : "work")]; const a = (acc.aliases || []).find((x) => x[0] === (c.alias || acc.address)); return a ? a[1] : "Robin Hale"; }
function newMessage() {
  const c = V.compose;
  return `<section class="reader" aria-label="New message"><div class="composer full" id="composer" role="region" aria-label="New message"><div class="c-head" style="padding-left:var(--panel-inset)">${I("pen", "xs")}<span>New message</span><span class="sp"></span>${ib("x", "Discard · Esc", "discard")}</div>${composeRows(null, c)}<div class="c-body" contenteditable="true" id="c-body" role="textbox" aria-multiline="true" aria-label="Message"><p data-ph="Write your message…">${esc(c.text || "")}</p><p class="sig">${esc(sigOf(c, null))}</p></div>${snippetPop(c)}${composeAtts(c)}${composeTools()}${composeFoot(c)}</div></section>`;
}

/* right panel */
const VIEWS = [["today", "Today", "calendar"], ["contact", "Contact", "user"], ["task", "Task", "task"]];
function rpRow(icon, text, meta, extra = "") { return `<button class="rp-row" type="button" ${extra}>${icon.startsWith("<") ? icon : I(icon, "xs glyph")}<span class="t trunc">${text}</span>${meta ? `<span class="m">${meta}</span>` : ""}</button>`; }
function rightPanel(t) {
  const cur = VIEWS.find((v) => v[0] === V.panel) || VIEWS[0];
  let body = "";
  if (V.panel === "today") body = todayPanel(t);
  else if (!t) body = `<div class="empty" style="height:auto;padding-top:3rem">${I("user", "lg glyph")}<h3>No conversation selected</h3><p>Pick a conversation to see who it's from and what it's linked to.</p></div>`;
  else if (V.panel === "contact") body = contactPanel(t);
  else body = taskPanel(t);
  return `<aside class="panel side motion-panel" aria-label="${cur[1]}"><div class="rp-top"><button class="btn sm ghost" type="button" data-act="viewmenu" aria-haspopup="menu" aria-expanded="${V.overlay === "viewmenu"}" id="view-btn">${I(cur[2])}${cur[1]}${I("chevD", "xs")}</button><span class="sp"></span>${VIEWS.map((v, i) => `<button class="ib tip" type="button" data-tip="${v[1]} ⌥${i + 1}" aria-label="${v[1]}" aria-pressed="${V.panel === v[0]}" data-act="panel" data-panel="${v[0]}">${I(v[2])}</button>`).join("")}</div><div class="rp-body scroll" tabindex="0" aria-label="${cur[1]} panel">${body}</div></aside>`;
}
function todayPanel(t) {
  const ev = TODAY.events.map(([h, title, past]) => `<div class="tp-ev${past ? " past" : ""}"><span class="tab">${h}</span><span class="trunc">${esc(title)}</span></div>`).join("");
  const tasks = [...(V.todayTasks || []), ...TODAY.tasks].map(([title, who]) => `<div class="rp-row static"><span class="rc" aria-hidden="true"></span><span class="t trunc">${esc(title)}</span></div>`).join("");
  return `<div class="today" data-drop-today="true"><div class="rp-sec"><h4>Today · Tue 3 Nov</h4>${ev}</div><div class="rp-sec"><h4>Due today <span class="n">${(V.todayTasks || []).length + TODAY.tasks.length}</span></h4>${tasks}<div class="dropzone">${I("dnd", "xs glyph")}Drop a thread here to do it today</div></div>${t ? `<div class="rp-sec"><button class="btn sm ghost" type="button" data-act="mkevent" style="width:100%;justify-content:flex-start">${I("calendar", "xs")}Create event from this email</button></div>` : ""}</div>`;
}
function linksPanel(t) {
  const p = who(t); const tasks = t.task ? [t.task] : []; const notes = t.links.filter((l) => l.kind === "note"); const events = t.links.filter((l) => l.kind === "event");
  const people = [p, ...(t.to || []).filter((k) => k !== "you" && k !== t.from).map(P)].filter((x) => x && !x.me);
  const none = !tasks.length && !notes.length && !events.length;
  return `<div class="rp-sec"><div class="field sm">${I("link", "glyph")}<input id="link-q" placeholder="Link a task, note, person or meeting" aria-label="Link to"></div></div>
  ${none ? `<p class="rp-quiet" style="padding:0 .5rem .25rem">Nothing linked yet. <span class="kbd">t</span> makes a task from this conversation; drop it on Tasks, Notes or Calendar in the top bar to attach it there.</p>` : ""}
  ${tasks.length ? `<div class="rp-sec"><h4>Tasks <span class="n">${tasks.length}</span></h4>${tasks.map((k) => rpRow(`<span class="rc" aria-hidden="true"></span>`, esc(k.title), k.due ? fmtDay(k.due) : "", `data-act="panel" data-panel="task"`)).join("")}</div>` : ""}
  ${notes.length ? `<div class="rp-sec"><h4>Notes <span class="n">${notes.length}</span></h4>${notes.map((n) => rpRow("notes", esc(n.title), "", `data-act="noop"`)).join("")}</div>` : ""}
  ${events.length ? `<div class="rp-sec"><h4>Meetings <span class="n">${events.length}</span></h4>${events.map((n) => rpRow("calendar", esc(n.title), "", `data-act="noop"`)).join("")}</div>` : ""}
  <div class="rp-sec"><h4>People <span class="n">${people.length}</span></h4>${people.map((x) => rpRow(avatar(x, "sm"), `${esc(x.name)}${x.contact ? "" : ` <span class="muted">· not a contact</span>`}`, x.contact ? "" : "Add", `data-act="${x.contact ? "panel" : "addcontact"}" data-panel="contact" data-who="${Object.keys(DB.contacts).find((k) => DB.contacts[k] === x) || ""}"`)).join("")}</div>
  <div class="rp-sec"><h4>Tags</h4><button class="chip btn-chip" type="button" data-act="noop">${I("plus", "xs glyph")}Tag</button></div>
  <div class="rp-sec"><h4>Activity</h4><p class="rp-quiet">${t.task ? `You made a task from this thread · ${fmtDay(NOW.toISOString())}` : "Nothing yet. Reading and triage never leave this Mac."}</p></div>`;
}
function contactPanel(t) {
  const p = who(t); const key = t.counterpart || t.from;
  if (!p.contact) return `<div class="contact-head">${avatar(p, "lg")}<div><div class="nm">${esc(p.name)}</div><div class="sub">${esc(p.email)}</div></div></div><div class="rp-sec"><p class="rp-quiet">Not in your contacts. Adding them keeps every thread, task and note with ${esc(p.name.split(" ")[0])} in one place. Nothing is ever added without you.</p><button class="btn sm primary" type="button" data-act="addcontact" data-who="${key}" style="margin-top:.5rem">${I("userPlus")}Add as contact</button></div>
  <div class="rp-sec"><h4>Threads with ${esc(p.name.split(" ")[0])}</h4>${DB.threads.filter((x) => (x.from === key || x.counterpart === key) && x.id !== t.id).slice(0, 4).map((x) => rpRow("mail", esc(x.subject), fmtTime(x.when), `data-act="open" data-id="${x.id}"`)).join("") || `<p class="rp-quiet">This is the first.</p>`}</div>`;
  const threads = DB.threads.filter((x) => (x.from === key || x.counterpart === key) && x.id !== t.id).slice(0, 5);
  return `<div class="contact-head">${avatar(p, "lg")}<div style="min-width:0"><div class="nm trunc">${esc(p.name)}</div><div class="sub trunc">${esc(p.company)}${p.role ? ` · ${esc(p.role)}` : ""}</div><div class="sub trunc">${esc(p.email)}</div></div></div>
  <div class="rp-sec"><p class="rp-quiet">${esc(p.lastTouch)}${p.member ? " · teammate" : ""}</p></div>
  <div class="rp-sec"><h4>Open tasks <span class="n">${(p.tasks || []).length}</span></h4>${(p.tasks || []).length ? p.tasks.map(([x, d]) => rpRow(`<span class="rc" aria-hidden="true"></span>`, esc(x), d, `data-act="noop"`)).join("") : `<p class="rp-quiet">None.</p>`}</div>
  <div class="rp-sec"><h4>Notes <span class="n">${(p.noteTitles || []).length}</span></h4>${(p.noteTitles || []).length ? p.noteTitles.map((x) => rpRow("notes", esc(x), "", `data-act="noop"`)).join("") : `<p class="rp-quiet">None.</p>`}</div>
  ${p.meetings && p.meetings.length ? `<div class="rp-sec"><h4>Meetings</h4>${p.meetings.map((x) => rpRow("calendar", esc(x), "", `data-act="noop"`)).join("")}</div>` : ""}
  <div class="rp-sec"><h4>Threads with ${esc(p.name.split(" ")[0])} <span class="n">${threads.length}</span></h4>${threads.map((x) => rpRow("mail", esc(x.subject), fmtTime(x.when), `data-act="open" data-id="${x.id}"`)).join("") || `<p class="rp-quiet">This is the first.</p>`}</div>
  <div class="rp-sec"><button class="btn sm ghost" type="button" data-act="noop">${I("external", "xs")}Open in Contacts</button></div>`;
}
function taskPanel(t) {
  if (!t.task) return `<div class="empty" style="height:auto;padding-top:3rem">${I("task", "lg glyph")}<h3>No task yet</h3><p>Press <span class="kbd">t</span> to make one from this conversation. It keeps the thread and ${esc(who(t).name.split(" ")[0])} linked.</p><div class="acts"><button class="btn sm secondary" type="button" data-act="task">Make a task</button></div></div>`;
  const k = t.task; const p = who(t);
  return `<div class="task-card"><div class="tt"><span class="rc" aria-hidden="true"></span><span>${esc(k.title)}</span></div>
  <dl class="tc-grid"><dt>Due</dt><dd><button class="chip btn-chip" type="button" data-act="noop">${I("calendar", "xs glyph")}${k.due ? fmtDay(k.due) : "Pick a date"}</button></dd><dt>Project</dt><dd><button class="chip btn-chip" type="button" data-act="noop">${I("folder", "xs glyph")}${p.company && p.contact ? esc(p.company) : "Inbox"}</button></dd><dt>Assignee</dt><dd><span class="chip">${avatar(PEOPLE.you, "sm")}You</span></dd><dt>Reminder</dt><dd><button class="chip btn-chip" type="button" data-act="noop">${I("bell", "xs glyph")}None</button></dd></dl>
  <div class="src-card"><span class="eyebrow">From this email</span><span class="trunc">${esc(t.subject)}</span><span class="s">${esc(p.name)} · ${fmtTime(t.when)}${t.att.length ? ` · ${t.att.length} attachment${t.att.length > 1 ? "s" : ""}` : ""}</span></div>
  <div style="display:flex;gap:.375rem;flex-wrap:wrap"><button class="btn sm secondary" type="button" data-act="noop">${I("calendar", "xs")}Schedule</button><button class="btn sm ghost" type="button" data-act="noop">${I("external", "xs")}Open in Tasks</button></div>
  <p class="rp-quiet">Done here or in Tasks: the thread says so either way.</p></div>`;
}

/* first run, web */
function firstRun() {
  return `<div class="first-run"><div class="first-card"><h3>Connect your mail</h3><p>Mail stays on this Mac. Pick your provider to start; the newest mail is readable in about ten seconds and older mail fills in behind it.</p><div class="prov" role="group" aria-label="Choose a provider">${[["gmail", "Gmail", "Google sign-in"], ["microsoft", "Microsoft", "Outlook, 365"], ["icloud", "iCloud", "App password"], ["imap", "Other IMAP", "Any server"]].map(([k, l, s]) => `<button type="button" data-act="connect" data-prov="${k}">${I("mail", "md")}${l}<small>${s}</small></button>`).join("")}</div><p class="hint" style="font-size:var(--text-2xs);color:var(--subtle-foreground)">Several accounts? Add them one after another. The inbox stays one list, split into Personal, Notifications and Newsletters.</p></div></div>`;
}
function webView() {
  const sn = DB.threads.filter((t) => t.state === "snoozed"); const wt = DB.threads.filter((t) => t.state === "waiting"); const linked = DB.threads.filter((t) => t.task || t.links.length).slice(0, 3);
  const card = (t, meta) => `<div class="src-card" style="padding:.625rem .75rem"><span class="trunc" style="font-weight:500">${esc(t.subject)}</span><span class="s">${esc(who(t).name)} · ${meta}</span><div style="display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.25rem">${t.task ? `<button class="chip task btn-chip" type="button" data-act="noop">${I("task", "xs glyph")}<span class="lbl">Open task: ${esc(t.task.title)}</span></button>` : ""}${t.links.filter((l) => l.kind !== "task").map((l) => `<button class="chip btn-chip" type="button" data-act="noop">${I(l.kind === "note" ? "notes" : "calendar", "xs glyph")}<span class="lbl">Open ${l.kind}: ${esc(l.title)}</span></button>`).join("")}<span class="chip">${I("mail", "xs glyph")}Continue on Mac</span></div></div>`;
  return `<div class="web-note web-wide"><div class="banner info" style="margin:0;grid-column:1 / -1">${I("mail", "glyph")}<span class="sp"><b>Mail lives on your Mac.</b> Here you see the conversations you linked to a task, a note or an event, so the rest of your work can find them. Snoozes and follow-ups stay on the Mac.</span><button class="btn xs secondary" type="button" data-act="noop">Open Moduo for Mac</button></div>
  <div class="rp-sec" style="padding:0"><h4 style="margin-top:.75rem">Linked conversations <span class="n">${linked.length}</span></h4><div style="display:grid;gap:.375rem">${linked.map((t) => card(t, fmtTime(t.when))).join("")}</div></div></div>`;
}

function subscriptionsView() {
  const by = {}; for (const t of DB.threads.filter((x) => x.kind === "reading")) (by[t.from] ||= []).push(t);
  const rows = Object.entries(by).map(([k, ts]) => { const p = P(k); const gone = V.unsub && V.unsub[k]; return `<div class="vrow">${avatar(p)}<div class="vtx"><b>${esc(p.name)}</b><small>${esc(p.email)} · last mailed ${fmtDay(ts[0].when)} · ${ts.length} thread${ts.length > 1 ? "s" : ""}</small></div><button class="btn xs outline" type="button" data-act="unsubfrom" data-who="${k}" ${gone ? "disabled" : ""}>${gone ? "Unsubscribed" : "Unsubscribe"}</button><button class="btn xs ghost" type="button" data-act="doneall" data-who="${k}">Done all</button></div>`; }).join("");
  return `<section class="view" aria-label="Subscriptions"><div class="view-h"><h2>Subscriptions</h2><span class="n">${Object.keys(by).length} senders</span></div><p class="view-sub">Every newsletter that reaches you, newest first. Unsubscribe uses the sender's one-click link when it has one.</p><div class="vlist">${rows}</div></section>`;
}
const fmtKB = (kb) => kb > 999 ? `${(kb / 1000).toFixed(1)} MB` : `${kb} KB`;
function attachmentsView() {
  const f = V.attFilter || "All";
  const all = [...DB.threads].sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).flatMap((t) => (t.att || []).filter((a) => a !== "invite.ics").map((a) => ({ a, t }))).filter(({ a }) => f === "All" || (f === "PDFs" ? /\.pdf$/i.test(a) : f === "Images" ? /\.(jpe?g|png)$/i.test(a) : f === "Documents" ? /\.(docx?|zip)$/i.test(a) : f === "Spreadsheets" ? /\.xlsx?$/i.test(a) : false));
  return `<section class="view" aria-label="Attachments"><div class="view-h"><h2>Attachments</h2><span class="n">${all.length} files</span></div><div class="seg" role="radiogroup" aria-label="File type" style="margin:0 var(--panel-inset) .5rem">${["All", "Images", "PDFs", "Documents", "Spreadsheets"].map((k) => `<button type="button" role="radio" aria-checked="${f === k}" data-act="attfilter" data-f="${k}">${k}</button>`).join("")}</div><div class="vlist">${all.map(({ a, t }) => { const ext = a.split(".").pop().toUpperCase().slice(0, 4); return `<button class="vrow" type="button" data-act="open" data-id="${t.id}"><span class="ft" aria-hidden="true">${ext}</span><div class="vtx"><b class="trunc">${esc(a)}</b><small class="trunc">${esc(who(t).name)} · ${esc(t.subject)}</small></div><span class="hint">${[128, 240, 412, 96, 1200, 31][a.length % 6]} KB · ${fmtTime(t.when)}</span>${I("download", "xs glyph")}</button>`; }).join("")}</div></section>`;
}
function bottombar() {
  return `<footer class="bottombar"><div>${ib("panelL", V.leftOpen ? "Hide the places panel" : "Show the places panel", "left", `aria-pressed="${V.leftOpen}"`)}</div><div class="bb-c">${ib("search", "Search ⌘K", "palette")}${ib("pen", "Quick capture ⌘⇧K", "noop")}${ib("plus", "Create new ⌘N", "new")}</div><div class="bb-r">${ib("panelR", V.panel ? "Hide the side panel" : "Show the side panel", "panel", `data-panel="${V.panel ? "" : "links"}" aria-pressed="${!!V.panel}"`)}</div></footer>`;
}

/* overlays */
function overlay() {
  const o = V.overlay; if (!o) return "";
  const t = sel();
  if (o === "snooze") return `<div class="float" id="pop" role="dialog" aria-label="Snooze until" style="min-width:16rem;max-width:16rem"><div class="mh eyebrow">Snooze until</div>
    ${[["Later today", at(0, 14), "14:00"], ["Tomorrow", at(1, 9), "Wed 9:00"], ["This weekend", at(4, 9), "Sat 9:00"], ["Next week", at(6, 9), "Mon 9:00"], ["Someday", at(90, 9), "in 3 months"]].map(([l, iso, h], i) => `<button class="mi" type="button" data-act="snoozeTo" data-iso="${iso}" data-active="${i === 0}">${l}<span class="hint">${h}</span></button>`).join("")}
    <div class="msep"></div><div class="field sm">${I("clock", "glyph")}<input id="pop-q" placeholder="Or type a time, like thu 9am" aria-label="Snooze until a time you type"></div><div class="note">Returns to the top of your inbox. A new reply brings it back sooner.</div></div>`;
  if (o === "wait") return `<div class="float" id="pop" role="dialog" aria-label="Remind me if no reply" style="min-width:17rem"><div class="mh eyebrow">Remind me if no reply by</div>
    ${[["Tomorrow", at(1, 9), "Wed 9:00"], ["In 3 days", at(3, 9), "Fri 9:00"], ["Next week", at(6, 9), "Mon 9:00"], ["In two weeks", at(13, 9), "17 Nov"]].map(([l, iso, h], i) => `<button class="mi" type="button" data-act="waitTo" data-iso="${iso}" data-active="${i === 1}">${l}<span class="hint">${h}</span></button>`).join("")}
    <div class="msep"></div><div class="field sm">${I("calendar", "glyph")}<input id="pop-q" placeholder="Or type a day" aria-label="Remind me on a day you type"></div>
    <div class="msep"></div><div role="radiogroup" aria-label="When to remind"><button class="mi" type="button" role="radio" aria-checked="${!V.waitRegardless}" data-act="waitMode" data-mode="reply">${I(V.waitRegardless ? "dash" : "check", "xs glyph")}Only if nobody replies<span class="kbd">Tab</span></button><button class="mi" type="button" role="radio" aria-checked="${V.waitRegardless}" data-act="waitMode" data-mode="always">${I(V.waitRegardless ? "check" : "dash", "xs glyph")}Regardless</button></div>
    ${t && t.state === "waiting" ? `<div class="msep"></div><button class="mi" type="button" data-act="unwait">${I("x", "xs glyph")}Stop the follow-up</button>` : ""}
    <div class="note">The thread moves to Follow-ups. A reply from ${t ? esc(who(t).name.split(" ")[0]) : "them"} clears it; your own replies don't.</div></div>`;
  if (o === "move") return `<div class="float" id="pop" role="dialog" aria-label="Move to a folder" style="min-width:18rem"><div class="field sm">${I("move", "glyph")}<input id="pop-q" placeholder="Move to… type a folder" aria-label="Folder" value="${esc(V.popq || "")}"></div>
    ${["Archive", "Clients/Acme", "Clients/Northwind", "Receipts 2026", "Travel", "Trash"].filter((f) => f.toLowerCase().includes((V.popq || "").toLowerCase())).map((f, i) => `<button class="mi" type="button" data-act="moveTo" data-folder="${f}" data-active="${i === 0}">${I("folder", "xs glyph")}${f}<span class="hint">${t ? esc(ACCOUNTS[t.acc].label) : ""}</span></button>`).join("") || `<div class="note">No folder matches. Folders are made in your mail provider for now.</div>`}</div>`;
  if (o === "more") { const p = t ? who(t) : null; const gmail = t && ACCOUNTS[t.acc].provider === "Google"; return `<div class="float" id="pop" role="menu" aria-label="More"><button class="mi" type="button" role="menuitem" data-act="wait">${I("wait", "xs glyph")}Remind me if no reply<span class="kbd">w</span></button><button class="mi" type="button" role="menuitem" data-act="unread">${I("mailOpen", "xs glyph")}${t && t.read ? "Mark unread" : "Mark read"}<span class="kbd">u</span></button><button class="mi" type="button" role="menuitem" data-act="move">${I("move", "xs glyph")}Move to…<span class="kbd">m</span></button>${gmail ? `<button class="mi" type="button" role="menuitem" data-act="noop">${I("folder", "xs glyph")}Labels…</button>` : ""}<button class="mi" type="button" role="menuitem" data-act="mute">${I("bellOff", "xs glyph")}${t && t.muted ? "Unmute" : "Mute: new replies skip the inbox"}</button><div class="msep"></div>${t && t.place === "inbox" ? `<button class="mi" type="button" role="menuitem" data-act="why">${I("filter", "xs glyph")}Why is this in ${KINDS[t.kind]}?</button><button class="mi" type="button" role="menuitem" data-act="rule">${I("filter", "xs glyph")}Make a rule from ${esc(p.name)}…</button>` : ""}${p && !p.me && !p.system ? `<button class="mi" type="button" role="menuitem" data-act="priority">${I("star", "xs glyph")}${p.priority ? "Remove from Priority people" : "Mark as a Priority person"}</button>` : ""}<div class="msep"></div><button class="mi" type="button" role="menuitem" data-act="original">${I("eye", "xs glyph")}Show original</button><button class="mi" type="button" role="menuitem" data-act="noop">${I("link", "xs glyph")}Copy link to thread</button><div class="msep"></div>${p && !p.me ? `<button class="mi danger" type="button" role="menuitem" data-act="block" data-id="${t.id}">${I("x", "xs glyph")}Block ${esc(p.name)}</button>` : ""}<button class="mi" type="button" role="menuitem" data-act="spam">${I("alert", "xs glyph")}Report spam</button><button class="mi danger" type="button" role="menuitem" data-act="delete">${I("trash", "xs glyph")}Delete<span class="kbd">#</span></button></div>`; }
  if (o === "tabmenu") return `<div class="float" id="pop" role="menu" aria-label="Tab actions"><div class="mh eyebrow">Get me to zero in ${KINDS[V.tab]}</div>${[["day", "Done everything older than a day"], ["week", "Done everything older than a week"], ["month", "Done everything older than a month"]].map(([k, l]) => `<button class="mi" type="button" role="menuitem" data-act="zero" data-age="${k}">${I("archive", "xs glyph")}${l}</button>`).join("")}<div class="note">Everything goes to Archive; z brings it back.</div></div>`;
  if (o === "link") { const q = (V.popq || "").toLowerCase(); const items = [["task", "Confirm Acme pilot week", "Task · Thu"], ["task", "Send the security answers", "Task · Fri"], ["user", "Jonas Weber", "Contact · Acme"], ["notes", "Acme: Weekly sync, week 44", "Note"], ["folder", "Acme rollout", "Project"]].filter((x) => !q || x[1].toLowerCase().includes(q)); return `<div class="float" id="pop" role="dialog" aria-label="Link to a task, contact or note" style="min-width:20rem"><div class="field sm">${I("link", "glyph")}<input id="pop-q" placeholder="Link to a task, contact, note or project" aria-label="Link to" value="${esc(V.popq || "")}"></div>${items.map((x, i) => `<button class="mi" type="button" data-act="linkTo" data-title="${esc(x[1])}" data-kind="${x[0]}" data-active="${i === 0}">${I(x[0], "xs glyph")}<span class="trunc">${esc(x[1])}</span><span class="hint">${t && ((t.task && t.task.title === x[1]) || t.links.some((l) => l.title === x[1])) ? "Linked" : x[2]}</span></button>`).join("") || `<div class="note">Nothing matches.</div>`}</div>`; }
  if (o === "sortmenu") return `<div class="float" id="pop" role="menu" aria-label="Sort this sender"><div class="mh eyebrow">Always put ${t ? esc(who(t).name) : "this sender"} in</div>${Object.entries(KINDS).map(([k, l]) => `<button class="mi" type="button" role="menuitemradio" aria-checked="${t && t.kind === k}" data-act="sortTo" data-kind="${k}">${I(t && t.kind === k ? "check" : "dash", "xs glyph")}${l}</button>`).join("")}</div>`;
  if (o === "viewmenu") return `<div class="float" id="pop" role="menu" aria-label="Panel view">${VIEWS.map((v, i) => `<button class="mi" type="button" role="menuitemradio" aria-checked="${V.panel === v[0]}" data-act="panel" data-panel="${v[0]}">${I(v[2], "xs glyph")}${v[1]}<span class="kbd">⌥${i + 1}</span></button>`).join("")}</div>`;
  if (o === "frommenu") { const curAcc = V.compose.acc || "work"; const cur = V.compose.alias || ACCOUNTS[curAcc].address; return `<div class="float" id="pop" role="menu" aria-label="Send from" style="min-width:20rem"><div class="mh eyebrow">Send from</div>${Object.values(ACCOUNTS).flatMap((a) => (a.aliases || [[a.address, "", true]]).map(([addr, sig, def]) => `<button class="mi two" type="button" role="menuitemradio" aria-checked="${cur === addr}" data-act="fromAcc" data-acc="${a.id}" data-alias="${esc(addr)}">${accDot(a.id)}<span class="mi-tx"><span class="trunc">${esc(addr)}</span><small class="trunc">Signs “${esc(sig)}”${def ? ` · default for ${esc(a.label)}` : ""}</small></span>${cur === addr ? I("check", "xs glyph") : ""}</button>`)).join("")}<div class="msep"></div><button class="mi" type="button" role="menuitem" data-act="noop">${I("settings", "xs glyph")}Aliases and signatures…<span class="hint">Settings</span></button></div>`; }
  if (o === "palette") return `<div class="scrim" data-act="close"></div><div class="palette" role="dialog" aria-label="Search and commands"><div class="field">${I("search", "md glyph")}${V.mailChip ? `<button class="chip btn-chip" type="button" data-act="mailchip">${I("mail", "xs glyph")}Email${I("x", "xs")}</button>` : ""}<input id="pal-q" placeholder="${V.mailChip ? "Search mail: from: subject: has:attachment is:unread" : "Search, or type a command"}" aria-label="Search mail or type a command" value="${esc(V.popq || "")}"></div>${paletteBody()}</div>`;
  if (o === "keys") return `<div class="scrim" data-act="close"></div><div class="dialog keys-sheet" role="dialog" aria-labelledby="keys-h"><h3 id="keys-h">Mail keys</h3><p class="desc">Triage without the mouse. Every key is also in ⌘K and in the tooltip of its button.</p><button class="ib x" type="button" aria-label="Close" data-act="close">${I("x")}</button><div class="keys-grid">${keysGrid()}</div></div>`;
  if (o === "connect") return connectDialog();
  if (o === "acctpop") return acctPop();
  if (o === "tabsmore") return `<div class="float" id="pop" role="menu" aria-label="All inbox tabs">${TABS.map((k) => { const n = DB.threads.filter((x) => inPlace(x, "inbox") && x.kind === k && !x.read && (!V.scope || x.acc === V.scope)).length; return `<button class="mi" type="button" role="menuitemradio" aria-checked="${V.tab === k}" data-act="tab" data-tab="${k}">${I(V.tab === k ? "check" : "dash", "xs glyph")}${KINDS[k]}${n ? `<span class="hint">${n}<span class="sr"> unread</span></span>` : ""}</button>`; }).join("")}<div class="msep"></div><button class="mi" type="button" role="menuitem" data-act="noop">${I("settings", "xs glyph")}Custom tabs…<span class="hint">Settings</span></button><div class="note"><span class="kbd">[</span> <span class="kbd">]</span> move between tabs.</div></div>`;
  if (o === "why") return whyPop();
  if (o === "rule") return ruleDialog();
  return "";
}
function keysGrid() {
  const g = [["Move around", [["Next · previous thread", "j k"], ["Next · previous tab", "] ["], ["Into the thread", "↵"], ["Older messages", "o"], ["Inbox · Follow-ups · Snoozed", "gi gf gs"], ["Archive · Sent · Drafts", "ga gt gd"]]],
    ["Triage", [["Done · not done", "e ⇧e"], ["Snooze", "s"], ["Make a task", "t"], ["Link to a task, contact or note", "l"], ["Private note", "n"], ["Remind me if no reply", "w"], ["Pin · unread", "p u"], ["Move · delete", "m # ⌫"], ["Undo · redo", "⌘Z ⇧⌘Z"]]],
    ["Select", [["Select", "x"], ["Extend down · up", "⇧j ⇧k"], ["All in tab", "⌘a"], ["Clear", "Esc"]]],
    ["Write", [["Reply · reply all · forward", "r a f"], ["New message", "c"], ["Send", "⌘↵"], ["Snippet", ";;"], ["Close, keep the draft", "Esc"]]],
    ["Connect", [["Today · Contact · Task", "⌥1 ⌥2 ⌥3"], ["Drag a thread onto Today or a task", "⇢"]]],
    ["More", [["Search mail", "/"], ["Everything, with its key", "⌘K"], ["Mail keys", "?"]]]];
  return g.map(([h, rows]) => `<div><h4>${h}</h4>${rows.map(([a, k]) => `<div class="key-row"><span>${a}</span><span class="ks">${k.split(" ").map((x) => `<span class="kbd">${x}</span>`).join("")}</span></div>`).join("")}</div>`).join("");
}
function parseQ(q) { const ops = {}; const words = []; for (const w of q.split(/\s+/).filter(Boolean)) { const m = /^(from|to|subject|has|is|in):(.+)$/i.exec(w); if (m) ops[m[1].toLowerCase()] = m[2].toLowerCase(); else words.push(w.toLowerCase()); } return { ops, words }; }
function mailHits(q) {
  const { ops, words } = parseQ(q);
  const seen = new Set();
  return DB.threads.filter((t) => !t.screened).filter((t) => {
    const p = who(t); const hay = [t.subject, t.snippet, p.name, p.email, p.company || ""].join(" ").toLowerCase();
    if (ops.from && !(p.name + " " + p.email + " " + (p.company || "")).toLowerCase().includes(ops.from)) return false;
    if (ops.subject && !t.subject.toLowerCase().includes(ops.subject)) return false;
    if (ops.has === "attachment" && !t.att.length) return false;
    if (ops.is === "unread" && t.read) return false;
    if (ops.is === "pinned" && !t.pinned) return false;
    return words.every((w) => hay.includes(w));
  }).sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).filter((t) => { const k = t.subject.replace(/^(re|fwd?):\s*/i, "").toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
function paletteBody() {
  const q = V.popq || ""; const ql = q.toLowerCase(); const t = sel();
  if (V.mailChip) {
    const last = q.split(/\s+/).pop() || "";
    const opsSug = ["from:", "to:", "subject:", "has:attachment", "is:unread", "is:pinned", "in:archive", "before:", "after:"].filter((o) => last && o.startsWith(last.toLowerCase()) && o !== last.toLowerCase());
    const hits = q.trim() ? mailHits(q).slice(0, 6) : DB.threads.filter((x) => inPlace(x, "inbox")).slice(0, 4);
    const sug = opsSug.length ? `<div class="grp"><div class="gh eyebrow">Operators</div>${opsSug.map((o) => `<button class="mi" type="button" data-act="op" data-op="${o}">${I("search", "xs glyph")}<span class="mono">${o}</span></button>`).join("")}</div>` : "";
    const rows = hits.map((x, i) => `<button class="mi" type="button" data-act="open" data-id="${x.id}" data-active="${i === 0}">${avatar(who(x), "sm")}<span class="trunc"><b style="font-weight:500">${esc(x.subject)}</b> <span class="muted">— ${esc(who(x).name)}</span></span><span class="hint">${fmtTime(x.when)}</span></button>`).join("");
    const older = Object.values(ACCOUNTS).map((a) => { const st = (V.server || {})[a.id]; return `<button class="mi" type="button" data-act="server" data-acc="${a.id}">${I(st === "busy" ? "sync" : "download", "xs glyph")}Search older mail on ${esc(a.address)}${st === "busy" ? " (searching…)" : st === "done" ? " · 3 more found" : ""}</button>`; }).join("");
    return `${sug}<div class="grp"><div class="gh eyebrow">${q.trim() ? `Mail · ${mailHits(q).length} on this Mac` : "Recent mail"}</div>${rows || `<div class="note">Nothing on this Mac matches. Older mail may still be on the server.</div>`}</div>${q.trim() ? `<div class="grp"><div class="gh eyebrow">Beyond this Mac</div>${older}<button class="mi" type="button" data-act="savesearch">${I("plus", "xs glyph")}Save this search to Mail</button></div>` : `<div class="note">Try from:jonas has:attachment, or is:unread. Enter opens the thread with the triage keys live.</div>`}`;
  }
  const cmds = [
    ["This conversation", [["check", "Done", "e", "done"], ["clock", "Snooze…", "s", "snooze"], ["task", "Make a task", "t", "task"], ["link", "Link to…", "l", "link"], ["notes", "Private note", "n", "note"], ["wait", "Remind me if no reply…", "w", "wait"], ["reply", "Reply", "r", "reply"], ["move", "Move to…", "m", "move"]]],
    ["Go to", PLACES.filter((p) => p.key).map((p) => [p.icon, p.label, p.key, "place:" + p.id])],
    ["Mail", [["pen", "New message", "c", "new"], ["search", "Search mail", "/", "search"], ["plus", "Connect an account", "", "connect"], ["key", "Mail keys", "?", "keys"]]],
  ];
  let first = true; return cmds.map(([h, rows]) => { const hits = rows.filter((r) => !ql || r[1].toLowerCase().includes(ql)); return hits.length ? `<div class="grp"><div class="gh eyebrow">${h}</div>${hits.map((r) => `<button class="mi" type="button" data-act="cmd" data-cmd="${r[3]}" data-active="${first ? (first = false, true) : false}">${I(r[0], "xs glyph")}${r[1]}${r[2] ? `<span class="ks" style="margin-left:auto;display:flex;gap:.125rem">${r[2].split(" ").map((x) => `<span class="kbd">${x}</span>`).join("")}</span>` : ""}</button>`).join("")}</div>` : ""; }).join("");
}
function connectDialog() {
  const c = V.connect || { prov: "gmail" };
  const close = `<button class="ib x" type="button" aria-label="Close" data-act="close">${I("x")}</button>`;
  if (c.reconnect) return `<div class="scrim" data-act="close"></div><div class="dialog" role="dialog" aria-labelledby="cn-h"><h3 id="cn-h">Sign in to ${esc(accLabel(c.reconnect))} again</h3><p class="desc">The saved app password stopped working. Enter a new one; it stays in your Mac's keychain.</p>${close}<div class="frow"><label for="cn-pw">App password</label><div class="field"><input id="cn-pw" type="password" autocomplete="off" aria-describedby="cn-hint"></div><span class="hint" id="cn-hint">Make one at appleid.apple.com, under Sign-in and security.</span></div><div class="dfoot"><button class="btn secondary" type="button" data-act="close">Cancel</button><button class="btn primary" type="button" data-act="connected">Reconnect</button></div></div>`;
  const prov = c.prov;
  const seg = `<div class="seg" role="radiogroup" aria-label="Provider" id="prov-seg">${[["gmail", "Gmail"], ["microsoft", "Microsoft"], ["icloud", "iCloud"], ["imap", "Other IMAP"]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${prov === k}" tabindex="${prov === k ? 0 : -1}" data-act="prov" data-prov="${k}">${l}</button>`).join("")}</div>`;
  const oauth = prov === "gmail" || prov === "microsoft";
  const signIn = oauth ? `<div style="margin-top:1rem;display:grid;gap:.375rem"><button class="btn primary" type="button" data-act="connected" style="width:100%">Sign in with ${prov === "gmail" ? "Google" : "Microsoft"}</button><span class="hint" style="font-size:var(--text-2xs);color:var(--subtle-foreground)">${prov === "gmail" ? "Works for Gmail and Google Workspace. Google may ask you to approve Moduo again every 7 days." : "Works for Outlook.com and Microsoft 365. Some organisations need their admin to allow Moduo once; the error will say so."}</span></div>` : "";
  const pwOpen = !oauth || c.pw;
  const pwFields = prov === "imap"
    ? `<div class="frow"><label for="cn-email">Email address</label><div class="field"><input id="cn-email" type="email" autocomplete="off"></div></div><div class="frow"><label for="cn-pw">Password</label><div class="field"><input id="cn-pw" type="password"></div></div><div style="display:grid;grid-template-columns:1fr 5rem;gap:.5rem"><div class="frow"><label for="cn-imap">IMAP host</label><div class="field"><input id="cn-imap" placeholder="imap.example.com"></div></div><div class="frow"><label for="cn-imap-port">Port</label><div class="field"><input id="cn-imap-port" value="993"></div></div><div class="frow"><label for="cn-smtp">SMTP host</label><div class="field"><input id="cn-smtp" placeholder="smtp.example.com"></div></div><div class="frow"><label for="cn-smtp-port">Port</label><div class="field"><input id="cn-smtp-port" value="587"></div></div></div>`
    : `<div class="frow"><label for="cn-email">Email address</label><div class="field"><input id="cn-email" type="email" autocomplete="off" placeholder="${prov === "icloud" ? "you@icloud.com" : "you@gmail.com"}"></div></div><div class="frow"><label for="cn-pw">App password</label><div class="field"><input id="cn-pw" type="password" autocomplete="off" aria-describedby="cn-hint"></div><span class="hint" id="cn-hint">${prov === "icloud" ? "Make one at appleid.apple.com, under Sign-in and security." : "Needs 2-Step Verification on your Google account."}</span></div>`;
  const pw = oauth ? (pwOpen ? `<div class="or">or use an app password</div>${pwFields}` : `<button class="btn xs ghost" type="button" data-act="pwopen" style="margin-top:.75rem">Use an app password instead</button>`) : pwFields;
  const showGo = pwOpen;
  return `<div class="scrim" data-act="close"></div><div class="dialog" role="dialog" aria-labelledby="cn-h"><h3 id="cn-h">Connect an account</h3><p class="desc">Mail stays on this Mac. Passwords stay in your Mac's keychain.</p>${close}${seg}${signIn}${pw}<div class="frow" style="margin-top:1rem"><div style="display:flex;align-items:center;gap:.5rem;font-size:var(--text-sm);white-space:nowrap"><span>Inbox history</span><button class="sel" type="button" data-act="noop" aria-label="Inbox history, 12 months">12 months${I("chevD", "xs")}</button></div><span class="hint">The newest mail first; older mail fills in with a progress bar you can cancel.</span></div>${showGo ? `<div class="dfoot"><button class="btn secondary" type="button" data-act="close">Cancel</button><button class="btn primary" type="button" data-act="connected" id="cn-go" ${c.ok ? "" : "disabled"}>Connect</button></div><p class="hint" id="cn-why" style="margin:.375rem 0 0;text-align:right;font-size:var(--text-2xs);color:var(--subtle-foreground)">${c.ok ? "Checked against the server when you connect." : "Fill in the address and the password to connect."}</p>` : ""}</div>`;
}
function toastHTML() {
  const t = V.toast; if (!t) return "";
  return `<div class="toast" role="status" id="toast">${t.icon ? I(t.icon, "xs glyph") : ""}<span class="sp">${t.text}</span>${t.extra ? `<button class="btn xs ghost" type="button" data-act="${t.extra.act}">${esc(t.extra.label)}</button>` : ""}${t.undo ? `<button class="btn xs secondary" type="button" data-act="undo">Undo<span class="kbd" aria-hidden="true">⌘Z</span></button>` : ""}</div>`;
}

/* scroll only inside the pane that holds el, never the window */
function reveal(el, block) { if (!el) return; const sc = el.closest(".scroll"); if (!sc) return; const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect(); if (block === "center") sc.scrollTop += r.top - b.top - (b.height - r.height) / 2; else if (block === "end") sc.scrollTop += r.bottom - b.bottom; else if (r.top < b.top) sc.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) sc.scrollTop += r.bottom - b.bottom; }
/* anchored floats */
function rel(el) { const a = app.getBoundingClientRect(); const r = el.getBoundingClientRect(); return { x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height }; }
function place() {
  const pop = document.getElementById("pop"); if (!pop) return;
  let anchor = null; let r = V.anchorRect;
  if (!r) { anchor = (V.sel && app.querySelector(`.row[data-id="${CSS.escape(V.sel)}"] .rowbtn`)) || app.querySelector("#rd-bar") || app; r = rel(anchor); }
  const pw = pop.offsetWidth; const ph = pop.offsetHeight; const aw = app.clientWidth; const ah = app.clientHeight;
  let x = r.x, y = r.y + r.h + 4, origin = "top left";
  if (x + pw > aw - 8) x = aw - pw - 8; if (x < 8) x = 8;
  if (y + ph > ah - 8) { y = r.y - ph - 4; origin = "bottom left"; }
  if (y < 8) y = 8;
  pop.style.left = x + "px"; pop.style.top = y + "px"; pop.style.setProperty("--origin", origin);
}
function focusAfterRender() {
  const pq = document.getElementById("pop-q") || document.getElementById("pal-q");
  if (pq) { pq.focus({ preventScroll: true }); pq.setSelectionRange(pq.value.length, pq.value.length); return; }
  if (V.overlay === "connect") { const f = document.getElementById(V.connect && V.connect.reconnect ? "cn-pw" : "cn-email") || app.querySelector('[role="radio"][aria-checked="true"]'); if (f) f.focus({ preventScroll: true }); return; }
  if (V.overlay === "keys") { const b = app.querySelector(".keys-sheet .x"); if (b) b.focus({ preventScroll: true }); return; }
  if (V.overlay && V.overlay !== "palette") { const first = app.querySelector("#pop .mi[data-active='true'], #pop .mi"); if (first) first.focus({ preventScroll: true }); return; }
  if (V.focusTo) { const el = app.querySelector(V.focusTo); V.focusTo = null; if (el) { if (el.id === "c-body") { el.focus({ preventScroll: true }); const r = document.createRange(); r.selectNodeContents(el.firstElementChild || el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } else { el.focus({ preventScroll: true }); if (el.setSelectionRange && el.value != null) el.setSelectionRange(el.value.length, el.value.length); } } return; }
  if (V.focusRow) { V.focusRow = false; const r = app.querySelector(`.row[data-selected="true"] .rowbtn`); if (r) { r.focus({ preventScroll: true }); reveal(r.closest(".row"), "nearest"); } }
}

/* ── round 5: account status, why-here, rules ────────────────────────────────────────────── */
function acctPop() {
  const a = ACCOUNTS[V.acctId || "work"]; const h = a.health; const st = V.accounts[a.id] || (V.failed && a.id === "studio" ? "error" : "ok");
  const off = V.net === "offline";
  const status = st === "reauth" ? ["alert", "warn", "Needs you to sign in again", `${a.label}'s server refused the saved password on ${a.lastSync}. New mail for this account is paused; the others keep syncing.`]
    : st === "error" ? ["alert", "warn", "Can't sync", "The server refused the last two rounds. Moduo retries every minute."]
    : off ? ["offline", "", "Offline", "Reading works from this Mac. Changes wait and sync when you're back."]
    : V.backfill === a.id ? ["sync", "", "Syncing history · 40%", "The newest mail is ready; older mail fills in behind it."]
    : ["check", "ok", "Up to date", h.push ? "New mail arrives the moment it lands." : "This server has no push, so Moduo checks every minute."];
  const used = h.mail + h.files; const pct = Math.min(100, Math.round((used / h.cap) * 100));
  return `<div class="float acct-pop" id="pop" role="dialog" aria-labelledby="ap-h" style="min-width:20rem;max-width:22rem">
    <div class="ap-head">${accDot(a.id)}<div><h3 id="ap-h">${esc(a.label)}</h3><small>${esc(a.address)} · ${esc(h.kind)}</small></div></div>
    <div class="ap-status ${status[1]}" role="status">${I(status[0], "xs glyph")}<div><b>${status[2]}</b><small>${status[3]}</small></div></div>
    ${st === "reauth" ? `<button class="btn sm primary" type="button" data-act="reconnect" data-acc="${a.id}" style="width:100%">Sign in again</button>` : ""}
    ${h.reapprove && st === "ok" ? `<p class="ap-note">${I("clock", "xs glyph")}<span>Google asks you to approve Moduo again every 7 days while Moduo's Google app is in testing. Next time: ${esc(h.reapprove)}.</span></p>` : ""}
    <dl class="ap-facts">
      <div><dt>History on this Mac</dt><dd>${esc(h.depth)}<button class="btn xs ghost" type="button" data-act="noop">Change</button></dd></div>
      <div><dt>Storage on this Mac</dt><dd><span>Mail ${h.mail.toFixed(1)} GB · attachments ${h.files.toFixed(1)} GB of ${h.cap} GB</span></dd></div>
      <div class="ap-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div><dt>Sign-in</dt><dd>${esc(h.signin)}</dd></div>
    </dl>
    <p class="ap-quiet">Mail stays on this Mac. History depth and storage are this Mac's; each device keeps its own.</p>
    <div class="ap-foot"><button class="btn xs secondary" type="button" data-act="sync" ${off || st === "reauth" ? "disabled" : ""}>${I("refresh", "xs")}Sync now</button><span class="sp"></span><button class="btn xs ghost" type="button" data-act="noop">${I("settings", "xs")}Account settings</button></div>
  </div>`;
}
function whyOf(t) {
  const p = who(t);
  if (WHY[t.from]) return WHY[t.from];
  if (WHY[t.counterpart]) return WHY[t.counterpart];
  if (t.kind === "reading") return { by: "headers", text: `${p.name} sends with an unsubscribe header, so it reads as a newsletter.`, step: 6 };
  if (p.contact) return { by: "contact", text: `${p.name} is in your contacts.`, step: 5 };
  return { by: "headers", text: `${p.name} wrote to you personally; nothing marks it as automated.`, step: 6 };
}
function whyPop() {
  const t = sel(); if (!t) return ""; const p = who(t); const w = whyOf(t);
  return `<div class="float why-pop" id="pop" role="dialog" aria-labelledby="why-h" style="min-width:21rem;max-width:23rem">
    <h3 id="why-h">Why this is in ${KINDS[t.kind]}</h3>
    <p class="why-main">${I(w.by === "rule" ? "filter" : w.by === "contact" ? "user" : w.by === "sender" ? "check" : "mail", "xs glyph")}<span>${esc(w.text)}</span></p>
    <ol class="why-steps" aria-label="The order Moduo checks">${WHY_STEPS.map((s, i) => `<li data-hit="${i + 1 === w.step}" data-past="${i + 1 < w.step}">${esc(s)}${i + 1 === w.step ? `<span class="sr"> (this decided it)</span>` : ""}</li>`).join("")}</ol>
    <div class="msep"></div>
    <div class="mh eyebrow">Always put ${esc(p.name)} in</div>
    <div role="radiogroup" aria-label="Always put ${esc(p.name)} in" class="why-seg">${TABS.map((k) => `<button type="button" role="radio" aria-checked="${t.kind === k}" data-act="sortTo" data-kind="${k}">${KINDS[k]}</button>`).join("")}</div>
    <div class="why-foot">${w.by === "rule" ? `<button class="btn xs ghost" type="button" data-act="rule" data-edit="1">${I("pen", "xs")}Edit the rule</button>` : `<button class="btn xs ghost" type="button" data-act="rule">${I("filter", "xs")}Make a rule…</button>`}<span class="sp"></span><span class="ap-quiet">Applies to new and existing mail.</span></div>
  </div>`;
}
function ruleDialog() {
  const t = sel(); const p = t ? who(t) : P("stripe"); const dom = p.email.split("@")[1];
  const n = DB.threads.filter((x) => P(x.from).email.endsWith("@" + dom) || x.from === (t && t.from)).length;
  const r = V.rule || { cond: "domain", tab: "updates", label: "Receipts", read: false, apply: true };
  const condV = r.cond === "domain" ? dom : p.email;
  return `<div class="scrim" data-act="close"></div><div class="dialog rule-dlg" role="dialog" aria-labelledby="rule-h"><h3 id="rule-h">${V.ruleEdit ? "Edit rule" : "New rule"}</h3><p class="desc">Runs on new mail the moment it arrives, on this Mac and every Mac you use.</p><button class="ib x" type="button" aria-label="Close" data-act="close">${I("x")}</button>
    <div class="rule-grid">
      <span class="rl">When</span><div class="rr"><button class="sel" type="button" data-act="ruleCond" aria-label="Condition: ${r.cond === "domain" ? "domain" : "from"}">${r.cond === "domain" ? "Domain" : "From"}${I("chevD", "xs")}</button><div class="field sm"><input aria-label="Condition value" value="${esc(condV)}"></div></div>
      <span class="rl">Then</span><div class="rr col">
        <div class="ract"><span>Put in tab</span><div class="seg sm" role="radiogroup" aria-label="Put in tab">${TABS.map((k) => `<button type="button" role="radio" aria-checked="${r.tab === k}" data-act="ruleTab" data-kind="${k}">${KINDS[k]}</button>`).join("")}</div></div>
        <div class="ract"><span>Label</span><div class="field sm"><input aria-label="Label" value="${esc(r.label)}"></div></div>
        <label class="ract chk"><input type="checkbox" ${r.read ? "checked" : ""} data-act="ruleRead"> Mark read</label>
      </div>
    </div>
    <label class="rule-apply"><input type="checkbox" ${r.apply ? "checked" : ""} data-act="ruleApply"> Also apply to the ${n} conversation${n === 1 ? "" : "s"} already on this Mac</label>
    <p class="ap-quiet">The first matching rule decides where mail goes; marking read, labels and Priority all apply. Reorder rules in Settings → Mail.</p>
    <div class="dfoot"><button class="btn secondary" type="button" data-act="close">Cancel</button><button class="btn primary" type="button" data-act="ruleSave">Save rule</button></div></div>`;
}
function bodyPending(t, m) {
  const p = P(m.from); const off = V.net === "offline";
  return `<article class="msg open" aria-label="Message from ${esc(p.name)}"><div class="msg-h">${avatar(p)}<div class="hd"><div class="nm">${esc(p.name)} <span>${esc(p.email)}</span></div><div class="to">to Robin</div></div><span class="t" style="font-size:var(--text-xs);color:var(--muted-foreground);white-space:nowrap">${fmtFull(m.when)}</span></div>
    <div class="msg-b"><p class="pend-snip">${esc(t.snippet)}</p><div class="pending ${off ? "off" : ""}" role="status">${I(off ? "offline" : "download", "xs glyph")}<div><b>${off ? "Available when you're back online" : "Downloading the rest of this message…"}</b><small>${off ? "This Mac has the headers and the first lines. The full message downloads the moment you're connected." : "Older mail keeps only its first lines on this Mac until you open it."}</small></div></div>${(m.att || []).length ? `<div class="atts">${m.att.map((a) => `<span class="att pend"><span class="ft" aria-hidden="true">${esc(a.split(".").pop().toUpperCase().slice(0, 4))}</span><span class="trunc">${esc(a)}</span><span class="sz">${off ? "when online" : "on open"}</span></span>`).join("")}</div>` : ""}</div></article>`;
}
function sendNote(t) {
  if (t.place === "outbox") { const off = V.net === "offline"; return `<div class="send-note" role="status">${I(off ? "offline" : "send", "xs glyph")}<div><b>${off ? "Waiting for connection" : V.sending ? "Sending…" : "Sends in 4 s"}</b><small>${off ? "You sent it at 10:38. It waits in Outbox on this Mac and goes out on its own when you're back online." : "Edit pulls it back into Drafts before it leaves."}</small></div><div class="acts"><button class="btn xs ghost" type="button" data-act="editOutbox">${I("pen", "xs")}Edit</button></div></div>`; }
  if (t.sendFailed) return `<div class="send-note warn" role="alert">${I("alert", "xs glyph")}<div><b>Not sent: ${esc(t.sendFailed)}</b><small>Moduo put it back in Drafts at ${esc(t.failedAt || "10:39")} with everything you wrote.</small></div><div class="acts"><button class="btn xs secondary" type="button" data-act="fixFailed">${I("pen", "xs")}Fix and send</button></div></div>`;
  return "";
}
