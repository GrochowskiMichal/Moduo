// Deleting an event (CALR-4, AC21): a Moduo event goes at once with an Undo
// toast; a Google event, whose delete has no Undo and emails its guests a
// cancellation, still asks first (CalendarDeleteDialog).

import { useCallback, useState } from "react";

import { deleteNeedsConfirm } from "../commands/undo";
import type { CalendarEventModel } from "../events";

type Input = {
  eventsById: Map<string, CalendarEventModel>;
  deleteEvent: (eventId: string) => Promise<void>;
  /** Clear what pointed at it (the card, the panel, the selection). */
  onDeleted: (eventId: string) => void;
};

export function useEventDelete({ eventsById, deleteEvent, onDeleted }: Input) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const remove = useCallback(
    (eventId: string) => {
      onDeleted(eventId);
      void deleteEvent(eventId);
    },
    [deleteEvent, onDeleted],
  );

  /** The whole event (not one occurrence: that asks This event / All events first). */
  const request = useCallback(
    (eventId: string) => {
      const event = eventsById.get(eventId);
      if (!event) return;
      if (deleteNeedsConfirm(event)) setConfirmId(eventId);
      else remove(eventId);
    },
    [eventsById, remove],
  );

  return {
    request,
    dialog: {
      event: confirmId ? (eventsById.get(confirmId) ?? null) : null,
      onCancel: () => setConfirmId(null),
      onConfirm: () => {
        const id = confirmId;
        setConfirmId(null);
        if (id) remove(id);
      },
    },
  };
}
