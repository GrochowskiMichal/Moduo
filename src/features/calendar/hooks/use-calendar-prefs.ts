// Calendar preferences with cross-device cloud sync (CAL-6b). The syncable set
// — working-hours bound, week start, weekends, per-account visibility + colors —
// lives in the `user_preferences.calendar` domain (prefs-sync.ts), reconciled
// owner-aware last-write-wins on sign-in / reconnect, with the localStorage
// mirror for instant first paint. View state + panel widths stay per-device
// (see prefs.ts) and never touch this domain.

import { useCallback, useEffect, useRef, useState } from "react";

import { useDomainSync } from "../../../lib/prefs-sync";
import {
  DEFAULT_CALENDAR_PREFS,
  readCalendarPrefs,
  sanitizeCalendarPrefs,
  writeCalendarPrefs,
  type CalendarPrefs,
} from "../prefs";

type Patch = Partial<CalendarPrefs> | ((prev: CalendarPrefs) => Partial<CalendarPrefs>);

export function useCalendarPrefs(userId: string): {
  prefs: CalendarPrefs;
  updatePrefs: (patch: Patch) => void;
} {
  const [prefs, setPrefs] = useState<CalendarPrefs>(() => readCalendarPrefs(userId));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // Workspace/user switch → that user's localStorage mirror (cloud reconcile
  // then corrects it if the cloud copy is newer).
  useEffect(() => {
    setPrefs(readCalendarPrefs(userId));
  }, [userId]);

  const { pushLocalChange } = useDomainSync({
    domain: "calendar",
    getLocalSyncable: () => prefsRef.current as unknown as Record<string, unknown>,
    defaults: DEFAULT_CALENDAR_PREFS as unknown as Record<string, unknown>,
    sanitizeCloud: (raw) => sanitizeCalendarPrefs(raw) as unknown as Record<string, unknown>,
    apply: (value) => {
      const next = sanitizeCalendarPrefs(value);
      prefsRef.current = next; // keep the ref invariant uniform with updatePrefs
      setPrefs(next);
      writeCalendarPrefs(userIdRef.current, next);
    },
  });

  const updatePrefs = useCallback(
    (patch: Patch) => {
      const prev = prefsRef.current;
      const p = typeof patch === "function" ? patch(prev) : patch;
      const next = sanitizeCalendarPrefs({ ...prev, ...p });
      prefsRef.current = next; // keep the ref live for a same-tick follow-up call
      setPrefs(next);
      writeCalendarPrefs(userIdRef.current, next);
      pushLocalChange(next as unknown as Record<string, unknown>);
    },
    [pushLocalChange],
  );

  return { prefs, updatePrefs };
}
