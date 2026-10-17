import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModuoMark } from "@/components/ui/moduo-mark";
import { useAuth } from "@/providers/auth-provider";

/**
 * First-run setup. Deliberately ONE screen: naming a workspace is the only
 * required action, so the former "your trial is active" interstitial became a
 * quiet footnote here rather than a step the user has to click past.
 *
 * Monochrome is applied by the `preWorkspace()` route wrapper (route-tree.tsx),
 * not here — every out-of-gate surface gets it from one place so branches can't
 * drift.
 */
export function OnboardingPage() {
  const { isSignedIn, loading, runtime } = useAuth();
  const navigate = useNavigate();
  const [workspaceName, setWorkspaceName] = useState("My workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  // Latch, not the `busy` closure: a double-fire would race workspace.list() and
  // create two workspaces.
  const submitting = useRef(false);

  // Web-only reassurance; desktop users are not on the free-trial path.
  const showTrialNote = !!runtime?.capabilities.isWeb;

  useEffect(() => {
    if (!loading && !isSignedIn) void navigate({ to: "/auth", replace: true });
  }, [isSignedIn, loading, navigate]);

  // Preselect the prefilled name so the user can type straight over it.
  useEffect(() => {
    if (loading) return;
    nameRef.current?.select();
  }, [loading]);

  const finish = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runtime || submitting.current) return;
    submitting.current = true;
    const name = workspaceName.trim() || "My workspace";
    setBusy(true);
    setError(null);
    try {
      const existing = await runtime.workspace.list();
      if (existing.length === 0) {
        await runtime.workspace.create(name);
      }

      void navigate({ to: "/", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish onboarding.");
      setBusy(false);
      submitting.current = false; // let the user retry
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-xl border border-border bg-card px-5 py-3 shadow-lg">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[620px] -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] items-center justify-center px-5 py-8">
        <div className="w-full rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          <div className="mb-7 flex w-full flex-col items-center">
            <ModuoMark className="mb-6 size-8 opacity-95" aria-hidden="true" />
            <Eyebrow as="p">Welcome to Moduo</Eyebrow>
            <h1 className="mt-2 w-full text-center font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Set up your workspace
            </h1>
            <p className="mx-auto mt-2 max-w-[320px] text-center text-sm leading-5 text-muted-foreground">
              A workspace holds your tasks, notes, calendar and contacts. You can rename it any
              time.
            </p>
          </div>

          <form onSubmit={finish} className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                ref={nameRef}
                autoFocus
                autoComplete="off"
                placeholder="My workspace"
                value={workspaceName}
                onChange={(e) => {
                  setWorkspaceName(e.target.value);
                  setError(null);
                }}
              />
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Creating workspace…" : "Continue"}
            </Button>

            {/* A submission failure, not field validation — `role="alert"` is
                announced on appear; the field itself isn't invalid, so no
                aria-invalid. */}
            {error ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3"
              >
                <p className="text-sm leading-5 text-destructive">{error}</p>
              </div>
            ) : null}
          </form>

          {showTrialNote ? (
            <p className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              Your <span className="font-medium text-foreground">7-day trial</span> is active. Add a
              card under Settings → Billing any time to extend it to 30 days.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
