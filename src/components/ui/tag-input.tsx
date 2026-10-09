import { type ClipboardEvent, type KeyboardEvent, useMemo, useState } from "react";
import { Badge } from "./badge";

type Props = {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function TagInput({
  tags,
  onChange,
  disabled = false,
  placeholder = "Add tag and press Enter",
  className = "",
}: Props) {
  const [draft, setDraft] = useState("");
  const safeTags = useMemo(() => (Array.isArray(tags) ? tags : []), [tags]);

  const commitDraft = () => {
    const value = draft.trim();
    if (!value) return;
    const next = dedupeTags([...safeTags, value]);
    if (next.join("|") !== safeTags.join("|")) onChange(next);
    setDraft("");
  };

  const removeTag = (index: number) => {
    if (disabled) return;
    onChange(safeTags.filter((_, i) => i !== index));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
      event.preventDefault();
      commitDraft();
      return;
    }

    if (event.key === "Backspace" && !draft && safeTags.length > 0) {
      event.preventDefault();
      removeTag(safeTags.length - 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text.includes(",") && !text.includes("\n")) return;
    event.preventDefault();
    const parts = text
      .split(/,|\n/g)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange(dedupeTags([...safeTags, ...parts]));
  };

  return (
    <div
      className={`rounded-md border border-border bg-muted px-2 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {safeTags.map((tag, index) => (
          <Badge key={`${tag}-${index}`} variant="secondary" className="gap-1 pl-2 pr-1 py-0.5">
            <span>#{tag}</span>
            {!disabled ? (
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => removeTag(index)}
              >
                ×
              </button>
            ) : null}
          </Badge>
        ))}
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={safeTags.length ? "Add tag" : placeholder}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-70"
        />
      </div>
    </div>
  );
}
