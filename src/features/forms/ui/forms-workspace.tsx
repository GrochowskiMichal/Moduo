import { useEffect, useMemo, useState } from "react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import type { FormFieldType, FormSubmission } from "../types";
import { createDraftField, type UseFormsState } from "../hooks/use-forms";

const fieldTypes: Array<{ value: FormFieldType; label: string }> = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
];

const inputClass =
  "rounded-lg border border-[#2f2f2f] bg-[#0f0f0f] px-3 py-2 text-sm text-[#e4e4e4] outline-none focus:border-[#4a4a4a] focus:ring-0";
const inputSmClass =
  "rounded-md border border-[#2f2f2f] bg-[#0f0f0f] px-2 py-1 text-sm text-[#e4e4e4] outline-none focus:border-[#4a4a4a] focus:ring-0";
const buttonClass =
  "rounded-lg border border-[#2f2f2f] bg-[#161616] px-3 py-2 text-xs text-[#e4e4e4] transition hover:bg-[#1d1d1d] disabled:opacity-50";
const iconButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#2f2f2f] bg-[#161616] text-[#cfcfcf] transition hover:bg-[#1d1d1d] disabled:opacity-50";
const panelClass = "rounded-xl border border-[#232323] bg-[#101010] p-4 space-y-3";

type SelectedSubmission = {
  formId: string;
  submission: FormSubmission;
};

function normalizeAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value.trim() || "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function FormsWorkspace({ state }: { state: UseFormsState }) {
  const {
    loading,
    saving,
    error,
    canEdit,
    forms,
    selectedForm,
    selectedFormId,
    shareLink,
    expandedSubmissions,
    setSelectedFormId,
    loadExpandedSubmissions,
    createForm,
    updateForm,
    setPublicLink,
  } = state;

  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState<"draft" | "published" | "archived">("draft");
  const [fieldsDraft, setFieldsDraft] = useState(selectedForm?.schema.fields ?? []);
  const [requireCode, setRequireCode] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<SelectedSubmission | null>(null);

  useEffect(() => {
    setNameDraft(selectedForm?.name ?? "");
    setDescriptionDraft(selectedForm?.description ?? "");
    setStatusDraft(selectedForm?.status ?? "draft");
    setFieldsDraft(selectedForm?.schema.fields ?? []);
    setRequireCode(shareLink?.requireAccessCode ?? false);
    setAccessCodeDraft("");
  }, [
    selectedForm?.id,
    selectedForm?.name,
    selectedForm?.description,
    selectedForm?.status,
    selectedForm?.schema.fields,
    shareLink?.requireAccessCode,
  ]);

  const publicUrl = useMemo(() => {
    if (!shareLink?.slug || typeof window === "undefined") return "";
    return `${window.location.origin}/f/${shareLink.slug}`;
  }, [shareLink?.slug]);

  const selectedSubmissionAnswers = useMemo(() => {
    const source = selectedSubmission?.submission.answers;
    if (!source || Array.isArray(source)) return {} as Record<string, unknown>;
    return source as Record<string, unknown>;
  }, [selectedSubmission?.submission.answers]);

  return (
    <FeaturePanelsShell
      feature="form"
      left={
        <div className="flex h-full flex-col gap-3 text-[#e4e4e4]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#9a9a9a]">Forms</h3>
            <button
              className={buttonClass}
              disabled={!canEdit || saving}
              onClick={() => {
                setSelectedSubmission(null);
                void createForm();
              }}
            >
              New
            </button>
          </div>
          {!canEdit ? <p className="text-xs text-[#9a9a9a]">Viewer mode.</p> : null}
          <div className="flex-1 overflow-auto space-y-2">
            {forms.map((form) => {
              const isExpanded = expandedFormId === form.id;
              const formSubmissions = expandedSubmissions[form.id] ?? [];
              return (
                <div key={form.id} className="rounded-xl border border-[#232323] bg-[#101010]">
                  <button
                    className={`w-full px-3 py-2 text-left transition ${selectedFormId === form.id ? "bg-[#171717]" : "hover:bg-[#141414]"}`}
                    onClick={() => {
                      setSelectedSubmission(null);
                      setSelectedFormId(form.id);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-[#ececec]">{form.name}</span>
                      <span className="rounded-full bg-[#262626] px-2 py-0.5 text-[11px] text-[#b6b6b6]">{form.submissionsCount}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[#8e8e8e]">Views: {form.viewsCount}</div>
                    <div className="text-[11px] text-[#8e8e8e]">Submissions: {form.submissionsCount}</div>
                  </button>
                  <button
                    className="w-full border-t border-[#232323] px-3 py-1 text-left text-[11px] text-[#a5a5a5]"
                    onClick={async () => {
                      const nextExpanded = isExpanded ? null : form.id;
                      setExpandedFormId(nextExpanded);
                      if (nextExpanded) await loadExpandedSubmissions(form.id);
                    }}
                  >
                    {isExpanded ? "Hide submissions" : "Show submissions"}
                  </button>
                  {isExpanded ? (
                    <div className="border-t border-[#232323] p-2 space-y-1">
                      {formSubmissions.length ? (
                        formSubmissions.map((submission) => (
                          <button
                            key={submission.id}
                            className={`w-full rounded-md border px-2 py-1 text-left text-[11px] transition ${
                              selectedSubmission?.submission.id === submission.id
                                ? "border-[#4a4a4a] bg-[#181818] text-[#dfdfdf]"
                                : "border-[#2a2a2a] bg-[#121212] text-[#adadad] hover:border-[#3a3a3a]"
                            }`}
                            onClick={() => {
                              setSelectedFormId(form.id);
                              setSelectedSubmission({ formId: form.id, submission });
                            }}
                          >
                            {new Date(submission.submittedAt).toLocaleString()}
                          </button>
                        ))
                      ) : (
                        <p className="px-2 py-1 text-[11px] text-[#7f7f7f]">No submissions yet.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!forms.length && !loading ? <p className="text-xs text-[#7f7f7f]">No forms yet.</p> : null}
          </div>
        </div>
      }
      center={
        !selectedForm ? (
          <div className="grid h-full place-content-center text-center text-[#a3a3a3]">
            <p>Select a form from the left.</p>
          </div>
        ) : selectedSubmission && selectedSubmission.formId === selectedForm.id ? (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 text-[#e4e4e4] overflow-auto">
            <section className={panelClass}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Submission response</h3>
                <button className={buttonClass} onClick={() => setSelectedSubmission(null)}>
                  Back to builder
                </button>
              </div>
              <p className="text-xs text-[#a5a5a5]">{new Date(selectedSubmission.submission.submittedAt).toLocaleString()}</p>
              <div className="space-y-2">
                {selectedForm.schema.fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border border-[#2a2a2a] bg-[#121212] p-3">
                    <p className="text-[11px] text-[#8f8f8f]">Q{index + 1}</p>
                    <p className="mt-1 text-sm text-[#e5e5e5]">{field.label}</p>
                    <p className="mt-2 text-sm text-[#bcbcbc]">{normalizeAnswerValue(selectedSubmissionAnswers[field.id])}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 text-[#e4e4e4] overflow-auto">
            {error ? <div className="rounded-lg border border-[#3a2530] bg-[#211419] px-3 py-2 text-xs text-[#f0b4c2]">{error}</div> : null}

            <section className={panelClass}>
              <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                <input className={inputClass} value={nameDraft} disabled={!canEdit} onChange={(event) => setNameDraft(event.target.value)} placeholder="Form name" />
                <select className={`${inputClass} appearance-none`} value={statusDraft} disabled={!canEdit} onChange={(event) => setStatusDraft(event.target.value as typeof statusDraft)}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <textarea className={`min-h-20 w-full ${inputClass}`} value={descriptionDraft} disabled={!canEdit} onChange={(event) => setDescriptionDraft(event.target.value)} placeholder="Description" />
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Questions</h3>
                <button className={buttonClass} disabled={!canEdit} onClick={() => setFieldsDraft((current) => [...current, createDraftField(current.length)])}>
                  Add field
                </button>
              </div>
              <div className="space-y-2">
                {fieldsDraft.map((field) => (
                  <div key={field.id} className="grid gap-2 rounded-lg border border-[#2a2a2a] p-2 md:grid-cols-[1fr_160px_100px_80px]">
                    <input className={inputSmClass} value={field.label} disabled={!canEdit} onChange={(event) => setFieldsDraft((current) => current.map((entry) => (entry.id === field.id ? { ...entry, label: event.target.value } : entry)))} />
                    <select className={`${inputSmClass} appearance-none`} value={field.type} disabled={!canEdit} onChange={(event) => setFieldsDraft((current) => current.map((entry) => (entry.id === field.id ? { ...entry, type: event.target.value as FormFieldType } : entry)))}>
                      {fieldTypes.map((type) => (
                        <option key={type.value} value={type.value}>{type.label}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2 text-xs text-[#a5a5a5]">
                      <input type="checkbox" className="accent-[#9a9a9a]" checked={field.required} disabled={!canEdit} onChange={(event) => setFieldsDraft((current) => current.map((entry) => (entry.id === field.id ? { ...entry, required: event.target.checked } : entry)))} />
                      Required
                    </label>
                    <button className={buttonClass} disabled={!canEdit || fieldsDraft.length <= 1} onClick={() => setFieldsDraft((current) => current.filter((entry) => entry.id !== field.id))}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                className={buttonClass}
                disabled={!canEdit || saving}
                onClick={() =>
                  void updateForm(selectedForm.id, {
                    name: nameDraft,
                    description: descriptionDraft,
                    status: statusDraft,
                    schema: { fields: fieldsDraft },
                  })
                }
              >
                Save form
              </button>
              <div className="border-t border-[#232323] pt-3">
                <h3 className="text-sm font-semibold">Sharing</h3>
              {publicUrl ? (
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-[#b0b0b0]">{publicUrl}</p>
                  <button
                    className={iconButtonClass}
                    title="Regenerate link"
                    disabled={!canEdit || saving || !shareLink}
                    onClick={() =>
                      void setPublicLink({
                        formId: selectedForm.id,
                        requireAccessCode: requireCode,
                        accessCode: accessCodeDraft || undefined,
                        regenerateSlug: true,
                        isActive: true,
                      })
                    }
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
                      <path d="M3 21v-5h5" />
                    </svg>
                  </button>
                  <button
                    className={iconButtonClass}
                    title="Copy link"
                    disabled={!publicUrl}
                    onClick={async () => {
                      await navigator.clipboard.writeText(publicUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[#8e8e8e]">No public link yet.</p>
              )}
              {!shareLink ? (
                <button
                  className={buttonClass}
                  disabled={!canEdit || saving}
                  onClick={async () => {
                    const next = await setPublicLink({
                      formId: selectedForm.id,
                      requireAccessCode: requireCode,
                      accessCode: accessCodeDraft || undefined,
                      regenerateSlug: true,
                      isActive: true,
                    });
                    if (next) setAccessCodeDraft("");
                  }}
                >
                  Generate link
                </button>
              ) : null}
              {copied ? <p className="text-xs text-[#8e8e8e]">Copied.</p> : null}
              <div className="grid gap-2 md:grid-cols-2">
                <label className="flex items-center gap-2 text-xs text-[#a5a5a5]">
                  <input
                    type="checkbox"
                    className="accent-[#9a9a9a]"
                    checked={requireCode}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const nextRequire = event.target.checked;
                      setRequireCode(nextRequire);
                      if (!shareLink) return;
                      void setPublicLink({
                        formId: selectedForm.id,
                        requireAccessCode: nextRequire,
                        accessCode: accessCodeDraft || undefined,
                        isActive: shareLink.isActive,
                      });
                    }}
                  />
                  Require access code
                </label>
                <label className="flex items-center gap-2 text-xs text-[#a5a5a5]">
                  <input
                    type="checkbox"
                    className="accent-[#9a9a9a]"
                    checked={shareLink?.isActive ?? false}
                    disabled={!canEdit || !shareLink}
                    onChange={(event) =>
                      void setPublicLink({
                        formId: selectedForm.id,
                        requireAccessCode: requireCode,
                        accessCode: accessCodeDraft || undefined,
                        isActive: event.target.checked,
                      })
                    }
                  />
                  Link active
                </label>
              </div>
              {requireCode ? (
                <input
                  className={inputSmClass}
                  placeholder={shareLink?.requireAccessCode ? "Set new access code (optional)" : "Access code"}
                  value={accessCodeDraft}
                  disabled={!canEdit}
                  onChange={(event) => setAccessCodeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !shareLink) return;
                    event.preventDefault();
                    void setPublicLink({
                      formId: selectedForm.id,
                      requireAccessCode: true,
                      accessCode: accessCodeDraft || undefined,
                      isActive: shareLink.isActive,
                    });
                    setAccessCodeDraft("");
                  }}
                />
              ) : null}
              </div>
            </section>
          </div>
        )
      }
    />
  );
}
