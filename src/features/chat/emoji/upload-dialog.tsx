// "Add emoji" (CV-20, spec §6; round-2.html frame 6 · settings): pick an
// image, name it, add it. The image is prepared in the browser (upload.ts),
// both files go to the workspace's emoji folder, then the op checks it all
// and adds the row; the list shows it at once (and everyone else's, live).

import { ImagePlus } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
import { getRuntime } from "@/lib/runtime";

import { loadChatEmoji } from "../composer/emoji-data";
import { EMOJI_LIMITS, emojiKey, emojiNameProblem, tidyEmojiName } from "./model";
import { applyEmoji } from "./store";
import { EmojiFileError, emojiPaths, type PreparedEmoji, prepareEmojiFile } from "./upload";

/** The standard emoji's shortcodes (a custom name can't take one). */
function useReservedNames(open: boolean): (name: string) => boolean {
  const [codes, setCodes] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!open || codes) return;
    void loadChatEmoji()
      .then((d) => setCodes(new Set(d.list.flatMap((e) => e.codes))))
      .catch(() => {
        // The server checks it too.
      });
  }, [open, codes]);
  return (name) => codes?.has(name) ?? false;
}

export function AddEmojiDialog({
  open,
  onOpenChange,
  workspaceId,
  taken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** The live names here. */
  taken: ReadonlySet<string>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<PreparedEmoji | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const reserved = useReservedNames(open);

  const preview = useMemo(
    () => (prepared ? URL.createObjectURL(prepared.image) : null),
    [prepared],
  );
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  useEffect(() => {
    if (open) return;
    setPrepared(null);
    setName("");
    setError(null);
    setTried(false);
  }, [open]);

  const tidy = tidyEmojiName(name);
  const nameProblem = emojiNameProblem(tidy, taken, reserved);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const p = await prepareEmojiFile(file);
      setPrepared(p);
      // From the file's name only while the field is still empty (a name typed
      // while the image was being read wins).
      const fromFile = tidyEmojiName(file.name.replace(/\.[^.]+$/, "")).slice(0, 32);
      setName((current) => current || fromFile);
    } catch (e) {
      setPrepared(null);
      setError(e instanceof EmojiFileError ? e.message : "Couldn't read that image.");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!prepared) {
      setError("Pick an image first.");
      return;
    }
    if (nameProblem) return;
    const chat = getRuntime()?.chat;
    if (!chat) return;
    setBusy(true);
    setError(null);
    try {
      // A fresh slot each time: a failed try never reuses one.
      const slot = await chat.beginCustomEmoji(workspaceId);
      const { path, posterPath } = emojiPaths(workspaceId, slot, prepared.mime);
      await chat.uploadEmojiImage(path, prepared.image, prepared.mime);
      await chat.uploadEmojiImage(posterPath, prepared.poster, "image/png");
      const row = await chat.addCustomEmoji({
        uploadId: slot,
        name: tidy,
        mime: prepared.mime,
        width: prepared.width,
        height: prepared.height,
        bytes: prepared.bytes,
        animated: prepared.animated,
      });
      applyEmoji(row);
      toast(`Added ${emojiKey(row.name)}`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the emoji. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-4" data-slot="add-emoji">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Add emoji</DialogTitle>
            <DialogDescription>
              PNG, GIF or WebP, up to {Math.round(EMOJI_LIMITS.bytes / 1024)} KB. A still image is
              made {EMOJI_LIMITS.px} px; an animated one plays when you hover it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={prepared ? "Choose another image" : "Choose an image"}
              className="grid size-16 shrink-0 place-items-center rounded-md bg-state-hover text-muted-foreground outline-none ring-1 ring-hairline ring-inset hover:bg-state-active focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {preview ? (
                <img src={preview} alt="" className="size-12 object-contain" />
              ) : (
                <ImagePlus aria-hidden className="size-icon" />
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="add-emoji-name">Name</Label>
              <Input
                id="add-emoji-name"
                value={name}
                maxLength={34}
                placeholder="shipit"
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                aria-invalid={tried && !!nameProblem}
              />
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/gif,image/webp,image/jpeg"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            data-slot="add-emoji-file"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {tidy ? (
            <p className="text-xs text-muted-foreground">
              Type <span className="font-mono">{emojiKey(tidy)}</span> to use it.
            </p>
          ) : null}
          {tried && nameProblem ? <p className="text-xs text-destructive">{nameProblem}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
