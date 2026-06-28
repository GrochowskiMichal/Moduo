// Create / edit a contact (blocks CO-2/CO-4 follow-up; fixes "manual add doesn't
// work" + "no way to edit"). One form for both modes: name (required), email,
// phone, title, status. The page wires onSubmit to contacts.createContact /
// updateContact (+ setStatus on edit). Tokens + shadcn only; sentence case.

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { ContactStatusDot } from "./contact-status-badge";

export type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  title: string;
  status: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initial?: Partial<ContactFormValues>;
  onSubmit: (values: ContactFormValues) => Promise<void>;
};

const EMPTY: ContactFormValues = { name: "", email: "", phone: "", title: "", status: "lead" };

export function ContactFormDialog({ open, onOpenChange, mode, initial, onSubmit }: Props) {
  const [values, setValues] = useState<ContactFormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setValues({ ...EMPTY, ...initial, status: initial?.status || "lead" });
  }, [open, initial]);

  const set = (patch: Partial<ContactFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const canSave = values.name.trim().length > 0 && !saving;

  // Keep a renamed/custom status selectable.
  const statusMeta = contactStatusMeta(values.status);
  const known = DEFAULT_CONTACT_STATUSES.some((s) => s.id === statusMeta.id);
  const statusOptions = known ? DEFAULT_CONTACT_STATUSES : [...DEFAULT_CONTACT_STATUSES, statusMeta];

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        title: values.title.trim(),
        status: values.status,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save the contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New contact" : "Edit contact"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "Add a person to your contacts." : "Update this contact’s details."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={values.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Dana Lee"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={values.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="dana@acme.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                value={values.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="+1 555 0100"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-title">Title</Label>
              <Input
                id="contact-title"
                value={values.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Head of ops"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-status">Status</Label>
              <Select value={statusMeta.id} onValueChange={(v) => set({ status: v })}>
                <SelectTrigger id="contact-status" aria-label="Status">
                  {/* SelectValue mirrors the chosen item (dot + label) — no extra dot here. */}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-1.5">
                        <ContactStatusDot status={s.id} />
                        {s.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? "Saving…" : mode === "create" ? "Add contact" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
