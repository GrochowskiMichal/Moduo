
/* ── actions ──────────────────────────────────────────────────────────────────────────── */
let toastTimer = 0; let hintTimer = 0; let lastInput = "key";
function hint(text, key) { V.hint = lastInput === "pointer" && key ? `${text}. Next time press <span class="kbd">${key}</span>` : `${text} · <span class="kbd">⌘Z</span> undoes`; clearTimeout(hintTimer); hintTimer = setTimeout(() => { V.hint = null; const h = app.querySelector(".hintline"); if (h) h.innerHTML = ""; }, 4000); }
function go(patch) { V = { ...V, overlay: null, anchorRect: null, popq: "", ...patch }; render(); }
function toast(text, opts = {}) {
  V.toast = { text, ...opts };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (V.toast && V.toast.text === text) { V.toast = null; const el = document.getElementById("toast"); if (el) el.remove(); } }, opts.ms || 8000);
}
const targets = () => (V.checked.length ? V.checked.map(T).filter(Boolean) : sel() ? [sel()] : []);
const first = (p) => p.name.split(" ")[0];
function snapshot(ts) { const selBefore = V.sel; const placeBefore = V.place; const saved = ts.map((t) => ({ t, s: { state: t.state, back: t.back, place: t.place, folder: t.folder, snoozeUntil: t.snoozeUntil, waitBy: t.waitBy, waitDue: t.waitDue, task: t.task, kind: t.kind, read: t.read, pinned: t.pinned, counterpart: t.counterpart, msgs: t.msgs, when: t.when } })); return () => { for (const { t, s } of saved) Object.assign(t, s); if (ts.length === 1 && V.place === placeBefore) V.sel = selBefore; }; }
/* after rows leave the view, the next row is selected (act and advance) */
function advance(before, ids) {
  const i = before.findIndex((t) => t.id === V.sel);
  const after = flatRows();
  if (V.sel && after.some((t) => t.id === V.sel) && !ids.includes(V.sel)) return;
  const next = after[Math.min(i, after.length - 1)] || after[after.length - 1] || null;
  V.sel = next ? next.id : null; V.checked = []; V.focusRow = true;
}
function offlineNote() { if (V.net === "offline") DB.pending++; }
function act(name, data = {}) {
  const t = sel(); const ts = targets(); const before = flatRows();
  const n = ts.length; const many = n > 1 ? `${n} threads` : "";
  const anchorFrom = (el) => { if (el) V.anchorRect = rel(el); };
  switch (name) {
    case "noop": return;
    case "acctpop": { anchorFrom(data.el); return go({ overlay: "acctpop", acctId: data.acc, anchorRect: V.anchorRect }); }
    case "why": { if (!t) return; const b = app.querySelector('[data-act="why"]') || app.querySelector('.rd-bar [data-act="more"]'); anchorFrom(data.el && data.el.closest(".float") ? b : data.el || b); return go({ overlay: "why", anchorRect: V.anchorRect }); }
    case "rule": return go({ overlay: "rule", ruleEdit: !!data.edit, rule: V.rule || { cond: "domain", tab: t ? (t.kind === "people" ? "updates" : t.kind) : "updates", label: t && t.from === "stripe" ? "Receipts" : "", read: false, apply: true } });
    case "ruleTab": return go({ overlay: "rule", rule: { ...V.rule, tab: data.kind } });
    case "ruleCond": return go({ overlay: "rule", rule: { ...V.rule, cond: V.rule.cond === "domain" ? "from" : "domain" } });
    case "ruleRead": V.rule.read = !V.rule.read; return;
    case "ruleApply": V.rule.apply = !V.rule.apply; return;
    case "ruleSave": { const r = V.rule; let moved = 0; if (r.apply && t) { const dom = who(t).email.split("@")[1]; for (const x of DB.threads) if (P(x.from).email.endsWith("@" + dom) && x.kind !== r.tab) { x.kind = r.tab; moved++; } } toast(`Rule saved${moved ? ` · ${moved} moved to ${KINDS[r.tab]}` : ""}`, { icon: "filter" }); return go({ rule: null }); }
    case "snipPick": { const c = V.compose; const s = SNIPPETS.find((x) => x[0] === data.k); const first = c.to && c.to[0] ? P(c.to[0]).name.split(" ")[0] : ""; c.text = (c.text || "").replace(/;;\w*$/, "") + s[2].replace("{first name}", first); c.snip = null; return go({ compose: c, focusTo: "#c-body" }); }
    case "rmatt": { const c = V.compose; c.att = (c.att || []).filter((a) => a[0] !== data.name); return go({ compose: c }); }
    case "introBcc": { const c = V.compose; c.introDone = true; c.to = (c.to || []).filter((k) => k !== c.introducer); c.text = `Thanks ${P(c.introducer).name.split(" ")[0]} (moving you to Bcc).

` + (c.text || ""); return go({ compose: c, focusTo: "#c-body" }); }
    case "editOutbox": { if (!t) return; t.place = "drafts"; V.outbox = Math.max(0, V.outbox - 1); toast("Back in Drafts · it won't send until you send it again", { icon: "draft" }); return go({ place: "drafts", sel: t.id, compose: { mode: "new", to: [t.counterpart], cc: [], subject: t.subject, acc: t.acc, saved: "local", text: t.snippet.replace(/^You: /, "") } }); }
    case "fixFailed": { if (!t) return; return go({ compose: { mode: "new", to: [t.counterpart], cc: [], subject: t.subject, acc: t.acc, saved: "server", text: t.snippet, fixAddr: true } }); }
    case "awayOk": return go({ away: 0 });
    case "failedOpen": return go({ failedOpen: !V.failedOpen });
    case "mute": { if (!n) return; for (const x of ts) x.muted = !x.muted; hint(ts[0].muted ? "Muted: new replies skip the inbox" : "Unmuted"); return go({}); }
    case "spam": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) { x.state = "deleted"; x.place = "spam"; } hint(many ? `${many} reported as spam` : "Reported as spam · in Spam"); advance(before, ts.map((x) => x.id)); return go({}); }
    case "done": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) { x.state = "done"; x.doneAt = NOW.toISOString(); x.back = false; } offlineNote(); V.cleared = (V.cleared || 0) + n; hint(many ? `${many} done, in Archive` : "Done, in Archive", "e"); advance(before, ts.map((x) => x.id)); return go({ compose: null }); }
    case "undone": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) x.state = "open"; hint("Back in your inbox", "⇧e"); advance(before, ts.map((x) => x.id)); return go({}); }
    case "snooze": { if (!n) return; anchorFrom(data.el); return go({ overlay: "snooze", anchorRect: V.anchorRect }); }
    case "snoozeTo": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) { x.state = "snoozed"; x.snoozeUntil = data.iso; x.back = false; } offlineNote(); hint(`${many ? many + " s" : "S"}noozed until ${fmtUntil(data.iso)}`, "s"); advance(before, ts.map((x) => x.id)); return go({}); }
    case "wait": { if (!n) return; anchorFrom(data.el); return go({ overlay: "wait", anchorRect: V.anchorRect }); }
    case "waitTo": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) { x.state = "waiting"; x.waitBy = data.iso; x.waitDue = false; x.back = false; if (!x.counterpart) x.counterpart = x.from; } offlineNote(); const w = ts[0]; hint(many ? `${many} in Follow-ups · reminds ${fmtUntil(data.iso)}` : `In Follow-ups · reminds you ${fmtUntil(data.iso)} if ${first(who(w))} doesn't reply`, "w"); advance(before, ts.map((x) => x.id)); return go({ waitRegardless: false }); }
    case "waitMode": return go({ overlay: "wait", anchorRect: V.anchorRect, waitRegardless: data.mode === "always" });
    case "unwait": { if (!t) return; DB.undo = snapshot([t]); t.state = "open"; t.waitDue = false; toast("Stopped waiting · back in your inbox", { undo: true }); advance(before, [t.id]); return go({}); }
    case "task": { if (!n) return; DB.undo = snapshot(ts); let made = 0; for (const x of ts) { if (x.task) continue; x.task = { title: x.subject.replace(/^(re|fwd?|aw|wg):\s*/i, "").replace(/^(re|fwd?):\s*/i, ""), due: null }; const p = who(x); if (p.contact) p.openTasks = (p.openTasks || 0) + 1; made++; } if (!made) return go({ panel: "task" }); offlineNote(); toast(made > 1 ? `${made} tasks created` : "Task created", { undo: true, icon: "task", extra: { label: "Also done", act: "alsodone" } }); return go({ panel: "task", checked: [] }); }
    case "alsodone": { if (!t) return; t.state = "done"; t.doneAt = NOW.toISOString(); t.back = false; toast("Done · the task keeps the thread", { undo: true, icon: "check" }); advance(before, [t.id]); return go({}); }
    case "pin": { if (!n) return; for (const x of ts) x.pinned = !x.pinned; return go({}); }
    case "unread": { if (!n) return; for (const x of ts) x.read = !x.read; return go({}); }
    case "delete": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) { x.state = "deleted"; x.place = "trash"; } offlineNote(); toast(many ? `${many} deleted` : "Deleted", { undo: true, icon: "trash" }); advance(before, ts.map((x) => x.id)); return go({ compose: null }); }
    case "move": { if (!n) return; anchorFrom(data.el); return go({ overlay: "move", anchorRect: V.anchorRect }); }
    case "moveTo": { if (!n) return; DB.undo = snapshot(ts); for (const x of ts) { if (data.folder === "Trash") { x.state = "deleted"; x.place = "trash"; } else if (data.folder === "Archive") { x.state = "done"; x.doneAt = NOW.toISOString(); } else { x.place = "folder"; x.folder = data.folder; x.state = "open"; } x.back = false; } offlineNote(); hint(`${many ? many + " m" : "M"}oved to ${data.folder}`, "m"); advance(before, ts.map((x) => x.id)); return go({}); }
    case "sortTo": { if (!t) return; const k = t.from; const same = DB.threads.filter((x) => x.from === k); DB.undo = snapshot(same); for (const x of same) x.kind = data.kind; toast(`${who(t).name} now lands in ${KINDS[data.kind]}`, { undo: true }); return go({}); }
    case "more": case "sortmenu": case "viewmenu": case "frommenu": { anchorFrom(data.el); return go({ overlay: name, anchorRect: V.anchorRect }); }
    case "addcontact": { const k = data.who || (t && (t.counterpart || t.from)); const p = DB.contacts[k]; if (!p || p.contact) return; const was = { ...p }; Object.assign(p, { contact: true, lastTouch: "Emailed today", openTasks: p.openTasks || 0, notes: p.notes || 0, meetings: p.meetings || [] }); DB.undo = () => Object.assign(p, was); toast(`${p.name} added to your contacts · this thread is linked`, { undo: true, icon: "userPlus" }); return go({ panel: V.panel || "contact" }); }
    case "reply": case "replyAll": case "forward": { if (!t) return; t.read = true; const others = (t.to || []).filter((k) => k !== "you" && k !== t.from); const to = name === "forward" ? [] : [t.counterpart || t.from]; go({ compose: { mode: name, to, cc: name === "replyAll" ? others : [], acc: t.acc, saved: false, subject: name === "forward" ? `Fwd: ${t.subject}` : t.subject }, focusTo: name === "forward" ? "#c-to" : "#c-body", expanded: null }); const comp = document.getElementById("composer"); if (comp) reveal(comp, "end"); return; }
    case "new": { if (V.firstRun) { toast("Connect an account first", { icon: "mail" }); return go({ overlay: "connect", connect: { prov: "gmail" } }); } return go({ compose: { mode: "new", to: [], cc: [], subject: "", acc: V.scope || "work", saved: false }, focusTo: "#c-to", panel: null }); }
    case "send": case "senddone": { const c = V.compose; if (!c) return; if (!(c.to || []).length) { toast("Add at least one person to send to", { icon: "alert" }); return go({ compose: c, focusTo: "#c-to" }); } const target = c.mode === "new" ? null : t; if (c.remind && target) { c.remindIso = at(c.remind === "1 day" ? 1 : c.remind === "3 days" ? 3 : c.remind === "1 week" ? 7 : 14, 9);  DB.undo = snapshot([target]); target.state = "waiting"; target.waitBy = c.remindIso; target.waitDue = false; target.counterpart = c.to[0]; } if ((name === "senddone" || (target && target.place === "inbox" && !c.remind)) && target) { target.state = "done"; target.doneAt = NOW.toISOString(); } if (target) { target.msgs = (target.msgs || 1) + 1; target.when = NOW.toISOString().slice(0, 19); } toast(`Sending in 10 s${c.remind ? ` · reminds you ${fmtUntil(c.remindIso)} if nobody replies` : target && target.state === "done" ? " · marked Done" : ""}`, { undo: true, icon: "send", ms: 10000, extra: { label: "Edit", act: "undo" } }); if (name === "senddone" || c.remind) advance(before, target ? [target.id] : []); return go({ compose: null, focusRow: true }); }
    case "discard": { const c = V.compose; if (!c) return; toast(c.mode === "new" || (c.text || "").length ? "Draft discarded" : "Reply closed", { undo: !!(c.text || "").length }); return go({ compose: null, focusRow: true }); }
    case "remind": { const c = V.compose; if (!c) return; const opts = ["Never", "1 day", "3 days", "1 week", "2 weeks"]; c.remind = opts[(opts.indexOf(c.remind || "Never") + 1) % opts.length]; if (c.remind === "Never") c.remind = null; return go({ compose: c }); }
    case "ccbcc": return go({ ccbcc: true, compose: V.compose, focusTo: "#c-cc" });
    case "pick": { const c = V.compose; if (!c) return; c.to = [...(c.to || []), data.who]; c.sugg = null; return go({ compose: c, focusTo: "#c-to" }); }
    case "untok": { const c = V.compose; if (!c) return; c.to = (c.to || []).filter((k) => P(k).email !== data.who); return go({ compose: c, focusTo: "#c-to" }); }
    case "fromAcc": { const c = V.compose; c.acc = data.acc; c.alias = data.alias || null; return go({ compose: c, focusTo: "#c-body" }); }
    case "images": { if (!t) return; V.images[t.id] = true; return go({}); }
    case "imagesAlways": { if (!t) return; V.images[t.id] = true; toast(`Images from ${who(t).name} will always show`); return go({}); }
    case "htmlcolors": { if (!t) return; V.html[t.id] = !V.html[t.id]; return go({}); }
    case "expand": { if (!t) return; const ms = t.longThread ? 12 : bodyOf(t).length; const ex = new Set(V.expanded || [ms - 1]); const i = Number(data.i); ex.has(i) ? ex.delete(i) : ex.add(i); return go({ expanded: ex }); }
    case "quote": { const q = new Set(V.quoted || []); const i = Number(data.i); q.has(i) ? q.delete(i) : q.add(i); return go({ quoted: [...q] }); }
    case "toaddr": { const q = new Set(V.toOpen || []); const i = Number(data.i); q.has(i) ? q.delete(i) : q.add(i); return go({ toOpen: [...q] }); }
    case "place": { const rows = (() => { const keep = V; V = { ...V, place: data.place, q: "", checked: [], folderName: null }; const r = flatRows(); V = keep; return r; })(); return go({ place: data.place, folderName: null, q: "", checked: [], sel: rows[0] ? rows[0].id : null, compose: null, expanded: null, focusRow: data.key === true }); }
    case "scope": { const scope = V.scope === data.acc ? null : data.acc; const keep = V; V = { ...V, scope, checked: [] }; const r = flatRows(); V = keep; return go({ scope, checked: [], sel: r.some((x) => x.id === V.sel) ? V.sel : (r[0] ? r[0].id : null), compose: null }); }
    case "folders": return go({ folders: V.folders === data.acc ? null : data.acc });
    case "folder": { const f = data.name; const map = { Inbox: "inbox", INBOX: "inbox", Sent: "sent", Drafts: "drafts", Archive: "archive", Trash: "trash" }; if (map[f]) return act("place", { place: map[f] }); const keep = V; V = { ...V, place: "folder", folderName: f, q: "" }; const r = flatRows(); V = keep; return go({ place: "folder", folderName: f, q: "", checked: [], sel: r[0] ? r[0].id : null, compose: null }); }
    case "reconnect": return go({ overlay: "connect", connect: { reconnect: data.acc } });
    case "connect": return go({ overlay: "connect", connect: { prov: data.prov || "gmail" } });
    case "prov": return go({ overlay: "connect", connect: { prov: data.prov } });
    case "connected": { const c = V.connect || {}; if (c.reconnect) { const acc = { ...V.accounts }; delete acc[c.reconnect]; toast(`${accLabel(c.reconnect)} reconnected · syncing`, { icon: "sync" }); go({ accounts: acc, syncing: true }); setTimeout(() => { V.syncing = false; render(); }, 1400); return; } if (V.firstRun) { toast("robin@haleandco.com connected · your inbox fills in from the newest mail", { icon: "mail" }); go({ firstRun: false, loading: true, sel: null }); setTimeout(() => { V.loading = false; const r = flatRows(); V.sel = r[0] ? r[0].id : null; render(); }, 1600); return; } toast("Account connected · syncing", { icon: "mail" }); return go({ syncing: true }); }
    case "retry": { const acc = { ...V.accounts }; delete acc[data.acc]; go({ accounts: acc, syncing: true }); setTimeout(() => { V.syncing = false; toast(`${accLabel(data.acc)} is syncing again`, { icon: "check" }); render(); }, 1400); return; }
    case "retryall": { DB.pending = 0; toast("Retried · every change made it", { icon: "check" }); return go({}); }
    case "sync": { if (V.net === "offline") return; go({ syncing: true }); setTimeout(() => { V.syncing = false; render(); }, 1200); return; }
    case "server": { V.server = { ...(V.server || {}), [data.acc]: "busy" }; go({}); setTimeout(() => { V.server[data.acc] = "done"; render(); }, 1500); return; }
    case "check": { const c = new Set(V.checked); c.has(data.id) ? c.delete(data.id) : c.add(data.id); return go({ checked: [...c], sel: data.id }); }
    case "clearsel": return go({ checked: [], focusRow: true });
    case "clearq": return go({ q: "", focusTo: "#q" });
    case "panel": { const p = data.panel || null; return go({ panel: V.panel === p ? null : p }); }
    case "left": return go({ leftOpen: !V.leftOpen });
    case "keys": return go({ overlay: "keys" });
    case "palette": return go({ overlay: "palette", popq: "", mailChip: false });
    case "search": return go({ overlay: "palette", popq: data.q || "", mailChip: true });
    case "savedsearch": return go({ overlay: "palette", popq: data.q, mailChip: true });
    case "mailchip": return go({ overlay: "palette", popq: V.popq, mailChip: false });
    case "op": { const parts = (V.popq || "").split(/\s+/); parts[parts.length - 1] = data.op; return go({ overlay: "palette", popq: parts.join(" "), mailChip: true }); }
    case "savesearch": toast(`Saved to Mail as “${V.popq}”`, { icon: "search" }); SAVED.push([V.popq, V.popq]); return go({ overlay: null });
    case "tab": { const keep = V; V = { ...V, tab: data.tab, checked: [] }; const r = flatRows(); V = keep; return go({ tab: data.tab, checked: [], sel: r[0] ? r[0].id : null, compose: null, expanded: null, focusRow: !!data.key }); }
    case "tabsmore": { anchorFrom(data.el); return go({ overlay: "tabsmore", anchorRect: V.anchorRect }); }
    case "tabmenu": { anchorFrom(data.el); return go({ overlay: "tabmenu", anchorRect: V.anchorRect }); }
    case "zero": { const ts2 = DB.threads.filter((x) => inPlace(x, "inbox") && x.kind === V.tab && (NOW - new Date(x.when)) > { day: DAY, week: 7 * DAY, month: 30 * DAY }[data.age]); DB.undo = snapshot(ts2); for (const x of ts2) { x.state = "done"; x.doneAt = NOW.toISOString(); } V.cleared = (V.cleared || 0) + ts2.length; toast(`${ts2.length} threads done, in Archive`, { undo: true, icon: "archive" }); const r = flatRows(); return go({ sel: r[0] ? r[0].id : null }); }
    case "link": { if (!t) return; anchorFrom(data.el); return go({ overlay: "link", anchorRect: V.anchorRect }); }
    case "linkTo": { if (!t) return; DB.undo = snapshot([t]); if (data.kind === "task") t.task = t.task || { title: data.title, due: at(2, 9) }; else t.links.push({ kind: data.kind === "notes" ? "note" : "event", title: data.title }); toast(`Linked to ${data.title}`, { undo: true, icon: "link" }); return go({}); }
    case "note": { if (!t) return; if (t.note) return; DB.undo = snapshot([t]); t.note = true; toast("Private note created · only you can see it", { undo: true, icon: "notes" }); return go({}); }
    case "dismissnudge": { const x = T(data.id); if (x) x.nudgeGone = true; return go({}); }
    case "allow": { const x = T(data.id); x.screened = false; DB.undo = () => { x.screened = true; }; toast(`${who(x).name} can reach your Inbox now`, { undo: true, icon: "check" }); const r = flatRows(); return go({ sel: r[0] ? r[0].id : null }); }
    case "block": { const x = T(data.id || (t && t.id)); if (!x) return; DB.undo = snapshot([x]); x.state = "deleted"; x.place = "trash"; x.screened = false; toast(`Blocked ${who(x).name} · future mail goes to Trash`, { undo: true, icon: "x" }); advance(before, [x.id]); return go({}); }
    case "unsub": case "unsubfrom": { const k = data.who || t.from; V.unsub = { ...(V.unsub || {}), [k]: true }; toast(`Unsubscribed from ${P(k).name}`, { icon: "check" }); return go({}); }
    case "doneall": { const ts2 = DB.threads.filter((x) => x.from === data.who && x.state === "open"); DB.undo = snapshot(ts2); for (const x of ts2) { x.state = "done"; } toast(`${ts2.length} from ${P(data.who).name} done`, { undo: true, icon: "archive" }); const r = flatRows(); return go({ sel: r[0] ? r[0].id : null }); }
    case "unfold": return go({ unfold: true });
    case "nltoggle": { const set = new Set(V.nlOpen || []); set.has(data.who) ? set.delete(data.who) : set.add(data.who); return go({ nlOpen: [...set] }); }
    case "priority": { const p = who(t); p.priority = !p.priority; toast(p.priority ? `${p.name} is a Priority person` : `${p.name} removed from Priority people`); return go({}); }
    case "original": toast("Show original opens the raw message, headers first"); return go({});
    case "mkevent": { if (!t) return; toast(`Event “${t.subject.replace(/^(re|fwd?):\s*/i, "")}” created today at 11:00`, { undo: true, icon: "calendar" }); return go({}); }
    case "rsvp": toast(`${data.r === "Accept" ? "Accepted" : data.r === "Maybe" ? "Replied maybe" : "Declined"} · Jonas gets your reply`, { icon: "calendar" }); return go({ rsvp: data.r });
    case "addcal": toast("Added to Moduo calendar · Thu 11:00", { undo: true, icon: "calendar" }); return go({});
    case "morehistory": return go({ backfill: data.acc, folders: data.acc });
    case "cancelbf": return go({ backfill: null });
    case "discardfailed": toast("Both undone · showing them as the server has them", { icon: "undo" }); return go({ failed: 0 });
    case "retryfailed": toast("Retried · both made it", { icon: "check" }); return go({ failed: 0 });
    case "pwopen": return go({ overlay: "connect", connect: { ...(V.connect || {}), pw: true }, focusTo: "#cn-email" });
    case "attfilter": return go({ attFilter: data.f });
    case "close": return go({ connect: null });
    case "open": { const id = data.id; const x = T(id); if (!x) return; let place = V.place; if (!inPlace(x, place) || SPECIAL.includes(place)) place = PLACES.map((p) => p.id).find((p) => inPlace(x, p)) || "inbox"; return go({ place, tab: x.kind || V.tab, q: "", sel: id, checked: [], compose: null, expanded: null, focusRow: true, mailChip: false }); }
    case "cmd": { const c = data.cmd; if (c.startsWith("place:")) return act("place", { place: c.slice(6), key: true }); V.overlay = null; V.mailChip = false; return act(c, {}); }
    case "undo": { if (DB.undo) { DB.undo(); DB.undo = null; } V.toast = null; return go({ focusRow: true }); }
  }
}
/* mark read a beat after a thread is shown; the rows keep their dot until then */
let readTimer = 0;
function markReadSoon() { clearTimeout(readTimer); readTimer = setTimeout(() => { const t = sel(); if (t && !t.read && V.place !== "drafts") { t.read = true; const r = app.querySelector(`.row[data-id="${CSS.escape(t.id)}"]`); if (r) { r.classList.remove("unread"); const d = r.querySelector(".ud"); if (d) d.remove(); } } }, 700); }
function select(id, opts = {}) { V.sel = id; V.expanded = null; V.quoted = []; V.toOpen = []; if (!opts.keepCompose) V.compose = null; V.focusRow = !!opts.key; V.overlay = null; render(); markReadSoon(); }
function moveSel(dir, extend) {
  const rows = flatRows(); if (!rows.length) return;
  const i = rows.findIndex((t) => t.id === V.sel);
  const n = i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + dir));
  const id = rows[n].id;
  if (extend) { const c = new Set(V.checked); if (!c.has(V.sel) && V.sel) c.add(V.sel); c.add(id); V.checked = [...c]; }
  select(id, { key: true });
}

/* ── pointer ──────────────────────────────────────────────────────────────────────────── */
app.addEventListener("click", (e) => {
  const a = e.target.closest("a.mtab"); if (a) { e.preventDefault(); if (a.dataset.mod !== "mail") toast(`${a.textContent.trim()} is another module`, { ms: 2500 }); return; }
  const el = e.target.closest("[data-act]");
  if (!el) {
    if (V.overlay && !e.target.closest(".float, .dialog, .palette")) { go({ connect: null }); return; }
    const r = e.target.closest(".row"); if (r && r.dataset.id) { if (e.metaKey) return act("check", { id: r.dataset.id }); select(r.dataset.id); }
    return;
  }
  if (el.dataset.act === "select") { if (e.metaKey) return act("check", { id: el.dataset.id }); return select(el.dataset.id); }
  const name = el.dataset.act; const d = { ...el.dataset, el };
  if (name === "check") { e.stopPropagation(); return act("check", { id: el.dataset.id }); }
  if (el.dataset.id && ["done", "snooze", "wait", "task", "more", "undone"].includes(name) && el.closest(".row")) { if (V.sel !== el.dataset.id || V.checked.length) { V.checked = []; V.sel = el.dataset.id; } }
  if (name === "folder") d.name = el.textContent.trim();
  act(name, d);
});
app.addEventListener("contextmenu", (e) => { const r = e.target.closest(".row"); if (r) { e.preventDefault(); V.sel = r.dataset.id; act("more", { el: r }); } });
app.addEventListener("input", (e) => {
  const id = e.target.id;
  if (id === "q") { V.q = e.target.value; const r = flatRows(); V.sel = r[0] ? r[0].id : null; V.focusTo = "#q"; render(); return; }
  if (id === "c-to") { V.compose.sugg = e.target.value; V.focusTo = "#c-to"; render(); return; }
  if (id === "c-subj") { V.compose.subject = e.target.value; return; }
  if (id === "cn-email" || id === "cn-pw") { const em = document.getElementById("cn-email"); const pw = document.getElementById("cn-pw"); const ok = !!(pw && pw.value.trim()) && (!em || !!em.value.trim()); V.connect = { ...(V.connect || {}), ok }; const go = document.getElementById("cn-go"); const why = document.getElementById("cn-why"); if (go) go.disabled = !ok; if (why) why.textContent = ok ? "Checked against the server when you connect." : "Fill in the address and the password to connect."; return; }
  if (id === "pop-q" && V.overlay === "move") { V.popq = e.target.value; render(); return; }
  if (id === "pal-q" || (id === "pop-q" && V.overlay === "link")) { V.popq = e.target.value; const pos = e.target.selectionStart; render(); const el = document.getElementById(id); if (el) el.setSelectionRange(pos, pos); return; }
  if (id === "c-body") { V.compose.text = e.target.firstElementChild ? e.target.firstElementChild.textContent : ""; if (!V.compose.saved) { V.compose.saved = true; const d = app.querySelector(".c-foot .draft"); if (d) d.textContent = "Draft saved just now"; } }
});
/* drag a row onto Tasks, Calendar or Notes in the top bar */
let dragId = null;
app.addEventListener("dragstart", (e) => { const r = e.target.closest(".row"); if (!r) return; dragId = r.dataset.id; e.dataTransfer.setData("text/plain", T(dragId).subject); e.dataTransfer.effectAllowed = "link"; for (const tab of app.querySelectorAll("[data-drop]")) tab.classList.add("drop-ok"); });
app.addEventListener("dragend", () => { for (const tab of app.querySelectorAll("[data-drop]")) tab.classList.remove("drop-ok"); dragId = null; });
app.addEventListener("dragover", (e) => { if (dragId && e.target.closest("[data-drop],[data-drop-today]")) { e.preventDefault(); e.dataTransfer.dropEffect = "link"; } });
app.addEventListener("drop", (e) => {
  if (dragId && e.target.closest("[data-drop-today]")) { e.preventDefault(); const t = T(dragId); V.todayTasks = [...(V.todayTasks || []), [t.subject.replace(/^(re|fwd?):\s*/i, ""), ""]]; t.task = t.task || { title: t.subject.replace(/^(re|fwd?):\s*/i, ""), due: NOW.toISOString() }; toast("Task due today", { undo: true, icon: "task" }); return go({}); }
  const tab = e.target.closest("[data-drop]"); if (!tab || !dragId) return; e.preventDefault();
  const t = T(dragId); const where = tab.dataset.drop; V.sel = t.id; V.checked = [];
  if (where === "tasks") return act("task", {});
  if (where === "calendar") { DB.undo = snapshot([t]); t.task = t.task || { title: t.subject.replace(/^(re|fwd?):\s*/i, ""), due: at(1, 9) }; t.task.due = at(1, 9); toast(`Task created and scheduled for tomorrow 9:00`, { undo: true, icon: "calendar" }); return go({ panel: "task" }); }
  if (where === "notes") { DB.undo = snapshot([t]); t.links.push({ kind: "note", title: `From: ${t.subject}` }); toast(`Attached to a new note in Notes · Inbox`, { undo: true, icon: "notes" }); return go({ panel: "links" }); }
});

/* ── keyboard ─────────────────────────────────────────────────────────────────────────── */
let chord = null, chordTimer = 0;
document.addEventListener("mousedown", () => { document.body.classList.remove("kbd-nav"); lastInput = "pointer"; }, true);
document.addEventListener("keydown", (e) => {
  lastInput = "key";
  if (e.key === "Tab") document.body.classList.add("kbd-nav");
  const mod = e.metaKey || e.ctrlKey; const key = e.key;
  const inField = e.target.closest && e.target.closest("input, textarea, [contenteditable='true']");
  const o = V.overlay;
  /* overlays first */
  if (o) {
    if (key === "Escape") { e.preventDefault(); return go({ connect: null, focusRow: true, mailChip: false }); }
    if (o === "wait" && key === "Tab") { e.preventDefault(); return act("waitMode", { mode: V.waitRegardless ? "reply" : "always" }); }
    const items = [...app.querySelectorAll("#pop .mi, .palette .mi")];
    if (items.length && (key === "ArrowDown" || key === "ArrowUp")) { e.preventDefault(); const cur = items.findIndex((x) => x.dataset.active === "true"); const n = (cur + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((x, i) => (x.dataset.active = i === n)); reveal(items[n], "nearest"); return; }
    if (items.length && key === "Enter" && (inField || e.target.classList.contains("mi"))) { e.preventDefault(); const cur = items.find((x) => x.dataset.active === "true") || items[0]; if (o === "snooze" && inField && e.target.value.trim()) { const iso = parseWhen(e.target.value); if (iso) return act("snoozeTo", { iso }); } if (o === "wait" && inField && e.target.value.trim()) { const iso = parseWhen(e.target.value); if (iso) return act("waitTo", { iso }); } cur.click(); return; }
    if (o === "connect" && key === "Enter" && inField && e.target.tagName === "INPUT") { e.preventDefault(); if (V.connect && (V.connect.ok || V.connect.reconnect)) return act("connected", {}); return; }
    if (o === "connect" && e.target.getAttribute("role") === "radio" && (key === "ArrowRight" || key === "ArrowLeft")) { e.preventDefault(); const ks = ["gmail", "icloud", "imap"]; const i = ks.indexOf(V.connect.prov); return act("prov", { prov: ks[(i + (key === "ArrowRight" ? 1 : -1) + 3) % 3] }); }
    return;
  }
  /* composing */
  if (V.compose) {
    if (mod && key === "Enter") { e.preventDefault(); return act(e.shiftKey ? "senddone" : "send", {}); }
    if (mod && e.shiftKey && key.toLowerCase() === "h") { e.preventDefault(); return act("remind", {}); }
    if (key === "Escape") { e.preventDefault(); const c = V.compose; if (c.sugg) { c.sugg = null; return go({ compose: c, focusTo: "#c-to" }); } toast((c.text || "").length || c.mode === "new" ? "Draft saved · find it in Drafts" : "Reply closed", { icon: "draft" }); return go({ compose: null, focusRow: true }); }
    if (inField && inField.id === "c-to") {
      const c = V.compose;
      if (key === "Enter" || key === "Tab" && c.sugg) { const hit = app.querySelector(".sugg .mi[data-active='true']"); if (hit) { e.preventDefault(); return act("pick", { who: hit.dataset.who }); } }
      if (key === "Backspace" && !e.target.value && (c.to || []).length) { e.preventDefault(); c.to = c.to.slice(0, -1); return go({ compose: c, focusTo: "#c-to" }); }
      if (key === "ArrowDown" || key === "ArrowUp") { const items = [...app.querySelectorAll(".sugg .mi")]; if (items.length) { e.preventDefault(); const cur = items.findIndex((x) => x.dataset.active === "true"); const n = (cur + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((x, i) => { x.dataset.active = i === n; x.setAttribute("aria-selected", i === n); }); } return; }
    }
    if (inField) return;
  }
  /* the search field */
  if (inField && inField.id === "q") { if (key === "Escape") { e.preventDefault(); if (V.q) return go({ q: "", focusRow: true }); e.target.blur(); return go({ focusRow: true }); } if (key === "Enter" || key === "ArrowDown") { e.preventDefault(); return go({ focusRow: true }); } return; }
  if (inField) { if (key === "Escape") { e.target.blur(); return go({ focusRow: true }); } return; }
  /* global */
  if (mod && key.toLowerCase() === "k") { e.preventDefault(); return act("palette", {}); }
  if (mod && key.toLowerCase() === "z") { e.preventDefault(); return act("undo", {}); }
  if ((key === "ArrowDown" || key === "ArrowUp") && e.target.closest && e.target.closest(".rail")) { e.preventDefault(); const bs = [...app.querySelectorAll(".rail .nav-row, .rail .acct .main")]; const i = bs.indexOf(e.target.closest("button")); const n = bs[Math.max(0, Math.min(bs.length - 1, i + (key === "ArrowDown" ? 1 : -1)))]; if (n) { bs.forEach((b) => (b.tabIndex = -1)); n.tabIndex = 0; n.focus({ preventScroll: true }); } return; }
  if (mod && key.toLowerCase() === "a" && !V.firstRun) { e.preventDefault(); return go({ checked: flatRows().map((t) => t.id), focusRow: true }); }
  if (mod && key.toLowerCase() === "n") { e.preventDefault(); return act("new", {}); }
  if (e.altKey && ["Digit1", "Digit2", "Digit3"].includes(e.code)) { e.preventDefault(); const p = ["links", "contact", "task"][Number(e.code.slice(-1)) - 1]; return go({ panel: V.panel === p ? null : p }); }
  if (mod || e.altKey) return;
  if (key === "?" || (e.shiftKey && key === "/")) { e.preventDefault(); return act("keys", {}); }
  if (key === "/") { e.preventDefault(); return act("search", {}); }
  if (key === "[" || key === "]") { e.preventDefault(); if (V.place !== "inbox") return; const i = TABS.indexOf(V.tab); return act("tab", { tab: TABS[(i + (key === "]" ? 1 : -1) + 3) % 3], key: true }); }
  if (key === "Escape") { e.preventDefault(); if (V.checked.length) return go({ checked: [], focusRow: true }); if (V.toast) { V.toast = null; return render(); } if (V.panel) return go({ panel: null, focusRow: true }); return go({ focusRow: true }); }
  if (V.firstRun || V.webMode) { if (key === "Enter") act("connect", {}); return; }
  /* chords: g then a place */
  if (chord === "g") { chord = null; clearTimeout(chordTimer); const map = { i: "inbox", f: "followups", s: "snoozed", a: "archive", t: "sent", d: "drafts" }; if (map[key]) { e.preventDefault(); return act("place", { place: map[key], key: true }); } }
  if (key === "g") { chord = "g"; clearTimeout(chordTimer); chordTimer = setTimeout(() => (chord = null), 900); return; }
  if ((key === "ArrowRight" || key === "ArrowLeft") && e.target.closest && e.target.closest(".acct .main")) { e.preventDefault(); const acc = e.target.closest(".acct .main").dataset.acc; if ((key === "ArrowRight") !== (V.folders === acc)) act("folders", { acc }); return; }
  if (key === "j" || key === "ArrowDown") { e.preventDefault(); return moveSel(1, e.shiftKey && key === "ArrowDown"); }
  if (key === "J") { e.preventDefault(); return moveSel(1, true); }
  if (key === "k" || key === "ArrowUp") { e.preventDefault(); return moveSel(-1, e.shiftKey && key === "ArrowUp"); }
  if (key === "K") { e.preventDefault(); return moveSel(-1, true); }
  if (key === "Enter" || key === "o") { e.preventDefault(); const t = sel(); if (!t) return; if (key === "o") { const ms = t.longThread ? 12 : bodyOf(t).length; return go({ expanded: new Set(Array.from({ length: ms }, (_, i) => i)) }); } const h = document.getElementById("rd-title"); if (h) h.focus({ preventScroll: true }); return; }
  if (key === "x") { e.preventDefault(); const t = sel(); if (t) return act("check", { id: t.id }); return; }
  if (key === "Backspace" && !inField) { e.preventDefault(); return act("delete", {}); }
  if (V.place === "newsenders" && (key === "y" || key === "b") && sel()) { e.preventDefault(); return act(key === "y" ? "allow" : "block", { id: V.sel }); }
  const map = { e: "done", E: "undone", s: "snooze", w: "wait", t: "task", l: "link", n: "note", p: "pin", u: "unread", "#": "delete", m: "move", r: "reply", a: "replyAll", f: "forward", c: "new", z: "undo" };
  if (map[key]) { e.preventDefault(); const t = sel(); const el = t ? app.querySelector(`.rd-bar [data-act="${map[key]}"]`) : null; return act(map[key], { el }); }
});
function parseWhen(s) {
  const q = s.trim().toLowerCase(); const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let d = null; const h = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(q);
  const di = days.findIndex((x) => q.includes(x));
  if (di >= 0) { d = new Date(NOW); let delta = (di - NOW.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + delta); }
  else if (q.includes("tomorrow")) { d = new Date(NOW); d.setDate(d.getDate() + 1); }
  else if (q.includes("next week")) { d = new Date(NOW); d.setDate(d.getDate() + ((8 - NOW.getDay()) % 7 || 7)); }
  else if (/^\d/.test(q)) d = new Date(NOW);
  if (!d) return null;
  let hh = 9, mm = 0; if (h) { hh = Number(h[1]); mm = Number(h[2] || 0); if (h[3] === "pm" && hh < 12) hh += 12; }
  d.setHours(hh, mm, 0, 0); return d.toISOString().slice(0, 19);
}

/* ── states ───────────────────────────────────────────────────────────────────────────── */
function denseData(db) {
  const tpl = [["jonas", "people", "Re: Acme rollout: SSO window"], ["ana", "people", "Relaunch: copy review round 2"], ["dev", "people", "Prod flip went fine"], ["tom", "people", "Trademark: EU classes confirmed"], ["lena", "people", "Fjord: board slot for January"], ["marco", "people", "Shoot: retouched selects"], ["priya", "people", "Northwind partnership one-pager"], ["kit", "people", "Lisbon: the terrace house is ours"], ["sam", "people", "Tuesday coffee, 15:00?"], ["elena", "people", "Founders Day: panel questions"], ["stripe", "updates", "Payment received: €49.00"], ["linear", "updates", "HAL-214: Mail reader dark mode"], ["github", "updates", "[haleandco/app] 3 pull requests need review"], ["vercel", "updates", "Deployment ready: landing (main)"], ["calendly", "updates", "Reminder: Dana Whitfield tomorrow 11:30"], ["hetzner", "updates", "Invoice R0023500112 is available"], ["figma", "updates", "Ana commented on 'Relaunch — hero'"], ["lenny", "reading", "Pricing pages that convert"], ["tldr", "reading", "TLDR: Rust 2.0 edition, the end of cookies"], ["ph", "reading", "Daily digest: a calmer calendar"], ["notion", "reading", "Notion Mail is going away"], ["webflow", "reading", "Webflow Conf: day two"], ["loom", "reading", "Your weekly Loom digest"], ["lufthansa", "reading", "Winter sale: Porto from €79"]];
  const snips = ["Quick one before the call:", "Following up on last week,", "Here's the latest:", "No action needed.", "Can you take a look by Thursday?", "Attached as promised.", "Thanks, all set on our side.", "Two things:"];
  for (let i = 0; i < 110; i++) { const [from, kind, subject] = tpl[i % tpl.length]; const d = new Date(NOW); d.setDate(d.getDate() - Math.floor(i / 11)); d.setHours(8 + (i * 7) % 11, (i * 13) % 60, 0, 0); db.threads.push({ id: `d${i}`, acc: ["work", "work", "personal", "studio"][i % 4], from, to: ["you"], subject: `${subject}${i >= tpl.length ? ` (${Math.floor(i / tpl.length) + 1})` : ""}`, snippet: `${snips[i % snips.length]} ${subject.toLowerCase()} and the rest of the week's thread.`, when: d.toISOString().slice(0, 19), unread: i % 3 === 0, read: i % 3 !== 0, kind, msgs: 1 + (i % 4), att: i % 6 === 0 ? ["notes.pdf"] : [], state: "open", place: "inbox", links: [], task: null }); }
}
function longData(db) { const t = db.threads.find((x) => x.id === "t1"); t.subject = "Re: Re: Fwd: Acme rollout — revised timeline for the Hamburg pilot, the SSO window on the 12th, seat count (25), Devon on the weekly check-in, and the January full rollout across the three remaining sites"; t.longThread = true; t.msgs = 12; t.att = ["Acme-rollout-v1.pdf", "Acme-rollout-v2.pdf", "Acme-rollout-v3.pdf"]; }
function doneData(db) { for (const id of ["t11", "t13", "t14", "u7", "u8", "u9", "u10", "r5", "r6", "r7", "r8"]) { const t = db.threads.find((x) => x.id === id); if (t) { t.state = "done"; t.doneAt = at(-1, 17); } } }
const STATES = [
  { id: "default", label: "Default: Tuesday 10:42, Personal tab, the Acme thread open, Today beside it", v: {} },
  { id: "firstRun", label: "First run: no account yet", v: { firstRun: true, sel: null, panel: null } },
  { id: "connect", label: "Connect an account (dialog)", v: { firstRun: true, sel: null, panel: null, overlay: "connect", connect: { prov: "gmail" } } },
  { id: "connectPw", label: "Connect: app password path", v: { firstRun: true, sel: null, panel: null, overlay: "connect", connect: { prov: "icloud" } } },
  { id: "firstSync", label: "First sync: the newest mail is on its way", v: { loading: true, sel: null, backfill: "work" } },
  { id: "inboxZero", label: "Inbox zero in Personal", data: (db) => { for (const t of db.threads) if (inPlace(t, "inbox") && t.kind === "people") { t.state = "done"; t.doneAt = at(0, 9); } }, v: { sel: null, cleared: 14 } },
  { id: "notifications", label: "Notifications tab", v: { tab: "updates", sel: "u1" } },
  { id: "newsletters", label: "Newsletters tab: one row per sender, unsubscribe in the reader", v: { tab: "reading", sel: "r1", nlOpen: ["lenny"] } },
  { id: "dense", label: "Dense: back from a week away, 140 threads, compact rows", data: denseData, v: { dense: true, sel: "d0" } },
  { id: "long", label: "Long: a 200-character subject, a 12-message thread", data: longData, v: { sel: "t1" } },
  { id: "invite", label: "A calendar invite in the reader", v: { sel: "t15" } },
  { id: "offline", label: "Offline: one message in Outbox, two actions waiting", data: (db) => { db.pending = 2; }, v: { net: "offline", outbox: 1 } },
  { id: "reconnect", label: "One account needs you to sign in again", v: { accounts: { studio: "reauth" } } },
  { id: "failed", label: "Couldn't sync 2 actions", v: { failed: 2 } },
  { id: "backfill", label: "History syncing on one account", v: { backfill: "personal", folders: "personal" } },
  { id: "emptyFolder", label: "An empty folder (Spam)", v: { place: "spam", sel: null } },
  { id: "search", label: "/ opens ⌘K on Email: from:acme has:attachment", v: { overlay: "palette", mailChip: true, popq: "from:acme has:attachment" } },
  { id: "palette", label: "⌘K: every action with its key", v: { overlay: "palette", mailChip: false } },
  { id: "followups", label: "Follow-ups: one came due", v: { place: "followups", sel: "f1" } },
  { id: "snoozed", label: "Snoozed", v: { place: "snoozed", sel: "s1" } },
  { id: "archive", label: "Archive: where Done goes, reversible", data: doneData, v: { place: "archive", sel: "t11" } },
  { id: "newSenders", label: "New senders: the Screener asks first", v: { place: "newsenders", sel: "n1" } },
  { id: "subscriptions", label: "Subscriptions view", v: { place: "subscriptions", sel: null, panel: null } },
  { id: "attachments", label: "Attachments view", v: { place: "attachments", sel: null, panel: null } },
  { id: "bulk", label: "Bulk: three threads selected (x)", v: { checked: ["t2", "t3", "t4"], sel: "t2" } },
  { id: "snoozePicker", label: "Snooze picker (s)", v: { overlay: "snooze" } },
  { id: "remindPicker", label: "Remind me if no reply (w)", v: { overlay: "wait" } },
  { id: "linkPicker", label: "Link to a task, contact or note (l)", v: { overlay: "link" } },
  { id: "moreMenu", label: "The ⋯ menu", v: { overlay: "more" } },
  { id: "taskMade", label: "t pressed: the task beside the thread", data: (db) => { const t = db.threads.find((x) => x.id === "t2"); t.task = { title: "Hero photo options for the relaunch", due: at(0, 14) }; }, v: { sel: "t2", panel: "task", toast: { text: "Task created", undo: true, icon: "task", extra: { label: "Also mark the email Done", act: "alsodone" } } } },
  { id: "contact", label: "⌥2: the sender, all mail with them, their work", v: { panel: "contact", sel: "t3" } },
  { id: "unknownSender", label: "A sender not in your contacts", v: { sel: "t4", panel: "contact" } },
  { id: "reply", label: "Reply under the thread, remind me if no reply", v: { sel: "t2", compose: { mode: "reply", to: ["ana"], cc: [], acc: "work", saved: true, remind: "3 days", text: "Second one. The morning light carries the page; let's go with B and ask Marco for a tighter crop." } } },
  { id: "undoSend", label: "Sent: 10 s to undo or edit", data: (db) => { const t = db.threads.find((x) => x.id === "t2"); t.state = "done"; t.doneAt = NOW.toISOString(); }, v: { sel: "t3", toast: { text: "Reply to Ana sends in 10 s · thread marked Done", undo: true, icon: "send", extra: { label: "Edit", act: "undo" } } } },
  { id: "newMessage", label: "New message in the reader column", v: { compose: { mode: "new", to: ["lena"], cc: [], subject: "Friday: the hiring plan", acc: "work", saved: true, text: "" }, panel: null } },
  { id: "keys", label: "Mail keys (?)", v: { overlay: "keys" } },
  { id: "investors", label: "A custom tab: Investors (Settings defines up to 3)", v: { tab: "investors", sel: "i1" } },
  { id: "acctHealth", label: "Account status: live, history depth, storage on this Mac", v: { overlay: "acctpop", acctId: "work" } },
  { id: "acctReauth", label: "Account status: Lumen needs you to sign in again", v: { overlay: "acctpop", acctId: "studio", accounts: { studio: "reauth" } } },
  { id: "outbox", label: "Offline: Outbox, waiting for connection", v: { net: "offline", outbox: 1, place: "outbox", sel: "o1", panel: null } },
  { id: "sendFailed", label: "A send that failed comes back to Drafts with the reason", data: (db) => { const d = db.threads.find((x) => x.id === "d2"); d.sendFailed = "Hale & Co's server refused marco.reyes@pixelforge.cp (no such domain)"; d.failedAt = "10:39"; }, v: { place: "drafts", sel: "d2", panel: null } },
  { id: "bodyOffline", label: "Offline: an older message not downloaded yet", data: (db) => { const x = db.threads.find((y) => y.id === "t9"); x.bodyState = "remote"; }, v: { net: "offline", sel: "t9" } },
  { id: "bodyFetch", label: "Opening older mail: the rest downloads in about a second", data: (db) => { const x = db.threads.find((y) => y.id === "t9"); x.bodyState = "remote"; }, v: { sel: "t9" } },
  { id: "away", label: "Launch after a weekend: 3 emails came back while you were away", data: (db) => { for (const id of ["s1", "s2", "s3"]) { const x = db.threads.find((y) => y.id === id); if (x) { x.state = "open"; x.back = "away"; x.when = at(0, 8, 5); x.read = false; } } }, v: { away: 3, sel: "s1" } },
  { id: "whyHere", label: "Why is this in Notifications? (the classifier's order, explained)", v: { tab: "updates", sel: "u2", overlay: "why" } },
  { id: "whyRule", label: "Why here: one of your rules decided it", v: { tab: "updates", sel: "u1", overlay: "why" } },
  { id: "ruleNew", label: "Make a rule from a sender", v: { tab: "updates", sel: "u1", overlay: "rule", ruleEdit: false, rule: { cond: "from", tab: "updates", label: "Receipts", read: true, apply: true } } },
  { id: "alias", label: "Compose: send from an alias, its signature follows", v: { sel: "t2", compose: { mode: "reply", to: ["ana"], cc: [], acc: "work", saved: "server", text: "Second one. Morning light carries the page." }, overlay: "frommenu" } },
  { id: "snippet", label: "Compose: ;; inserts a snippet", v: { sel: "t10", compose: { mode: "reply", to: ["dana"], cc: [], acc: "work", saved: "local", text: ";;", snip: "" } } },
  { id: "tooBig", label: "Compose: over the provider's size limit, caught before Send", v: { compose: { mode: "new", to: ["marco"], cc: [], subject: "Shoot: references", acc: "work", saved: "server", text: "References for Thursday, and the raw set from the test shoot.", att: [["shot-list.pdf", 0.4], ["moodboard.pdf", 6.2], ["test-shoot-raw.zip", 24.8]] }, panel: null } },
  { id: "intro", label: "Reply to an intro: move the introducer to Bcc", v: { sel: "t10", compose: { mode: "replyAll", to: ["priya", "dana"], cc: [], acc: "work", saved: "server", text: "", introducer: "priya" } } },
  { id: "serverSearch", label: "⌘K: older mail found on the server", v: { overlay: "palette", mailChip: true, popq: "from:fjord term sheet", server: { work: "done" } } },
  { id: "web", label: "On the web: the read-only view", v: { webMode: true, panel: null, leftOpen: false } },
];
function set(id) {
  const st = STATES.find((s) => s.id === id) || STATES[0];
  resetData();
  if (st.data) st.data(DB);
  V = { ...BASE, checked: [], images: {}, html: {}, accounts: {}, quoted: [], ...st.v, state: st.id };
  if (V.compose) V.compose = { ...V.compose };
  clearTimeout(toastTimer); clearTimeout(readTimer);
  render();
  if (V.overlay === "tabsmore") { const el = app.querySelector(".stab-more"); if (el && !el.hidden) { V.anchorRect = rel(el); place(); } }
  if (V.overlay === "frommenu") { const el = document.getElementById("c-from"); if (el) { V.anchorRect = rel(el); place(); } }
  if (V.overlay === "acctpop") { const el = app.querySelector(`[data-act="acctpop"][data-acc="${V.acctId}"]`); if (el) { V.anchorRect = rel(el); place(); } }
  if (V.overlay === "why") { const el = app.querySelector('.who-card [data-act="why"]') || app.querySelector('.rd-bar [data-act="more"]'); if (el) { V.anchorRect = rel(el); place(); } }
  if (["snooze", "wait", "move", "link", "more"].includes(V.overlay)) { const el = app.querySelector(`.rd-bar [data-act="${V.overlay === "wait" ? "more" : V.overlay}"]`); if (el) { V.anchorRect = rel(el); place(); } }
  const firstChecked = app.querySelector('.row[data-checked="true"]'); if (firstChecked) reveal(firstChecked, "nearest");
  const comp = document.getElementById("composer"); if (comp && V.compose && V.compose.mode !== "new") reveal(comp, "end");
  const pick = document.getElementById("state-pick"); if (pick) pick.value = st.id;
  try { localStorage.setItem("mail-studio-state", st.id); } catch {}
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render());
let rsT = 0; window.addEventListener("resize", () => { clearTimeout(rsT); rsT = setTimeout(render, 60); });
window.studio = { states: STATES.map(({ id, label }) => ({ id, label })), set };

/* ── page frame ───────────────────────────────────────────────────────────────────────── */
const pick = document.getElementById("state-pick");
pick.innerHTML = STATES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("");
pick.addEventListener("change", () => set(pick.value));
document.getElementById("keys-btn").addEventListener("click", () => set("keys"));
for (const b of document.querySelectorAll(".pg-tab")) b.addEventListener("click", () => showTab(b.dataset.tab));
function showTab(k) {
  for (const b of document.querySelectorAll(".pg-tab")) b.setAttribute("aria-selected", b.dataset.tab === k);
  for (const s of ["proto", "why", "score"]) document.getElementById("v-" + s).hidden = s !== k;
  document.getElementById("proto-tools").hidden = k !== "proto";
  if (["why", "score"].includes(k) && location.hash !== "#" + k) history.replaceState(null, "", "#" + k);
  if (k === "proto" && location.hash) history.replaceState(null, "", location.pathname + location.search);
}
document.getElementById("why").innerHTML = window.WHY_HTML || "";
document.getElementById("score").innerHTML = window.SCORE_HTML || "";
let startState = "default";
if (!CRITIC) { try { startState = localStorage.getItem("mail-studio-state") || "default"; } catch {} }
set(STATES.some((s) => s.id === startState) ? startState : "default");
if (!CRITIC && ["#why", "#score"].includes(location.hash)) showTab(location.hash.slice(1));
</script>
