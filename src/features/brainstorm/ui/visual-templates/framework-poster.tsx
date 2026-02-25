import type { TemplateVisualProps, TemplateVisualStyle } from "./template-visual-props";

function acronym(value: string) {
  const words = value
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.slice(0, 4).map((word) => word[0]?.toUpperCase() ?? "").join("") || "TPL";
}

function FieldEditor({
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa2b2]">{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          placeholder={placeholder}
          className="mt-1 w-full resize-y rounded-lg border border-[#394053] bg-[#111722] px-2.5 py-2 text-[12px] leading-relaxed text-[#eef2fc] outline-none focus:border-[#6178ff]"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full rounded-lg border border-[#394053] bg-[#111722] px-2.5 py-2 text-[12px] text-[#eef2fc] outline-none focus:border-[#6178ff]"
        />
      )}
    </>
  );
}

export function FrameworkPoster({
  template,
  entry,
  onUpdateName,
  onUpdateField,
  style,
}: TemplateVisualProps & { style: TemplateVisualStyle }) {
  const fields = template.fields;

  return (
    <div className="mx-auto w-full max-w-[1260px] pb-6">
      <div className="mb-5 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#303543] bg-[#171a22] text-[22px]">
          {template.icon}
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={entry.name}
            onChange={(event) => onUpdateName(event.target.value)}
            className="w-full bg-transparent text-[24px] font-semibold leading-tight text-[#eef1f7] outline-none"
            placeholder={template.name}
          />
          <p className="mt-1 max-w-[840px] text-[13px] leading-relaxed text-[#9aa2b2]">{template.description}</p>
        </div>
      </div>

      {style.mode === "orbit" ? (
        <div className="relative mx-auto h-[660px] overflow-hidden rounded-2xl border border-[#262a35] bg-[#0f1117]">
          <div
            className="absolute left-1/2 top-1/2 grid h-36 w-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-center"
            style={{ borderColor: style.accent, backgroundColor: `${style.accent}22`, boxShadow: `0 0 40px ${style.glow}` }}
          >
            <div className="px-3">
              <div className="text-[11px] uppercase tracking-widest text-[#9aa2b2]">Framework</div>
              <div className="text-[28px] font-bold text-[#f2f5ff]">{acronym(template.name)}</div>
            </div>
          </div>

          {fields.slice(0, 10).map((field, index) => {
            const angle = (Math.PI * 2 * index) / Math.max(fields.slice(0, 10).length, 1);
            const radiusX = 380;
            const radiusY = 250;
            const left = 50 + Math.cos(angle) * (radiusX / 12);
            const top = 50 + Math.sin(angle) * (radiusY / 6);
            return (
              <div
                key={field.key}
                className="absolute w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#2e3340] bg-[#171b25] p-3"
                style={{ left: `${left}%`, top: `${top}%` }}
              >
                <FieldEditor
                  label={field.label}
                  value={entry.fields[field.key] ?? ""}
                  placeholder={field.placeholder}
                  multiline={field.multiline}
                  onChange={(value) => onUpdateField(field.key, value)}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {style.mode === "grid" ? (
        <div className="rounded-2xl border border-[#262a35] bg-[#0f1117] p-4 md:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fields.map((field, index) => (
              <div
                key={field.key}
                className="rounded-xl border border-[#2f3442] p-3"
                style={{ background: `linear-gradient(160deg, ${style.panel}, #141923)` }}
              >
                <div
                  className="mb-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: style.accent, color: "#0f131c" }}
                >
                  {index + 1}
                </div>
                <FieldEditor
                  label={field.label}
                  value={entry.fields[field.key] ?? ""}
                  placeholder={field.placeholder}
                  multiline={field.multiline}
                  onChange={(value) => onUpdateField(field.key, value)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {style.mode === "steps" ? (
        <div className="rounded-2xl border border-[#262a35] bg-[#0f1117] p-5">
          <div className="relative">
            <div className="absolute bottom-0 left-[16px] top-0 w-px bg-[#323747]" />
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.key} className="relative pl-10">
                  <div
                    className="absolute left-[7px] top-3 h-4 w-4 rounded-full border border-[#111620]"
                    style={{ backgroundColor: style.accent, boxShadow: `0 0 18px ${style.glow}` }}
                  />
                  <div className="rounded-xl border border-[#2f3442] bg-[#171b25] p-3">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-[#7f8799]">Step {index + 1}</div>
                    <FieldEditor
                      label={field.label}
                      value={entry.fields[field.key] ?? ""}
                      placeholder={field.placeholder}
                      multiline={field.multiline}
                      onChange={(value) => onUpdateField(field.key, value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
