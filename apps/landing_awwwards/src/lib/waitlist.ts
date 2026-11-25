import { waitlist } from "../data/site";
// Waitlist forms and the dialog. Posts to the waitlist-join Edge Function, which answers
// 200 for new, duplicate and suspected-bot sign-ups alike (it never reveals who is on the list),
// 400 for a bad address, 403 for an origin outside its allowlist, 429 when rate limited.
import { onPage } from "../engine";
import { closeMenuNow } from "../motion/menu";

const ENDPOINT = "https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/waitlist-join";
const STORE_KEY = "moduo:waitlist";
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const loadedAt = performance.now();

type Source = "nav" | "hero" | "close" | "footer";

const readStored = (): string | null => {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    return v && typeof v.email === "string" ? v.email : null;
  } catch {
    return null;
  }
};
const writeStored = (email: string | null) => {
  try {
    if (email) localStorage.setItem(STORE_KEY, JSON.stringify({ email, at: Date.now() }));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode: the form still works, it just forgets */
  }
};

const track = (name: string, props: Record<string, unknown>) => {
  try {
    (
      window as unknown as { posthog?: { capture: (n: string, p: unknown) => void } }
    ).posthog?.capture(name, props);
  } catch {
    /* analytics never breaks the form */
  }
};

function setState(
  form: HTMLFormElement,
  state: "idle" | "loading" | "error" | "done",
  message?: string,
) {
  const msg = form.querySelector<HTMLElement>(".wl__msg")!;
  const input = form.querySelector<HTMLInputElement>(".wl__input")!;
  const btn = form.querySelector<HTMLButtonElement>(".wl__btn")!;
  const done = form.querySelector<HTMLElement>(".wl__done")!;
  form.dataset.state = state;
  msg.textContent = message ?? msg.dataset.note ?? waitlist.note;
  input.setAttribute("aria-invalid", state === "error" ? "true" : "false");
  input.readOnly = state === "loading";
  btn.disabled = state === "loading";
  btn.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  done.hidden = state !== "done";
}

function markAll(email: string | null) {
  document.documentElement.classList.toggle("wl-joined", !!email);
  document.querySelectorAll<HTMLFormElement>("form[data-wl]").forEach((f) => {
    if (email) {
      setState(f, "done");
    } else {
      f.querySelector<HTMLInputElement>(".wl__input")!.value = "";
      setState(f, "idle");
    }
  });
}

async function submit(form: HTMLFormElement) {
  if (form.dataset.state === "loading") return;
  const input = form.querySelector<HTMLInputElement>(".wl__input")!;
  const email = input.value.trim().toLowerCase();
  if (!email) {
    setState(form, "error", waitlist.errors.empty);
    return input.focus();
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    setState(form, "error", waitlist.errors.invalid);
    return input.focus();
  }
  setState(form, "loading", "Adding you to the list…");
  const source = (form.dataset.source || "hero") as Source;
  const website = form.querySelector<HTMLInputElement>(".wl__hp")?.value ?? "";
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        source,
        website,
        elapsedMs: Math.round(performance.now() - loadedAt),
      }),
    });
    if (res.ok) {
      writeStored(email);
      markAll(email);
      track("waitlist_joined", { source });
      return;
    }
    if (res.status === 400) setState(form, "error", waitlist.errors.invalid);
    else if (res.status === 429) setState(form, "error", waitlist.errors.rate);
    else setState(form, "error", waitlist.errors.server);
  } catch {
    setState(form, "error", navigator.onLine ? waitlist.errors.server : waitlist.errors.offline);
  }
}

export function startWaitlist() {
  onPage(() => {
    const off: (() => void)[] = [];
    const stored = readStored();

    document.querySelectorAll<HTMLFormElement>("form[data-wl]").forEach((form) => {
      if (stored) setState(form, "done");
      const onSubmit = (e: Event) => {
        e.preventDefault();
        void submit(form);
      };
      const again = form.querySelector<HTMLButtonElement>("[data-wl-again]");
      const onAgain = () => {
        writeStored(null);
        markAll(null);
        form.querySelector<HTMLInputElement>(".wl__input")?.focus();
      };
      form.addEventListener("submit", onSubmit);
      again?.addEventListener("click", onAgain);
      off.push(() => {
        form.removeEventListener("submit", onSubmit);
        again?.removeEventListener("click", onAgain);
      });
    });

    // The dialog: every [data-wl-open] opens it (native <dialog>: focus stays inside, Escape
    // closes, focus returns to the opener). What you type addresses the invite beside the form;
    // joined, the invite is marked queued.
    const dialog = document.querySelector<HTMLDialogElement>("#wl-dialog");
    const dForm = dialog?.querySelector<HTMLFormElement>("form[data-wl]");
    if (dialog && dForm) {
      const input = dForm.querySelector<HTMLInputElement>(".wl__input")!;
      const tos = [...dialog.querySelectorAll<HTMLElement>("[data-wl-to]")];
      const address = (value: string) => {
        const v = value.trim();
        for (const el of tos) {
          el.textContent = v || waitlist.placeholder;
          el.classList.toggle("is-empty", !v);
        }
        dialog.classList.toggle("is-valid", EMAIL_RE.test(v));
      };
      const joined = (on: boolean) => dialog.classList.toggle("is-joined", on);
      if (stored) {
        address(stored);
        joined(true);
      }
      const onInput = () => address(input.value);
      // Whichever form joins (this one, the close or the footer), the invite here follows: queued
      // and addressed once you're on the list, back to waiting for an address when you're not.
      const follow = () => {
        const done = dForm.dataset.state === "done";
        joined(done);
        address(done ? (readStored() ?? input.value) : input.value);
      };
      const observer = new MutationObserver(follow);
      observer.observe(dForm, { attributes: true, attributeFilter: ["data-state"] });

      const open = (e: Event) => {
        const from = (e.currentTarget as HTMLElement).dataset.wlOpen as Source | undefined;
        if (from) dForm.dataset.source = from;
        closeMenuNow();
        dialog.showModal();
        if (dForm.dataset.state !== "done") input.focus();
      };
      const close = () => dialog.close();
      const backdrop = (e: MouseEvent) => {
        if (e.target === dialog) dialog.close();
      };
      const openers = [...document.querySelectorAll<HTMLElement>("[data-wl-open]")];
      openers.forEach((o) => o.addEventListener("click", open));
      const closer = dialog.querySelector("[data-wl-close]");
      closer?.addEventListener("click", close);
      dialog.addEventListener("click", backdrop);
      input.addEventListener("input", onInput);
      off.push(() => {
        openers.forEach((o) => o.removeEventListener("click", open));
        closer?.removeEventListener("click", close);
        dialog.removeEventListener("click", backdrop);
        input.removeEventListener("input", onInput);
        observer.disconnect();
        if (dialog.open) dialog.close();
      });
    }
    return () => off.forEach((f) => f());
  });
}
