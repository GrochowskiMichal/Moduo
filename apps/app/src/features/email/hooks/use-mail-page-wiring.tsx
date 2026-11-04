// What the route hands MailPage on top of the engine (MR-14/MR-11 wiring): the
// spine gestures over the runtime, today's tasks, the `l` link picker, the
// composer's aliases/snippets/contacts and "Add as contact". Needs a
// <TasksProvider> above it (the Tasks inbox and today's tasks).

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";

import { useMentionSearch } from "../../spine/hooks/use-mention-search";
import { MentionPicker } from "../../spine/ui/mention-picker";
import { endPosition, makeTask } from "../../tasks/helpers";
import { useTasksSelector } from "../../tasks/tasks-context";
import { createMailSpineCommands } from "../commands/spine";
import { createMailCommands } from "../commands/triage";
import type { TodayTask } from "../panels/today-panel";
import { type EmailSettingsMirror, startEmailSettingsMirror } from "../settings/mirror";
import { mailStore } from "../store/mail-store";
import type { MailLinkPickerArgs, MailPageProps } from "../ui/mail-page";
import {
  aliasesFromItems,
  createRuntimeSpinePort,
  localDate,
  snippetsFromItems,
  type SpineRuntime,
} from "../ui/mail-page-wiring";
import { useEmailTissue } from "./use-email-tissue";

const EMPTY: never[] = [];
const noop = () => () => {};

type ContactRow = { id: string; name: string; emails: string[] };

function LinkPicker({ open, onOpenChange, onPick }: MailLinkPickerArgs) {
  const { runtime } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const search = useMentionSearch({
    runtime,
    workspaceId: selectedWorkspaceId,
    trigger: "ref",
    types: ["task", "contact", "note", "project"],
    canCreate: false,
    createType: null,
    includePeople: false,
    enabled: open,
  });
  return (
    <MentionPicker
      open={open}
      onOpenChange={onOpenChange}
      trigger={<span aria-hidden className="pointer-events-none absolute top-2 left-1/3 h-0 w-0" />}
      candidates={search.candidates}
      query={search.query}
      onQueryChange={search.setQuery}
      loading={search.loading}
      placeholder="Link to a task, contact, note or project…"
      emptyLabel="Nothing to link."
      onSelect={(c) => {
        if (c.kind === "entity") onPick({ type: c.ref.type, id: c.ref.id, label: c.label });
      }}
    />
  );
}

export function useMailPageWiring(): Partial<MailPageProps> {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();
  const inbox = useTasksSelector((d) => d.inbox);
  const liveTasks = useTasksSelector((d) => d.liveTasks);
  const tissue = useEmailTissue(runtime, workspaceId);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [mirror, setMirror] = useState<EmailSettingsMirror | null>(null);

  useEffect(() => {
    if (!userId) return;
    const started = startEmailSettingsMirror(userId);
    setMirror(started?.mirror ?? null);
    return () => started?.stop();
  }, [userId]);
  const items = useSyncExternalStore(mirror?.subscribe ?? noop, mirror?.items ?? (() => EMPTY));

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let gone = false;
    void runtime.contacts.list(workspaceId).then(
      (b) => {
        if (gone) return;
        setContacts(
          b.contacts.map((c) => ({
            id: c.id,
            name: c.name,
            emails: [c.email ?? "", ...c.emails.map((e) => e.value)]
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean),
          })),
        );
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [runtime, workspaceId]);

  const today = localDate(Date.now());
  const todayTasks = useMemo<TodayTask[]>(
    () =>
      liveTasks
        .filter((t) => t.dueDate === today && t.status !== "done" && t.status !== "archived")
        .map((t) => ({ id: t.id, title: t.title })),
    [liveTasks, today],
  );

  const spine = useMemo(() => {
    if (!runtime || !workspaceId) return null;
    const refKeys = new Set(tissue.tissueRefs.map((r) => r.threadKey));
    const triage = createMailCommands(mailStore);
    return createMailSpineCommands(
      createRuntimeSpinePort({
        runtime: runtime as unknown as SpineRuntime,
        workspaceId,
        hasRef: (key) => refKeys.has(key),
        contacts,
        makeTask: ({ title, description, dueDate }) => {
          if (!inbox) throw new Error("Your Tasks inbox isn't ready yet.");
          const position = endPosition(liveTasks.filter((t) => t.bucketId === inbox.id));
          return makeTask({
            workspaceId,
            bucketId: inbox.id,
            title,
            description,
            dueDate,
            position,
          });
        },
        markDone: async (threadId) => {
          await triage.apply({ kind: "done", threadIds: [threadId] });
          return async () => void (await triage.undo());
        },
      }),
    );
  }, [runtime, workspaceId, tissue.tissueRefs, contacts, inbox, liveTasks]);

  const composeContacts = useMemo(
    () => contacts.flatMap((c) => c.emails.map((email) => ({ name: c.name, email }))),
    [contacts],
  );

  return {
    spine,
    todayTasks,
    renderLinkPicker: (args) => <LinkPicker {...args} />,
    aliases: aliasesFromItems(items),
    snippets: snippetsFromItems(items),
    contacts: composeContacts,
    onAddContact: (email, name) => {
      if (!runtime || !workspaceId) return;
      void runtime.contacts.createContact({ workspaceId, name: name || email, email }).then(
        (c) => {
          setContacts((list) => [
            ...list,
            { id: c.id, name: c.name, emails: [email.toLowerCase()] },
          ]);
          toast(`Added ${c.name}`);
        },
        () => toast.error("Couldn't add the contact."),
      );
    },
  };
}
