// The Task capture (tasks-v3 §10, calls 33, 33a, 90–94, 20a; TV-U14): what ⌘⇧K,
// ⌘N, "+ New" and `c` open. Prototype round-2b frame 6.
//
// - A destination row: the type chip, "Inbox ▾" / "Acme rebrand › Design ▾",
//   and a removable "From: …" chip for the email, note, event or contact that
//   was open (93, linked by default).
// - The title with live tokens (`@` people · teams · projects · things, `#`
//   tags, `/` commands; date words marked), a description that grows to about
//   six lines, subtasks typed inline, four pills and More.
// - ⏎ creates, ⌘⏎ creates more (keeps the pills and the destination), ⇧⏎ goes
//   to the description; Esc closes a menu, then undoes the last recognition,
//   then closes and keeps the draft.
// - A team needs a project its members can see (94): the team's default fills
//   in, else Create waits for one. `@person` with no project keeps it unfiled
//   and shows the empty project slot (20a).
// - A pasted list offers "Create n tasks?" (indentation = subtasks, ≤ 500,
//   one Undo).

import { $createTextNode, type NodeKey } from "lexical";
import { CalendarDays, ChevronDown, Circle, FileText, Inbox, Mail, Plus, User } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Chip } from "../../../components/ui/chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Textarea } from "../../../components/ui/textarea";
import type { CaptureBodyProps } from "../../../lib/capture-registry";
import type { CaptureSourceKind } from "../../../lib/capture-source";
import { isMacPlatform } from "../../../lib/shortcuts";
import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import { formatDay, formatDayTime } from "../../../lib/time-format";
import { undoToast } from "../../../lib/undo-toast";
import { cn } from "../../../lib/utils";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import type { MenuPickApi } from "../../spine/editor/mention-menu-plugin";
import { dateCommandDay } from "../../spine/grammar";
import { resolveEntityIcon } from "../../spine/icon-map";
import type { MentionCandidate } from "../../spine/mention";
import { useReferences } from "../../spine/references/context";
import { openReferenceFull } from "../../spine/references/open";
import { useAssignees } from "../assignees";
import { positionsAfter } from "../helpers";
import type { Bucket, Task } from "../model";
import {
  type CaptureToken,
  captureDates,
  resolveTitle,
  SINGLE_VALUE_KINDS,
  segmentsFromLine,
  type TitleSegment,
  tokenText,
} from "../parse/capture-tokens";
import { isPastedList, keepAsOne, parsePastedList } from "../parse/paste-list";
import {
  type CapturePlan,
  type CaptureResult,
  type CaptureTaskPlan,
  newTaskId,
  runCapture,
  undoCapture,
} from "./capture-create";
import {
  type CaptureDraft,
  clearDraft,
  type DraftFields,
  draftHasContent,
  EMPTY_DRAFT,
  EMPTY_FIELDS,
  loadDraft,
  saveDraft,
} from "./capture-draft";
import { captureAttachments, captureTemplates } from "./capture-hooks";
import {
  type CapturePerson,
  commandEntries,
  type EntryEffect,
  mentionEntries,
  tagEntries,
} from "./capture-menus";
import { CapturePills, type OpenPill, type PillChange, type PillValues } from "./capture-pills";
import { $tokensToText, type MenuPick, TitleEditor, type TitleEditorApi } from "./title-editor";
import { $createCaptureTokenNode } from "./token-node";

const SOURCE_ICON: Record<CaptureSourceKind, typeof Mail> = {
  email: Mail,
  note: FileText,
  event: CalendarDays,
  contact: User,
};

/**
 * The title's words as the Task body last told the shell. When the shell's
 * draft still matches, the stored draft (with its tokens) is the one to
 * restore; when it doesn't, the words were changed under another type (⌘2,
 * then back) and come along as words.
 */
let lastTitleWords = "";

/** The plain words of a title (tokens as their words): what the shell carries between types. */
function plainText(segments: readonly TitleSegment[]): string {
  return segments
    .map((s) => ("text" in s ? s.text : tokenText(s.token)))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where each date highlight sits: inside which text segment, from where to where. */
function highlightsBySegment(
  segments: readonly TitleSegment[],
  starts: Map<number, number>,
  spans: ReadonlyArray<[number, number]>,
): Array<{ index: number; start: number; end: number }> {
  const out: Array<{ index: number; start: number; end: number }> = [];
  for (const [a, b] of spans) {
    for (const [index, start] of starts) {
      const segment = segments[index];
      if (!segment || !("text" in segment)) continue;
      const end = start + segment.text.length;
      if (b <= start || a >= end) continue;
      out.push({ index, start: Math.max(a, start) - start, end: Math.min(b, end) - start });
    }
  }
  return out;
}

export function TaskCaptureBody({
  draft: shellDraft,
  onDraftChange,
  writable,
  onDone,
  context,
  typeChip,
  registerEscape,
}: CaptureBodyProps) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();
  const { assignees } = useAssignees();
  // What the workspace holds, from its shared store (TV-D11a): the app shell
  // keeps it warm, so projects, sections, teams and tags are there at once.
  const store = useWorkspaceStore(runtime, userId, workspaceId, writable);
  const snapshot = useStoreSnapshot(store);
  const bundle = snapshot.loaded ? snapshot.bundle : null;
  const isMac = isMacPlatform();
  // The draft belongs to whoever opened the capture, where they opened it:
  // a switch while it's open never files it under another (the shell closes).
  const [owner] = useState(() => ({ userId, workspaceId }));

  // ── the draft (restored on open, research §1.8) ──────────────────────────
  const [initial] = useState(() => {
    const stored = loadDraft(owner.userId, owner.workspaceId);
    const restored = stored && draftHasContent(stored) ? stored : null;
    let start: CaptureDraft = restored ?? EMPTY_DRAFT;
    // Typed under another type (⌘2, then back): those words come along.
    if (shellDraft.trim() && shellDraft !== lastTitleWords) {
      start = { ...start, segments: [{ text: shellDraft }] };
    }
    // A filtered scope pre-fills its tags, assignee and priority (U2-5).
    const seed = context?.seed;
    if (!restored && seed) {
      start = {
        ...start,
        fields: {
          ...EMPTY_FIELDS,
          ...(seed.assigneeId !== undefined ? { assigneeId: seed.assigneeId } : {}),
          ...(seed.priority ? { priority: seed.priority } : {}),
          tags: (seed.tagIds ?? []).map((id) => ({ id, name: "" })),
        },
      };
    }
    return { draft: start, restored: Boolean(restored) };
  });
  const [segments, setSegments] = useState<TitleSegment[]>(initial.draft.segments);
  const [segmentKeys, setSegmentKeys] = useState<Array<NodeKey | null>>([]);
  const [keep, setKeep] = useState<string[]>(initial.draft.keep);
  const [description, setDescription] = useState(initial.draft.description);
  const [subtasks, setSubtasks] = useState<string[]>(initial.draft.subtasks);
  const [fields, setFields] = useState<DraftFields>(initial.draft.fields);
  const [destination, setDestination] = useState<{
    projectId: string | null;
    sectionId: string | null;
  }>(() => ({
    projectId: context?.destination?.projectId ?? null,
    sectionId: context?.destination?.sectionId ?? null,
  }));
  const [sourceOn, setSourceOn] = useState(true);
  const [restoredNotice, setRestoredNotice] = useState(initial.restored);
  const [pasted, setPasted] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [openPill, setOpenPill] = useState<OpenPill>(null);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const titleApi = useRef<TitleEditorApi | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const subtaskRefs = useRef<Array<HTMLInputElement | null>>([]);
  const createListRef = useRef<HTMLButtonElement>(null);
  /** The token just recognised: Esc right after turns it back into words. */
  const justInserted = useRef<{ key: NodeKey; baseline: string | null } | null>(null);
  const effects = useRef<Record<string, Map<string, EntryEffect>>>({});

  // Keep the draft on the device as it changes.
  useEffect(() => {
    saveDraft(owner.userId, owner.workspaceId, { segments, keep, description, subtasks, fields });
  }, [owner, segments, keep, description, subtasks, fields]);

  // The title takes the caret once the dialog has settled.
  useEffect(() => {
    const id = window.setTimeout(() => titleApi.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  // A hint ("@Acme moved into the destination") fades after a moment.
  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(() => setHint(null), 4000);
    return () => window.clearTimeout(id);
  }, [hint]);

  // ── what the bundle knows ─────────────────────────────────────────────────
  const projects = useMemo(
    () =>
      (bundle?.buckets ?? [])
        .filter((b) => !b.isSystem && !b.deletedAt)
        .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)),
    [bundle],
  );
  const sections = useMemo(
    () =>
      [...(bundle?.sections ?? [])].sort(
        (a, b) => a.position - b.position || a.name.localeCompare(b.name),
      ),
    [bundle],
  );
  const teams = useMemo(() => bundle?.teams ?? [], [bundle]);
  const tags = useMemo(() => (bundle?.tags ?? []).filter((t) => !t.deletedAt), [bundle]);
  const people = useMemo(
    () =>
      assignees.map((a) => ({
        userId: a.userId,
        name: a.isMe ? a.fullName || "You" : a.name,
        isMe: a.isMe,
        canTakeTasks: a.canTakeTasks,
      })),
    [assignees],
  );
  const menuPeople = useMemo<CapturePerson[]>(() => people.filter((p) => p.canTakeTasks), [people]);

  // ── a restored draft's names, looked up again (it keeps ids only) ─────────
  // A linked thing's title comes from References, per reader: one the person
  // can no longer open reads "Private item" on its chip, and leaves the title
  // and the links.
  const restoredThings = useMemo(
    () =>
      segments.flatMap((s) =>
        "token" in s && s.token.kind === "thing" && !s.token.label ? [s.token.ref] : [],
      ),
    [segments],
  );
  const referenceState = useReferences(restoredThings);
  const titleSegments = useMemo<TitleSegment[]>(
    () =>
      segments.map((s) => {
        if (!("token" in s) || s.token.kind !== "thing" || s.token.label) return s;
        const state = referenceState(s.token.ref);
        if (state?.status === "ready") return { token: { ...s.token, label: state.facts.title } };
        if (state && state.status !== "loading") return { text: "" };
        return s;
      }),
    [segments, referenceState],
  );
  // People, teams and tags get their names back once the lists are here; one
  // that's gone (a member who left, a deleted tag) leaves the title.
  const hydrated = useRef(false);
  useEffect(() => {
    // Only once the store has answered: an empty bundle would read as "gone".
    if (hydrated.current || !bundle || people.length === 0) return;
    hydrated.current = true;
    titleApi.current?.mapTokens((token) => {
      if (token.kind === "person" && !token.label) {
        const p = people.find((x) => x.userId === token.userId);
        return p ? { ...token, label: p.name } : null;
      }
      if (token.kind === "team" && !token.label) {
        const t = teams.find((x) => x.id === token.teamId);
        return t ? { ...token, label: t.name, letters: t.mark || null } : null;
      }
      if (token.kind === "tag" && token.tagId && !token.label) {
        const t = tags.find((x) => x.id === token.tagId);
        return t ? { ...token, label: t.name, color: t.color } : null;
      }
      return token;
    });
  }, [bundle, people, teams, tags]);

  // ── what the title says ───────────────────────────────────────────────────
  const manualDates = useMemo(
    () => ({
      dueDay: fields.dueDay ?? null,
      scheduledAt: fields.scheduledAt ?? null,
      recurrence: fields.recurrence ?? null,
    }),
    [fields.dueDay, fields.scheduledAt, fields.recurrence],
  );
  const resolved = useMemo(
    () => resolveTitle(titleSegments, { keep, manualDates }),
    [titleSegments, keep, manualDates],
  );
  const dates = captureDates(resolved, manualDates);
  const highlights = useMemo(
    () => highlightsBySegment(titleSegments, resolved.segmentStarts, resolved.highlights),
    [titleSegments, resolved],
  );

  const tagValues = useMemo(() => {
    const out: PillValues["tags"] = [];
    const seen = new Set<string>();
    const add = (t: { id: string | null; name: string; color?: string | null }) => {
      const key = t.id ?? `new:${t.name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      const known = t.id ? tags.find((x) => x.id === t.id) : null;
      out.push({ id: t.id, name: known?.name ?? t.name, color: known?.color ?? t.color ?? null });
    };
    for (const t of fields.tags) add(t);
    for (const t of resolved.tags) add({ id: t.tagId, name: t.label, color: t.color });
    return out.filter((t) => t.name);
  }, [fields.tags, resolved.tags, tags]);

  const values: PillValues = {
    assigneeId: resolved.single.person ? resolved.single.person.userId : fields.assigneeId,
    teamId: resolved.single.team?.teamId ?? fields.teamId ?? null,
    dueDay: dates.dueDay,
    scheduledAt: dates.scheduledAt,
    recurrence: dates.recurrence,
    priority: resolved.single.priority?.level ?? fields.priority ?? null,
    estimateMinutes: resolved.single.estimate?.minutes ?? fields.estimateMinutes ?? null,
    remindAt: resolved.single.remind?.at ?? fields.remindAt ?? null,
    tags: tagValues,
    waitingOn: fields.waitingOn,
  };

  // ── where it goes ─────────────────────────────────────────────────────────
  const team = teams.find((t) => t.id === values.teamId) ?? null;
  const teamDefault = team?.defaultProjectId
    ? (projects.find((p) => p.id === team.defaultProjectId) ?? null)
    : null;
  const chosen = destination.projectId
    ? (projects.find((p) => p.id === destination.projectId) ?? null)
    : null;
  const projectId = destination.projectId ?? (team ? (teamDefault?.id ?? null) : null);
  const sectionId = destination.projectId ? destination.sectionId : null;
  /** A team task needs a project its members can see (94). */
  const needsProject = Boolean(team) && !destination.projectId && !teamDefault;
  const assigneeOther =
    values.assigneeId && values.assigneeId !== userId ? values.assigneeId : null;
  /** `@person` with no project: unfiled, the empty project slot shows (20a). */
  const unfiledFor = !projectId && !team && assigneeOther ? assigneeOther : null;
  const personName = (id: string) => people.find((p) => p.userId === id)?.name ?? "them";
  const sectionName = sectionId ? sections.find((s) => s.id === sectionId)?.name : null;

  const destinationLabel = (() => {
    if (needsProject) return "Pick a project";
    if (destination.projectId) {
      const name = chosen?.name ?? "Project";
      return sectionName ? `${name} › ${sectionName}` : name;
    }
    if (teamDefault) return teamDefault.name;
    if (unfiledFor) return "No project";
    return "Inbox";
  })();

  const title = resolved.title.trim();
  const canCreate = writable && title.length > 0 && !needsProject;

  // ── the menus ─────────────────────────────────────────────────────────────
  const mentionCandidates = useCallback(
    (query: string, base: MentionCandidate[]) => {
      const entries = mentionEntries(query, base, {
        people: menuPeople,
        teams,
        projects,
        sections,
      });
      effects.current["@"] = entries.effects;
      return entries.candidates;
    },
    [menuPeople, teams, projects, sections],
  );
  const tagCandidates = useCallback(
    (query: string, base: MentionCandidate[], loading: boolean) => {
      const entries = tagEntries(query, base, { tags, projects }, loading);
      effects.current["#"] = entries.effects;
      return entries.candidates;
    },
    [tags, projects],
  );
  const commandCandidates = useCallback((query: string, base: MentionCandidate[]) => {
    const entries = commandEntries(query, base, { templates: captureTemplates() !== null });
    effects.current["/"] = entries.effects;
    return entries.candidates;
  }, []);

  /** A hand pick clears the field's own hand value when a token takes it over. */
  const clearHandValue = (kind: CaptureToken["kind"]) => {
    setFields((f) => {
      switch (kind) {
        case "person":
          return { ...f, assigneeId: undefined };
        case "team":
          return { ...f, teamId: undefined };
        case "due":
          return { ...f, dueDay: null };
        case "schedule":
          return { ...f, scheduledAt: null };
        case "repeat":
          return { ...f, recurrence: null };
        case "priority":
          return { ...f, priority: null };
        case "estimate":
          return { ...f, estimateMinutes: null };
        case "remind":
          return { ...f, remindAt: null };
        default:
          return f;
      }
    });
  };

  const openField = (field: Extract<EntryEffect, { kind: "open" }>["field"]) => {
    if (field === "due") setOpenPill("due");
    else if (field === "priority") setOpenPill("priority");
    else if (field === "template") openTemplate();
    else setOpenPill("more");
  };

  const pickDestination = (projectIdPicked: string, section: string | null, label: string) => {
    setDestination({ projectId: projectIdPicked, sectionId: section });
    setHint(`@${label} moved into the destination`);
  };

  /** A token in place of the typed `@word` (one per single-value field). */
  const tokenEdit =
    (token: CaptureToken) =>
    (api: MenuPickApi): void => {
      api.removeQuery();
      // One value per field: an earlier token of the kind falls back to words.
      if (SINGLE_VALUE_KINDS.has(token.kind)) $tokensToText((t) => t.kind === token.kind);
      const node = $createCaptureTokenNode(token);
      api.insert([node, $createTextNode(" ")]);
      justInserted.current = { key: node.getKey(), baseline: null };
    };
  /** The typed `@word` goes, and something else happens (the destination, a pill). */
  const elsewhere =
    (run: () => void) =>
    (api: MenuPickApi): void => {
      api.removeQuery();
      run();
    };

  const onPick: MenuPick = (candidate) => {
    const token = ((): CaptureToken | null => {
      switch (candidate.kind) {
        case "person":
          return {
            kind: "person",
            userId: candidate.memberId,
            label: people.find((p) => p.userId === candidate.memberId)?.name ?? candidate.label,
          };
        case "team":
          return {
            kind: "team",
            teamId: candidate.teamId,
            label: candidate.label,
            letters: candidate.letters,
          };
        case "entity":
          return candidate.ref.type === "bucket"
            ? null
            : { kind: "thing", ref: candidate.ref, label: candidate.label };
        case "tag":
          return {
            kind: "tag",
            tagId: candidate.tagId,
            label: candidate.label,
            color: candidate.color,
          };
        case "command": {
          const day = candidate.command === "date" ? null : dateCommandDay(candidate.command);
          return day ? { kind: "due", day, label: candidate.label } : null;
        }
        case "action": {
          const effect = effectOf(candidate.id);
          return effect?.kind === "token" ? effect.token : null;
        }
        default:
          return null;
      }
    })();
    if (token) {
      clearHandValue(token.kind);
      return tokenEdit(token);
    }
    if (candidate.kind === "entity" && candidate.ref.type === "bucket") {
      const { id } = candidate.ref;
      const label = candidate.label;
      return elsewhere(() => pickDestination(id, null, label));
    }
    if (candidate.kind === "command" && candidate.command === "date") {
      return elsewhere(() => setOpenPill("due"));
    }
    if (candidate.kind === "action") {
      const effect = effectOf(candidate.id);
      if (effect?.kind === "destination") {
        return elsewhere(() => pickDestination(effect.projectId, effect.sectionId, effect.label));
      }
      if (effect?.kind === "open") return elsewhere(() => openField(effect.field));
    }
    return null;
  };
  const effectOf = (id: string): EntryEffect | undefined =>
    effects.current["/"]?.get(id) ?? effects.current["@"]?.get(id) ?? effects.current["#"]?.get(id);

  // ── title changes ─────────────────────────────────────────────────────────
  const onTitleChange = (next: TitleSegment[], keys: Array<NodeKey | null>) => {
    setSegments(next);
    setSegmentKeys(keys);
    lastTitleWords = plainText(next);
    onDraftChange(lastTitleWords);
    const just = justInserted.current;
    if (just) {
      const now = JSON.stringify(next);
      if (just.baseline === null) just.baseline = now;
      else if (just.baseline !== now) justInserted.current = null;
    }
  };

  // ── hand picks ────────────────────────────────────────────────────────────
  const onPillChange = (change: PillChange) => {
    const api = titleApi.current;
    const words = (kind: CaptureToken["kind"]) => api?.tokensToText((t) => t.kind === kind);
    switch (change.field) {
      case "assignee":
        words("person");
        setFields((f) => ({ ...f, assigneeId: change.value }));
        return;
      case "team":
        words("team");
        setFields((f) => ({ ...f, teamId: change.value }));
        return;
      case "due":
        words("due");
        setFields((f) => ({ ...f, dueDay: change.value }));
        return;
      case "schedule":
        words("schedule");
        setFields((f) => ({ ...f, scheduledAt: change.value }));
        return;
      case "repeat":
        words("repeat");
        setFields((f) => ({ ...f, recurrence: change.value }));
        return;
      case "priority":
        words("priority");
        setFields((f) => ({ ...f, priority: change.value }));
        return;
      case "estimate":
        words("estimate");
        setFields((f) => ({ ...f, estimateMinutes: change.value }));
        return;
      case "remind":
        words("remind");
        setFields((f) => ({ ...f, remindAt: change.value }));
        return;
      case "tag": {
        const { tag, on } = change;
        if (on) {
          setFields((f) =>
            f.tags.some((t) => t.id === tag.id) ? f : { ...f, tags: [...f.tags, tag] },
          );
        } else {
          api?.tokensToText((t) => t.kind === "tag" && t.tagId === tag.id);
          setFields((f) => ({ ...f, tags: f.tags.filter((t) => t.id !== tag.id) }));
        }
        return;
      }
      case "waiting":
        setFields((f) => ({
          ...f,
          waitingOn: change.on
            ? [...new Set([...f.waitingOn, change.userId])]
            : f.waitingOn.filter((id) => id !== change.userId),
        }));
        return;
    }
  };

  // ── templates and files (seams for TV-D15 and AT-2/AT-3) ──────────────────
  const openTemplate = () => {
    const provider = captureTemplates();
    if (!provider) return;
    provider.open((template) => {
      if (template.title) titleApi.current?.setSegments([{ text: template.title }]);
      if (template.description) setDescription(template.description);
      if (template.subtasks?.length) setSubtasks(template.subtasks);
    });
  };

  const takeFiles = (incoming: File[]) => {
    if (incoming.length === 0) return false;
    if (!captureAttachments()) {
      toast("Add files from the task once it's created.");
      return true;
    }
    setFiles((prev) => [...prev, ...incoming]);
    return true;
  };

  // ── creating ──────────────────────────────────────────────────────────────
  const lineContext = useMemo(
    () => ({
      people: menuPeople.map((p) => ({ userId: p.userId, name: p.name })),
      teams: teams.map((t) => ({ id: t.id, name: t.name, letters: t.mark || null })),
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    }),
    [menuPeople, teams, tags],
  );

  /**
   * Who a task goes to: the person named, else the one picked on the pill,
   * else nobody when it's for a team (so the team can claim it, 54), else you.
   */
  const assigneeFor = (person: string | undefined, teamId: string | null) =>
    person !== undefined
      ? person
      : values.assigneeId !== undefined
        ? values.assigneeId
        : teamId
          ? null
          : undefined;

  /** One typed line (a subtask, a pasted line) as a task, the pills under its own words. */
  const lineTask = (
    line: string,
    base: { bucketId: string; parentId: string | null; position: string },
  ): CaptureTaskPlan | null => {
    const read = resolveTitle(segmentsFromLine(line, lineContext));
    const words = read.title.trim();
    if (!words) return null;
    const own = captureDates(read);
    const hasOwnDate = Boolean(own.dueDay || own.scheduledAt || own.recurrence);
    const teamId = read.single.team?.teamId ?? (base.parentId ? null : values.teamId);
    return {
      id: newTaskId(),
      title: words,
      description: "",
      projectId: base.bucketId,
      sectionId,
      teamId,
      assigneeId: assigneeFor(read.single.person?.userId, teamId),
      parentId: base.parentId,
      position: base.position,
      dueDay: hasOwnDate ? own.dueDay : base.parentId ? null : values.dueDay,
      scheduledAt: hasOwnDate ? own.scheduledAt : base.parentId ? null : values.scheduledAt,
      recurrence: hasOwnDate ? own.recurrence : base.parentId ? null : values.recurrence,
      priority: base.parentId ? null : values.priority,
      estimateMinutes: null,
      tags: [
        ...(base.parentId ? [] : values.tags),
        ...read.tags.map((t) => ({ id: t.tagId, name: t.label })),
      ],
      links: [],
      fromSource: !base.parentId && sourceOn && Boolean(context?.source),
      remindAt: null,
      waitingOn: [],
    };
  };

  /** A pasted line as the preview shows it. */
  const describeLine = (line: string): { title: string; facts: string[] } => {
    const read = resolveTitle(segmentsFromLine(line, lineContext));
    const when = captureDates(read);
    const facts: string[] = [];
    if (when.scheduledAt) facts.push(formatDayTime(when.scheduledAt));
    else if (when.dueDay) facts.push(`Due ${formatDay(new Date(`${when.dueDay}T00:00:00`))}`);
    if (read.single.person) facts.push(read.single.person.label);
    if (read.single.team) facts.push(read.single.team.label);
    for (const t of read.tags) facts.push(`#${t.label}`);
    return { title: read.title || line, facts };
  };

  const currentDraft = (): CaptureDraft => ({ segments, keep, description, subtasks, fields });

  // Still open (Create more), with nothing typed since: a capture that didn't
  // save comes back into it. Otherwise it's kept as the draft.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  });
  const putBack = (kept: CaptureDraft) => {
    const empty = segmentsRef.current.every((x) => "text" in x && !x.text.trim());
    if (mounted.current && empty) {
      titleApi.current?.setSegments(kept.segments);
      setKeep(kept.keep);
      setDescription(kept.description);
      setSubtasks(kept.subtasks);
      setFields(kept.fields);
      return;
    }
    saveDraft(owner.userId, owner.workspaceId, kept);
  };

  /** Clear for the next one; "Create more" keeps the pills and the destination. */
  const resetForMore = () => {
    setFields((f) => ({
      ...EMPTY_FIELDS,
      assigneeId: values.assigneeId,
      teamId: values.teamId,
      priority: values.priority,
      tags: values.tags.flatMap((t) => (t.id ? [{ id: t.id, name: t.name, color: t.color }] : [])),
      waitingOn: f.waitingOn,
    }));
    titleApi.current?.setSegments([]);
    setKeep([]);
    setDescription("");
    setSubtasks([]);
    setFiles([]);
    setRestoredNotice(false);
    titleApi.current?.focus();
  };

  /** Save a plan behind the closed capture; answers with what was created. */
  const send = async (
    plan: CapturePlan,
    kept: CaptureDraft | null,
    batch: boolean,
  ): Promise<Task[]> => {
    if (!runtime) return [];
    const deps = { runtime, userId, store };
    let result: CaptureResult;
    try {
      result = await runCapture(plan, deps);
    } catch (error) {
      result = { created: [], queued: [], error, extrasFailed: 0 };
    }
    const landed = result.created.length + result.queued.length;
    if (result.error) {
      // The network never fails a capture (it waits on the device); this is
      // the server saying no. With nothing saved, the capture comes back.
      const message =
        result.error instanceof Error ? result.error.message : "Couldn't create the task.";
      if (landed === 0) {
        if (kept) putBack(kept);
        toast.error(message, {
          description: kept ? "Your capture is kept: open it again to change it." : undefined,
        });
      } else {
        toast.error(`${landed} of ${plan.tasks.length} saved`, { description: message });
      }
      return result.created;
    }
    if (result.queued.length > 0) {
      // Offline: they wait on this device and go once it's back (default g).
      const n = plan.tasks.length;
      toast(n > 1 ? `${n} tasks waiting to sync` : (plan.tasks[0]?.title ?? "Task"), {
        description: n > 1 ? undefined : `Waiting to sync · ${placeLabel}`,
      });
      return result.created;
    }
    if (batch) {
      const n = result.created.length;
      undoToast(`${n} ${n === 1 ? "task" : "tasks"} created`, {
        onUndo: () => {
          void undoCapture(deps, plan.workspaceId, result.created).then(({ error }) => {
            if (error) toast.error("Some weren't undone. Delete them from the list.");
          });
        },
      });
      return result.created;
    }
    const first = result.created[0];
    if (!first) return result.created;
    if (result.extrasFailed > 0) {
      toast.error("The task is saved, but a link or reminder didn't save.");
    }
    toast(first.title, {
      description: summaryText,
      action: { label: "Open", onClick: () => openReferenceFull({ type: "task", id: first.id }) },
    });
    return result.created;
  };

  const placeLabel = destination.projectId || teamDefault ? destinationLabel : "Inbox";
  const summaryText = (() => {
    const when = values.scheduledAt
      ? formatDayTime(values.scheduledAt)
      : values.dueDay
        ? `Due ${formatDay(new Date(`${values.dueDay}T00:00:00`))}`
        : null;
    return [when, placeLabel].filter(Boolean).join(" · ");
  })();

  const submit = (more: boolean) => {
    if (pasted) {
      createPasted(more);
      return;
    }
    if (!title) return;
    if (!runtime || !workspaceId) {
      toast.error("Pick a workspace first.");
      return;
    }
    if (!writable) {
      toast.error("You have view-only access to tasks.");
      return;
    }
    if (needsProject) {
      setHint("A task for a team needs a project its members can see. Pick one above.");
      setDestinationOpen(true);
      return;
    }
    // "" is your Inbox; the position is set on the way, first in its list.
    const bucketId = projectId ?? "";
    const main: CaptureTaskPlan = {
      id: newTaskId(),
      title,
      description: description.trim(),
      projectId: bucketId,
      sectionId,
      teamId: values.teamId,
      assigneeId: assigneeFor(undefined, values.teamId),
      parentId: null,
      position: "",
      dueDay: values.dueDay,
      scheduledAt: values.scheduledAt,
      recurrence: values.recurrence,
      priority: values.priority,
      estimateMinutes: values.estimateMinutes,
      tags: values.tags,
      links: resolved.things.map((t) => ({ ref: t.ref, label: t.label })),
      fromSource: sourceOn && Boolean(context?.source),
      remindAt: values.remindAt,
      waitingOn: values.waitingOn,
    };
    const lines = subtasks.map((s) => s.trim()).filter(Boolean);
    const childPositions = positionsAfter(lines.length, []);
    const children = lines.flatMap((line, i) => {
      const task = lineTask(line, { bucketId, parentId: main.id, position: childPositions[i] });
      return task ? [task] : [];
    });
    const plan: CapturePlan = {
      workspaceId,
      tasks: [main, ...children],
      source: context?.source ?? null,
      queueTop: Boolean(context?.queueTop),
    };
    const kept = currentDraft();
    const handler = files.length > 0 ? captureAttachments() : null;
    const filesNow = files;
    // The capture closes (or clears) at once; the task saves behind it.
    if (more) resetForMore();
    else {
      clearDraft(owner.userId, owner.workspaceId);
      lastTitleWords = "";
      onDraftChange("");
      onDone();
    }
    const sending = send(plan, kept, false);
    // Files go up once the task exists (the AT-2 / AT-3 seam).
    handler?.({
      workspaceId,
      taskId: sending.then((created) => (created.some((t) => t.id === main.id) ? main.id : null)),
      files: filesNow,
    });
  };

  const pastedList = useMemo(() => (pasted ? parsePastedList(pasted) : null), [pasted]);

  const createPasted = (more: boolean) => {
    if (!pastedList || pastedList.count === 0 || !workspaceId || !runtime) return;
    if (!writable) {
      toast.error("You have view-only access to tasks.");
      return;
    }
    if (needsProject) {
      setHint("A task for a team needs a project its members can see. Pick one above.");
      setDestinationOpen(true);
      return;
    }
    const bucketId = projectId ?? "";
    const tasks: CaptureTaskPlan[] = [];
    pastedList.items.forEach((item) => {
      const parent = lineTask(item.title, { bucketId, parentId: null, position: "" });
      if (!parent) return;
      tasks.push(parent);
      const childPositions = positionsAfter(item.children.length, []);
      item.children.forEach((child, j) => {
        const sub = lineTask(child, { bucketId, parentId: parent.id, position: childPositions[j] });
        if (sub) tasks.push(sub);
      });
    });
    setPasted(null);
    if (!more) onDone();
    void send(
      { workspaceId, tasks, source: context?.source ?? null, queueTop: Boolean(context?.queueTop) },
      null,
      true,
    );
  };

  const keepPastedAsOne = () => {
    if (!pasted) return;
    const one = keepAsOne(pasted);
    setPasted(null);
    titleApi.current?.setSegments([
      ...segments,
      { text: segments.length ? ` ${one.title}` : one.title },
    ]);
    if (one.description) setDescription((d) => (d ? `${d}\n${one.description}` : one.description));
    titleApi.current?.focus();
  };

  /** The highlighted date words the caret sits right after (only spaces between), if any. */
  const phraseBeforeCaret = (caret: { key: NodeKey; offset: number } | null): string | null => {
    if (!caret) return null;
    const index = segmentKeys.indexOf(caret.key);
    const segment = titleSegments[index];
    if (index < 0 || !segment || !("text" in segment)) return null;
    for (const h of highlights) {
      if (h.index !== index || h.end > caret.offset) continue;
      if (segment.text.slice(h.end, caret.offset).trim() === "") {
        return segment.text.slice(h.start, h.end);
      }
    }
    return null;
  };

  // ── Esc: a menu, then the last recognition, then close (keeping the draft) ─
  const handleEscape = () => {
    if (pasted) {
      setPasted(null);
      titleApi.current?.focus();
      return true;
    }
    const api = titleApi.current;
    if (api?.closeMenu()) return true;
    if (!api?.hasFocus()) return false;
    const just = justInserted.current;
    if (just) {
      justInserted.current = null;
      if (api.tokenToText(just.key)) return true;
    }
    // Only words recognised right before the caret ("tomorrow 3pm|"); dates
    // further back stay as they are and Esc closes.
    const phrase = phraseBeforeCaret(api.caret());
    if (phrase) {
      setKeep((k) => [...k, phrase]);
      return true;
    }
    return false;
  };
  const escapeRef = useRef(handleEscape);
  useEffect(() => {
    escapeRef.current = handleEscape;
  });
  useEffect(() => {
    registerEscape?.(() => escapeRef.current());
    return () => registerEscape?.(null);
  }, [registerEscape]);

  // The list panel takes ⏎ for "Create n".
  useEffect(() => {
    if (pasted) createListRef.current?.focus();
  }, [pasted]);

  const discardDraft = () => {
    clearDraft(owner.userId, owner.workspaceId);
    titleApi.current?.setSegments([]);
    setKeep([]);
    setDescription("");
    setSubtasks([]);
    setFields(EMPTY_FIELDS);
    setRestoredNotice(false);
    titleApi.current?.focus();
  };

  const SourceIcon = context?.source ? SOURCE_ICON[context.source.kind] : null;
  const footerHint = needsProject
    ? "A task for a team needs a project its members can see"
    : unfiledFor
      ? `Unfiled · ${personName(unfiledFor)} finds it in My tasks`
      : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone for files (the AT-2/AT-3 seam); the keyboard path is paste
    <div
      className="flex flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        takeFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* The destination row (91): the type, where it goes, what it came from. */}
      <div className="flex min-w-0 items-center gap-1 px-2 pt-2">
        {typeChip}
        <span className="text-muted-foreground" aria-hidden>
          ·
        </span>
        <DropdownMenu open={destinationOpen} onOpenChange={setDestinationOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant={needsProject || unfiledFor ? "outline" : "ghost"}
              size="sm"
              aria-label={`Destination: ${destinationLabel}`}
              className={cn(
                "min-w-0 gap-1.5",
                (unfiledFor || (!destination.projectId && !teamDefault)) && "text-muted-foreground",
                needsProject && "text-foreground",
              )}
            >
              {!projectId && !needsProject ? <Inbox aria-hidden /> : null}
              <span className="truncate">{destinationLabel}</span>
              {teamDefault && !destination.projectId ? (
                <span className="text-muted-foreground">(team default)</span>
              ) : null}
              <ChevronDown className="text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 min-w-56">
            <DropdownMenuItem
              disabled={Boolean(team)}
              onSelect={() => setDestination({ projectId: null, sectionId: null })}
            >
              <Inbox className="text-muted-foreground" aria-hidden />
              {unfiledFor ? "No project" : "Inbox"}
            </DropdownMenuItem>
            {projects.length > 0 ? <DropdownMenuSeparator /> : null}
            {projects.map((p) => (
              <ProjectItems
                key={p.id}
                project={p}
                sections={sections.filter((s) => s.projectId === p.id)}
                onPick={(section) => setDestination({ projectId: p.id, sectionId: section })}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="grow" />
        {context?.source && sourceOn && SourceIcon ? (
          <Chip
            size="sm"
            icon={SourceIcon}
            tabIndex={0}
            title="Becomes a link when you create"
            aria-label={`From: ${context.source.label}. Backspace removes it.`}
            onRemove={() => setSourceOn(false)}
            removeLabel="Don't link it"
            onKeyDown={(e) => {
              if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                setSourceOn(false);
                titleApi.current?.focus();
              }
            }}
            className="max-w-64 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            From: {context.source.label}
          </Chip>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 px-4 pt-1">
        <TitleEditor
          apiRef={titleApi}
          initial={initial.draft.segments}
          runtime={runtime}
          workspaceId={workspaceId}
          placeholder="Task title"
          mentionCandidates={mentionCandidates}
          tagCandidates={tagCandidates}
          commandCandidates={commandCandidates}
          onPick={onPick}
          onChange={onTitleChange}
          onSubmit={submit}
          onShiftEnter={() => descriptionRef.current?.focus()}
          onPaste={(text, pastedFiles) => {
            if (pastedFiles.length > 0 && takeFiles(pastedFiles)) return true;
            if (!isPastedList(text)) return false;
            setPasted(text);
            return true;
          }}
          highlights={highlights}
          segmentKeys={segmentKeys}
        />

        {pastedList ? (
          <PastePanel
            list={pastedList}
            describe={describeLine}
            buttonRef={createListRef}
            onCreate={() => createPasted(false)}
            onKeep={keepPastedAsOne}
            onCancel={() => {
              setPasted(null);
              titleApi.current?.focus();
            }}
          />
        ) : null}

        <Textarea
          ref={descriptionRef}
          value={description}
          placeholder="Add a description…"
          aria-label="Description"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit(true);
            }
          }}
          rows={1}
          // Grows with its words to about six lines, then scrolls (56).
          className="field-sizing-content max-h-36 min-h-0 resize-none border-0 bg-transparent px-0 py-1 font-sans text-base shadow-none focus-visible:ring-0"
        />

        <Subtasks
          lines={subtasks}
          refs={subtaskRefs}
          onChange={setSubtasks}
          onSubmit={submit}
          onDone={() => titleApi.current?.focus()}
        />

        {files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 py-1">
            {files.map((f, i) => (
              <Chip
                // biome-ignore lint/suspicious/noArrayIndexKey: two files can share a name
                key={`${f.name}-${i}`}
                onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                removeLabel={`Remove ${f.name}`}
              >
                {f.name}
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="pt-1 pb-3">
          <CapturePills
            values={values}
            people={people}
            teams={teams}
            tags={tags}
            me={userId}
            onChange={onPillChange}
            open={openPill}
            onOpenChange={setOpenPill}
            onTemplate={captureTemplates() ? openTemplate : undefined}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border px-4 py-2 font-sans text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" aria-live="polite">
          {!writable ? (
            "You have view-only access to tasks."
          ) : hint ? (
            hint
          ) : footerHint ? (
            footerHint
          ) : restoredNotice ? (
            <>
              Draft restored ·{" "}
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={discardDraft}
              >
                Clear
              </button>
            </>
          ) : null}
        </span>
        <Button variant="ghost" size="sm" disabled={!canCreate} onClick={() => submit(true)}>
          Create more
          <Kbd>{isMac ? "⌘⏎" : "Ctrl ⏎"}</Kbd>
        </Button>
        <Button size="sm" disabled={!canCreate} onClick={() => submit(false)}>
          Create
          <Kbd className="border-primary-foreground/25 bg-transparent text-primary-foreground/80">
            ⏎
          </Kbd>
        </Button>
      </div>
    </div>
  );
}

const ProjectIcon = resolveEntityIcon("bucket", "project");

function ProjectItems({
  project,
  sections,
  onPick,
}: {
  project: Bucket;
  sections: ReadonlyArray<{ id: string; name: string }>;
  onPick: (sectionId: string | null) => void;
}) {
  return (
    <>
      <DropdownMenuItem onSelect={() => onPick(null)}>
        <ProjectIcon className="text-muted-foreground" aria-hidden />
        <span className="truncate">{project.name}</span>
      </DropdownMenuItem>
      {sections.map((s) => (
        <DropdownMenuItem key={s.id} className="ps-8" onSelect={() => onPick(s.id)}>
          <span className="truncate">{s.name}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

function PastePanel({
  list,
  describe,
  buttonRef,
  onCreate,
  onKeep,
  onCancel,
}: {
  list: ReturnType<typeof parsePastedList>;
  /** What a line becomes: its title, and what its words set ("Due Oct 12"). */
  describe: (line: string) => { title: string; facts: string[] };
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  onCreate: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const n = list.count;
  const preview = list.items.slice(0, 4);
  return (
    <section
      aria-label={`Create ${n} tasks?`}
      className="motion-pop flex flex-col gap-2 rounded-lg border border-hairline p-3"
    >
      <p className="font-display text-base text-foreground">{`Create ${n} ${n === 1 ? "task" : "tasks"}?`}</p>
      <ul className="flex flex-col gap-0.5 font-sans text-sm text-muted-foreground">
        {preview.map((item, i) => {
          // Each line as it will be made, so "Send March report → due 1 March" shows first.
          const line = describe(item.title);
          const facts = [
            ...line.facts,
            ...(item.children.length ? [`${item.children.length} subtasks`] : []),
          ];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: pasted lines can repeat
            <li key={`${i}-${item.title}`} className="truncate">
              <Circle className="me-1.5 inline size-icon-xs" aria-hidden />
              <span className="text-foreground">{line.title}</span>
              {facts.length ? ` · ${facts.join(" · ")}` : ""}
            </li>
          );
        })}
        {list.items.length > preview.length ? (
          <li>{`and ${list.items.length - preview.length} more`}</li>
        ) : null}
      </ul>
      {list.skippedDone || list.overCap ? (
        <p className="font-sans text-xs text-muted-foreground">
          {[
            list.skippedDone ? `${list.skippedDone} already done, left out` : null,
            list.overCap ? `${list.overCap} past the 500 limit, left out` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button ref={buttonRef} size="sm" onClick={onCreate} disabled={n === 0}>
          {`Create ${n}`}
        </Button>
        <Button variant="ghost" size="sm" onClick={onKeep}>
          Keep as one
        </Button>
        <span className="grow" />
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Subtasks({
  lines,
  refs,
  onChange,
  onSubmit,
  onDone,
}: {
  lines: string[];
  refs: React.MutableRefObject<Array<HTMLInputElement | null>>;
  onChange: (lines: string[]) => void;
  onSubmit: (more: boolean) => void;
  onDone: () => void;
}) {
  const focusAt = (i: number) => window.setTimeout(() => refs.current[i]?.focus(), 0);
  if (lines.length === 0) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ms-2.5 gap-1.5 text-muted-foreground"
          onClick={() => {
            onChange([""]);
            focusAt(0);
          }}
        >
          <Plus aria-hidden />
          Add subtasks
        </Button>
      </div>
    );
  }
  return (
    <ul aria-label="Subtasks" className="flex flex-col">
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are edited in place by position
        <li key={i} className="flex items-center gap-2">
          <Circle className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
          <Input
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={line}
            aria-label={`Subtask ${i + 1}`}
            placeholder="Subtask"
            onChange={(e) => onChange(lines.map((l, j) => (j === i ? e.target.value : l)))}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text/plain");
              if (!isPastedList(text)) return;
              e.preventDefault();
              const pastedLines = parsePastedList(text).items.flatMap((it) => [
                it.title,
                ...it.children,
              ]);
              // Into an empty line they take its place; after a line with words.
              const here = line.trim() ? [line] : [];
              const next = [
                ...lines.slice(0, i),
                ...here,
                ...pastedLines,
                ...lines.slice(i + 1),
              ].filter((l) => l.trim() !== "");
              onChange(next.length ? next : [""]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) {
                  onSubmit(true);
                  return;
                }
                if (line.trim() === "") {
                  // An empty line ends the list.
                  onChange(lines.filter((_, j) => j !== i));
                  onDone();
                  return;
                }
                onChange([...lines.slice(0, i + 1), "", ...lines.slice(i + 1)]);
                focusAt(i + 1);
              } else if (e.key === "Backspace" && line === "") {
                e.preventDefault();
                onChange(lines.filter((_, j) => j !== i));
                if (i > 0) focusAt(i - 1);
                else onDone();
              }
            }}
            className="h-(--ctrl-h-sm) border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </li>
      ))}
    </ul>
  );
}
