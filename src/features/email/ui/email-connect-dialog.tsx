// EM-2 — the Email connect dialog (desktop-only). Provider chips (Gmail ·
// iCloud · Custom IMAP) pick the credential path; Gmail offers "Sign in with
// Google" (PKCE OAuth) alongside an app-password fallback. Connect validates by
// connecting through the engine and saves the credential to the OS keychain. An
// `isReconnect` account switches the dialog to a credential-only repair flow
// (provider + email locked). Replaces the legacy raw-hex connection setup.

import { useEffect, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { asHistoryDepth, DEFAULT_HISTORY_DEPTH, type EmailHistoryDepth } from "../history-depth";
import type { MailboxProvider, SavedAccount } from "../model/email-types";
import { EmailHistoryDepthSelect } from "./email-history-depth-select";

/** The three connectable providers in EM-2 (Outlook deferred). */
type ConnectProvider = Exclude<MailboxProvider, "outlook">;

const PROVIDER_TABS: { id: ConnectProvider; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "icloud", label: "iCloud" },
  { id: "custom", label: "Custom IMAP" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, repair this account's credential — provider + email are locked. */
  isReconnect?: SavedAccount;
  onConnected?: (account: SavedAccount) => void;
};

export function EmailConnectDialog({ open, onOpenChange, isReconnect, onConnected }: Props) {
  const { runtime } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();

  const reconnectProvider = isReconnect?.provider as ConnectProvider | undefined;
  const [provider, setProvider] = useState<ConnectProvider>(reconnectProvider ?? "gmail");
  const [email, setEmail] = useState(isReconnect?.email ?? "");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState(isReconnect?.imapHost ?? "");
  const [smtpHost, setSmtpHost] = useState(isReconnect?.smtpHost ?? "");
  const [imapPort, setImapPort] = useState(String(isReconnect?.imapPort ?? 993));
  const [smtpPort, setSmtpPort] = useState(String(isReconnect?.smtpPort ?? 587));
  const [historyDepth, setHistoryDepth] = useState<EmailHistoryDepth>(DEFAULT_HISTORY_DEPTH);
  const [busy, setBusy] = useState<null | "oauth" | "password">(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the reconnect target whenever it changes / the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setProvider(reconnectProvider ?? "gmail");
    setEmail(isReconnect?.email ?? "");
    setPassword("");
    setImapHost(isReconnect?.imapHost ?? "");
    setSmtpHost(isReconnect?.smtpHost ?? "");
    setImapPort(String(isReconnect?.imapPort ?? 993));
    setSmtpPort(String(isReconnect?.smtpPort ?? 587));
    // Re-seed the depth too, or connecting a second mailbox silently inherits the
    // previous one's pick instead of AC6's 12-month default.
    setHistoryDepth(asHistoryDepth(isReconnect?.historyDepth));
    setBusy(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isReconnect]);

  const providerLocked = Boolean(isReconnect);

  const succeed = (account: SavedAccount) => {
    onConnected?.(account);
    onOpenChange(false);
  };

  const handleGoogleOAuth = async () => {
    if (!runtime || busy) return;
    setBusy("oauth");
    setError(null);
    try {
      const account = (await runtime.email.startGoogleOAuth({
        workspaceId,
        historyDepth,
      })) as SavedAccount;
      succeed(account);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const passwordValid =
    email.trim().length > 0 &&
    password.trim().length > 0 &&
    (provider !== "custom" || (imapHost.trim().length > 0 && smtpHost.trim().length > 0));

  const handlePasswordConnect = async () => {
    if (!runtime || busy || !passwordValid) return;
    setBusy("password");
    setError(null);
    try {
      const account = (await runtime.email.connectAndSave(
        provider === "custom"
          ? {
              provider,
              historyDepth,
              email: email.trim(),
              password,
              workspaceId,
              imapHost: imapHost.trim(),
              smtpHost: smtpHost.trim(),
              imapPort: Number(imapPort) || 993,
              smtpPort: Number(smtpPort) || 587,
            }
          : { provider, email: email.trim(), password, workspaceId, historyDepth },
      )) as SavedAccount;
      succeed(account);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const title = isReconnect ? "Reconnect email account" : "Connect an email account";
  const description = isReconnect
    ? `Re-enter the credential for ${isReconnect.email}.`
    : "Connect Gmail, iCloud, or any IMAP mailbox. Credentials are stored in your device keychain.";

  const showGoogle = provider === "gmail";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Provider chips — segmented row. Locked in reconnect mode. */}
          {!providerLocked ? (
            <div
              role="tablist"
              aria-label="Email provider"
              className="inline-flex w-fit items-center gap-1 rounded-md bg-muted p-1"
            >
              {PROVIDER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={provider === tab.id}
                  onClick={() => {
                    setProvider(tab.id);
                    setError(null);
                  }}
                  className={
                    "rounded-md px-3 py-1.5 font-sans text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
                    (provider === tab.id
                      ? "bg-control-raised text-foreground shadow-control-raised"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Gmail OAuth path (also shown in reconnect for a gmail account). */}
          {showGoogle ? (
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleGoogleOAuth()}
                disabled={busy !== null}
                className="w-full"
              >
                {busy === "oauth" ? "Opening browser…" : "Sign in with Google"}
              </Button>
              <p className="text-2xs text-muted-foreground">
                Early-access app — Google may ask you to re-approve every 7 days until it&rsquo;s
                verified.
              </p>
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" />
                <Eyebrow>or use an app password</Eyebrow>
                <span className="h-px flex-1 bg-border" />
              </div>
            </div>
          ) : null}

          {/* Credential fields. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-connect-address">Email address</Label>
            <Input
              id="email-connect-address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              readOnly={providerLocked}
              autoComplete="username"
            />
          </div>

          {/* AC6: choose the history depth at connect time. Hidden on reconnect —
              that repairs a credential, it doesn't re-scope the mailbox, and the
              account already has a depth the user set. */}
          {!isReconnect ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-connect-depth">Inbox history to sync</Label>
              <EmailHistoryDepthSelect
                id="email-connect-depth"
                value={historyDepth}
                onChange={setHistoryDepth}
                disabled={Boolean(busy)}
              />
              <p className="text-xs text-muted-foreground">
                Applies to your inbox — archived mail isn&rsquo;t synced yet. Recent mail arrives
                first; older mail fills in as you use Mail. Changeable later per account.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-connect-password">
              {provider === "custom" ? "Password" : "App password"}
            </Label>
            <Input
              id="email-connect-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => {
                if (e.key === "Enter" && passwordValid && !busy) {
                  void handlePasswordConnect();
                }
              }}
            />
            {provider === "gmail" ? (
              <p className="text-xs text-muted-foreground">
                Requires 2-Step Verification ·{" "}
                <a
                  href="https://myaccount.google.com/apppasswords"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2 hover:text-primary"
                >
                  Create an app password
                </a>
              </p>
            ) : null}
            {provider === "icloud" ? (
              <p className="text-xs text-muted-foreground">
                Requires an app-specific password ·{" "}
                <a
                  href="https://appleid.apple.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2 hover:text-primary"
                >
                  appleid.apple.com
                </a>
              </p>
            ) : null}
          </div>

          {provider === "custom" ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email-connect-imap-host">IMAP host</Label>
                  <Input
                    id="email-connect-imap-host"
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    placeholder="imap.example.com"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email-connect-imap-port">Port</Label>
                  <Input
                    id="email-connect-imap-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    placeholder="993"
                  />
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email-connect-smtp-host">SMTP host</Label>
                  <Input
                    id="email-connect-smtp-host"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email-connect-smtp-port">Port</Label>
                  <Input
                    id="email-connect-smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    placeholder="587"
                  />
                </div>
              </div>
            </>
          ) : null}

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={() => void handlePasswordConnect()}
            disabled={!passwordValid || busy !== null}
          >
            {busy === "password" ? "Connecting…" : isReconnect ? "Reconnect" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
