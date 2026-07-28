// Email preferences with cross-device cloud sync (EM-10). The syncable set — the
// smart-inbox per-sender section overrides — lives in the `user_preferences.email`
// domain (prefs-sync.ts), reconciled owner-aware last-write-wins on sign-in /
// reconnect, with a localStorage mirror for instant first paint. Degrades to
// local-only until the migration deploys (the runtime.web prefs guard).

import { useCallback, useEffect, useRef, useState } from "react";

import { useDomainSync } from "../../../lib/prefs-sync";
import type { EmailSection } from "../classify";
import {
  DEFAULT_EMAIL_PREFS,
  readEmailPrefs,
  sanitizeEmailPrefs,
  writeEmailPrefs,
  type EmailPrefs,
} from "../prefs";

export function useEmailPrefs(userId: string): {
  prefs: EmailPrefs;
  /** Force a sender into a section (or clear the override with `null`). */
  setSenderOverride: (senderEmail: string, section: EmailSection | null) => void;
  /** Always load remote images from this sender (DF-6 per-sender allow). */
  allowImagesFromSender: (senderEmail: string) => void;
} {
  const [prefs, setPrefs] = useState<EmailPrefs>(() => readEmailPrefs(userId));
  const prefsRef = useRef(prefs);
  const userIdRef = useRef(userId);
  useEffect(() => {
    prefsRef.current = prefs;
    userIdRef.current = userId;
  });

  useEffect(() => {
    setPrefs(readEmailPrefs(userId));
  }, [userId]);

  const { pushLocalChange } = useDomainSync({
    domain: "email",
    getLocalSyncable: () => prefsRef.current as unknown as Record<string, unknown>,
    defaults: DEFAULT_EMAIL_PREFS as unknown as Record<string, unknown>,
    sanitizeCloud: (raw) => sanitizeEmailPrefs(raw) as unknown as Record<string, unknown>,
    apply: (value) => {
      const next = sanitizeEmailPrefs(value);
      prefsRef.current = next;
      setPrefs(next);
      writeEmailPrefs(userIdRef.current, next);
    },
  });

  const setSenderOverride = useCallback(
    (senderEmail: string, section: EmailSection | null) => {
      const key = senderEmail.trim().toLowerCase();
      if (!key) return;
      const prev = prefsRef.current;
      const senderOverrides = { ...prev.senderOverrides };
      if (section === null) delete senderOverrides[key];
      else senderOverrides[key] = section;
      const next = sanitizeEmailPrefs({ ...prev, senderOverrides });
      prefsRef.current = next;
      setPrefs(next);
      writeEmailPrefs(userIdRef.current, next);
      pushLocalChange(next as unknown as Record<string, unknown>);
    },
    [pushLocalChange],
  );

  const allowImagesFromSender = useCallback(
    (senderEmail: string) => {
      const key = senderEmail.trim().toLowerCase();
      if (!key) return;
      const prev = prefsRef.current;
      if (prev.imageAllowedSenders.includes(key)) return;
      const next = sanitizeEmailPrefs({
        ...prev,
        imageAllowedSenders: [...prev.imageAllowedSenders, key],
      });
      prefsRef.current = next;
      setPrefs(next);
      writeEmailPrefs(userIdRef.current, next);
      pushLocalChange(next as unknown as Record<string, unknown>);
    },
    [pushLocalChange],
  );

  return { prefs, setSenderOverride, allowImagesFromSender };
}
