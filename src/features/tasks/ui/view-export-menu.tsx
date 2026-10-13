// The view's ⋯ in the toolbar (TV-D14, default f): Copy as text · Export view
// as CSV · Print. Each takes the tasks the view shows right now (its scope,
// filter and Display), in their order. The print layout is mounted only while
// printing.

import { isClosedTask } from "@contracts/vocabularies";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PrintRoot } from "../../../components/app/print-root";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { printPage } from "../../../lib/print";
import { formatDate, formatFullDate } from "../../../lib/time-format";
import { saveBlob } from "../../attachments/files";
import { type ListExportContext, tasksAsCsv, tasksAsText } from "../list-export";
import type { Task } from "../model";

function fileStem(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tasks"
  );
}

export function ViewExportMenu({
  tasks,
  title,
  context,
}: {
  /** What the view shows, in its order. Read when an item is picked. */
  tasks: () => Task[];
  title: string;
  context: ListExportContext;
}) {
  const [printing, setPrinting] = useState<Task[] | null>(null);

  // Print once the layout is in the page; take it away when printing is done.
  useEffect(() => {
    if (!printing) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setPrinting(null);
    };
    window.addEventListener("afterprint", finish);
    // The layout is in the DOM once this effect runs; print on the next turn.
    const start = window.setTimeout(() => {
      printPage().catch(() => {
        toast.error("Couldn't open printing.");
        finish();
      });
    }, 0);
    // A desktop print dialog doesn't always say when it closes.
    const fallback = window.setTimeout(finish, 120_000);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(fallback);
      window.removeEventListener("afterprint", finish);
    };
  }, [printing]);

  const copy = () => {
    const list = tasks();
    if (!navigator.clipboard) {
      toast.error("Couldn’t copy.");
      return;
    }
    void navigator.clipboard.writeText(tasksAsText(list, context, title)).then(
      () => toast(list.length === 1 ? "Copied 1 task" : `Copied ${list.length} tasks`),
      () => toast.error("Couldn’t copy."),
    );
  };
  const csv = () => {
    const list = tasks();
    saveBlob(
      `${fileStem(title)}.csv`,
      // The byte-order mark tells a spreadsheet the file is UTF-8.
      new Blob(["﻿", tasksAsCsv(list, context)], { type: "text/csv;charset=utf-8" }),
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={MoreHorizontal} label="More view options" tooltip={null} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={copy}>Copy as text</DropdownMenuItem>
          <DropdownMenuItem onSelect={csv}>Export view as CSV</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPrinting(tasks())}>Print…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {printing ? (
        <PrintRoot label={`${title}, print layout`}>
          <ViewPrintLayout tasks={printing} title={title} context={context} />
        </PrintRoot>
      ) : null}
    </>
  );
}

/** A view on paper: its title and the date, then each task on one line. */
function ViewPrintLayout({
  tasks,
  title,
  context,
}: {
  tasks: Task[];
  title: string;
  context: ListExportContext;
}) {
  const now = new Date();
  return (
    <article className="flex flex-col gap-4 font-sans text-sm text-foreground">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-3">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground">
          {tasks.length === 1 ? "1 task" : `${tasks.length} tasks`} · {formatFullDate(now)}
        </p>
      </header>
      <ul className="flex flex-col">
        {tasks.map((task) => {
          const due = task.dueDate ? formatDate(task.dueDate, now) : null;
          const who = context.assigneeName(task.assigneeId ?? null);
          const handle = context.handleOf?.(task);
          return (
            <li
              key={task.id}
              className="print-avoid-break flex items-start gap-3 border-b border-hairline py-1.5"
            >
              <span aria-hidden className="w-4 shrink-0 text-muted-foreground">
                {isClosedTask(task) ? "☑" : "☐"}
              </span>
              <span className="min-w-0 flex-1 break-words">
                {task.parentId ? <span className="text-muted-foreground">↳ </span> : null}
                {task.title || "Untitled"}
                {handle ? <span className="text-muted-foreground"> {handle}</span> : null}
              </span>
              <span className="w-32 shrink-0 break-words text-muted-foreground">
                {context.projectName(task.bucketId)}
              </span>
              <span className="w-20 shrink-0 text-muted-foreground">{due ?? ""}</span>
              <span className="w-24 shrink-0 break-words text-muted-foreground">{who ?? ""}</span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
