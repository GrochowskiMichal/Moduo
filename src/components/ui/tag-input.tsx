import { useMemo, useState, type ClipboardEvent, type KeyboardEvent } from "react";

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
    <div className={`rounded-lg bg-[#151515] px-2 py-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        {safeTags.map((tag, index) => (
          <span key={`${tag}-${index}`} className="inline-flex items-center gap-1 rounded-full bg-[#1c1c1c] px-2 py-1 text-[12px] text-[#c8ced8]">
            <span>#{tag}</span>
            {!disabled ? (
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-[12px] leading-none text-[#8f97a6]"
                onClick={() => removeTag(index)}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={safeTags.length ? "Add tag" : placeholder}
          className="min-w-[120px] flex-1 bg-transparent text-[13px] text-[#e0e0e0] outline-none placeholder:text-[#707682] disabled:opacity-70"
        />
      </div>
    </div>
  );
}
