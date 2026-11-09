// Spike UI: the Inbox, a project view and a search, each one live query over
// the `tasks` collection; a row click opens a small panel whose title commits
// on blur (like the app's panel). Markup carries the app's perf hooks
// (data-list-row, data-row-title, aria-label="Task title") so one driver
// measures both.

import type { TaskRow } from "@contracts/rows";
import { and, eq, ilike, inArray, isNull, or, useLiveQuery } from "@tanstack/react-db";
import { memo, useState } from "react";
import type { EditVars } from "./mutations";
import type { TasksHandle } from "./tasks-collection";

export type Bucket = { id: string; name: string; is_system: boolean };
const OPEN = ["todo", "in_progress"];
const SHOWN = 60;

type Place = { kind: "bucket"; id: string } | { kind: "search"; q: string };

export function App(props: {
  tasks: TasksHandle;
  buckets: Bucket[];
  editTask: (v: EditVars) => unknown;
}) {
  const { tasks, buckets } = props;
  const inbox = buckets.find((b) => b.is_system) ?? buckets[0];
  const [place, setPlace] = useState<Place>({ kind: "bucket", id: inbox?.id ?? "" });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="spike">
      <nav aria-label="Tasks">
        {buckets.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={place.kind === "bucket" && place.id === b.id}
            onClick={() => setPlace({ kind: "bucket", id: b.id })}
          >
            {b.name}
          </button>
        ))}
        <input
          aria-label="Search tasks"
          value={place.kind === "search" ? place.q : ""}
          onChange={(e) =>
            setPlace(
              e.target.value
                ? { kind: "search", q: e.target.value }
                : { kind: "bucket", id: inbox?.id ?? "" },
            )
          }
        />
      </nav>
      <main>
        {place.kind === "bucket" ? (
          <BucketList tasks={tasks} bucketId={place.id} onOpen={setSelected} />
        ) : (
          <SearchList tasks={tasks} q={place.q} onOpen={setSelected} />
        )}
      </main>
      {selected ? <Panel tasks={tasks} id={selected} editTask={props.editTask} /> : null}
    </div>
  );
}

function BucketList(props: { tasks: TasksHandle; bucketId: string; onOpen: (id: string) => void }) {
  const { data, status } = useLiveQuery(
    (q) =>
      q
        .from({ t: props.tasks.collection })
        .where(({ t }) =>
          and(eq(t.bucket_id, props.bucketId), inArray(t.status, OPEN), isNull(t.parent_id)),
        )
        .orderBy(({ t }) => t.position)
        .limit(SHOWN),
    [props.bucketId],
  );
  return <Rows rows={data} status={status} onOpen={props.onOpen} />;
}

function SearchList(props: { tasks: TasksHandle; q: string; onOpen: (id: string) => void }) {
  const like = `%${props.q}%`;
  const { data, status } = useLiveQuery(
    (q) =>
      q
        .from({ t: props.tasks.collection })
        .where(({ t }) => or(ilike(t.title, like), ilike(t.description, like)))
        .orderBy(({ t }) => t.position)
        .limit(SHOWN),
    [like],
  );
  return <Rows rows={data} status={status} onOpen={props.onOpen} />;
}

function Rows(props: { rows: TaskRow[]; status: string; onOpen: (id: string) => void }) {
  return (
    <div data-status={props.status}>
      {props.rows.map((t) => (
        <Row key={t.id} task={t} onOpen={props.onOpen} />
      ))}
    </div>
  );
}

const Row = memo(function Row(props: { task: TaskRow; onOpen: (id: string) => void }) {
  const { task } = props;
  return (
    <div data-list-row={task.id}>
      <button type="button" data-row-title onClick={() => props.onOpen(task.id)}>
        {task.title}
      </button>
      <span>{task.status}</span>
      <span>{task.due_on ?? ""}</span>
    </div>
  );
});

function Panel(props: { tasks: TasksHandle; id: string; editTask: (v: EditVars) => unknown }) {
  const { data } = useLiveQuery(
    (q) =>
      q
        .from({ t: props.tasks.collection })
        .where(({ t }) => eq(t.id, props.id))
        .findOne(),
    [props.id],
  );
  if (!data) return null;
  return <PanelTitle key={data.id} task={data} editTask={props.editTask} />;
}

function PanelTitle(props: { task: TaskRow; editTask: (v: EditVars) => unknown }) {
  const [title, setTitle] = useState(props.task.title ?? "");
  return (
    <aside>
      <textarea
        aria-label="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== props.task.title) props.editTask({ id: props.task.id, patch: { title } });
        }}
      />
    </aside>
  );
}
